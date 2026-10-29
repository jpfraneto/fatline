// Writes the token metadata the Fatliners contract points to: tokenURI(fid) = https://fatline.ink/fatliners/<fid>.
// The site is static, so the site's workflow runs this every 15 minutes: it reads every egg taken and every
// Fatliner born from the contract's events on Base and writes one JSON file per token (no extension, as the
// contract's URI has none). An egg shows its stone's egg coming alive under the arch; a Fatliner shows its being
// (or its egg until its art is revealed); a dead egg's file is removed; a token that changed hands is marked asleep.
// Usage: node apps/site/fatliners.mjs [out-dir]   (no dependencies: plain JSON-RPC)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, 'fatliners');
const deployments = JSON.parse(readFileSync(join(here, '../../smart-contracts/deployments/base.json'), 'utf8'));
const art = JSON.parse(readFileSync(join(here, 'fatliners-art.json'), 'utf8'));
const contract = deployments.Fatliners.address;
const fromBlock = deployments.fromBlock ?? 53012364;
const RPCS = (process.env.BASE_RPCS ?? 'https://base-rpc.publicnode.com,https://base.drpc.org,https://mainnet.base.org').split(',');

const EGG_TAKEN = '0x8c16cbfb788ff0014645f2e619d6e70982930d43a1a53fcbb22ff48ab6eb0af0'; // EggTaken(uint256,address,address,bytes32,uint64)
const BORN = '0x704dcc88ff1bfb0743f3746acd10e46292474d0ff7ab8869fc1e8f0626d629b0'; // Born(uint256,address,string,bytes32,address,uint256)
const STONE = '0x070d70891cb4787d2b3536ef002157e545057758ca8cee05540e7f6682ac4d54'; // Stone(uint256,uint8): the egg's stone, from its history (0 ivory … 6 opal)
const STONES = ['ivory', 'marble', 'sandstone', 'basalt', 'moss', 'gold', 'opal'];
const SURNAME_OF = '0x8d967a78'; // surnameOf(uint256)

async function rpc(method, params) {
  let last;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
      const j = await res.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { last = e; }
  }
  throw last;
}

async function logs(topic) {
  const head = Number(await rpc('eth_blockNumber', []));
  const found = [];
  for (let from = fromBlock; from <= head; from += 10_000) {
    const to = Math.min(head, from + 9_999);
    found.push(...await rpc('eth_getLogs', [{ address: contract, topics: [Array.isArray(topic) ? topic : [topic]], fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }]));
  }
  return found;
}

function decodeString(hex) {
  const b = Buffer.from(hex.slice(2), 'hex');
  const len = Number(b.readBigUInt64BE(56));
  return b.subarray(64, 64 + len).toString('utf8');
}

const word = (hex, i) => '0x' + hex.slice(2 + 64 * i, 2 + 64 * (i + 1));
const tokenId = (l) => BigInt(l.topics[1]).toString();

// Every event that changes a token's face, in the order it happened.
const DIED = '0xfda7d6be9e47c82ebcc3553edd222287058538459229e3a58a56dd65448fbecd'; // Died(uint256,uint256): the node stopped; the token is burned
const FID_LINKED = '0x2bbe7d30ffc4a7d3899a38a1449c4693e12ae0ac52c218fc17bc5356ff1390bf'; // FidLinked(fatliner, fid, holder): fid 0 = moved, asleep
const all = (await logs([EGG_TAKEN, BORN, STONE, DIED, FID_LINKED]))
  .sort((x, y) => Number(BigInt(x.blockNumber) - BigInt(y.blockNumber)) || Number(BigInt(x.logIndex) - BigInt(y.logIndex)));
const tokens = new Map(); // fid -> { dna, laidAt, stone, born, asleep, dead }
const at = (id) => tokens.get(id) ?? tokens.set(id, {}).get(id);
for (const l of all) {
  const id = tokenId(l), t = at(id);
  if (l.topics[0] === EGG_TAKEN) Object.assign(t, { dna: word(l.data, 0), laidAt: Number(BigInt(word(l.data, 1))), dead: false, born: false });
  if (l.topics[0] === BORN) Object.assign(t, { dna: word(l.data, 1), born: true });
  if (l.topics[0] === STONE) t.stone = STONES[Number(BigInt(l.data))];
  if (l.topics[0] === DIED) t.dead = true;
  if (l.topics[0] === FID_LINKED) t.asleep = BigInt(l.topics[2]) === 0n;
}
const g = deployments.Fatliners.genesis;
// The beings the master's hatchery drew when they hatched (indexer/src/beings.mjs); this job runs on that server.
const drawn = await fetch(process.env.FATLINE_BEINGS_URL ?? 'http://127.0.0.1:8791/beings', { signal: AbortSignal.timeout(5000) })
  .then((r) => (r.ok ? r.json() : null)).then((j) => j?.beings ?? {}).catch(() => ({}));

mkdirSync(out, { recursive: true });
let written = 0;
for (const [fid, t] of tokens) {
  if (t.dead) { rmSync(join(out, fid), { force: true }); continue; } // burned: no token, no metadata
  if (!t.dna) continue;
  const surname = decodeString(await rpc('eth_call', [{ to: contract, data: SURNAME_OF + BigInt(fid).toString(16).padStart(64, '0') }, 'latest']));
  const isGenesis = fid === String(g.fid);
  const title = isGenesis ? `${g.name} ${surname.charAt(0)}${surname.slice(1).toLowerCase()}` : surname;
  const attrs = [
    { trait_type: 'Stage', value: t.born ? 'Fatliner' : 'Egg' },
    ...(surname ? [{ trait_type: 'Surname', value: surname }] : []),
    ...(t.stone ? [{ trait_type: 'Stone', value: t.stone }] : []),
    { trait_type: 'State', value: t.asleep ? 'Asleep' : 'Awake' },
    { trait_type: 'FID', value: Number(fid), display_type: 'number' },
    { trait_type: 'DNA', value: t.dna },
  ];
  const asleep = t.asleep ? ' It changed hands and is asleep until its new holder links their own Farcaster account to it.' : '';
  const meta = t.born
    ? {
      name: isGenesis ? title : `${title} · Fatliner #${fid}`,
      description: `${isGenesis ? 'Aster, the first Fatliner. ' : ''}One of the 777 Fatliners: it hatched from the egg of Farcaster account #${fid} after a Fatline node kept it warm for three days. Its surname, ${surname}, was read from that account's history and is the ticker of its coin.${asleep} https://fatline.ink/f/${surname}`,
      ...(art.beings[fid] ?? drawn[fid] ?? art.eggs?.[t.stone] ?? art.egg),
      external_url: `https://fatline.ink/f/${surname}`,
      attributes: attrs,
    }
    : {
      name: isGenesis ? `${title} · egg` : `${surname ? `${title} · ` : ''}Egg #${fid}`,
      description: `${isGenesis ? 'This is Aster Fatline, the first egg. ' : ''}The egg of Farcaster account #${fid}, made of the stone its history earned${t.stone ? ` (${t.stone})` : ''}. A Fatline node keeps it warm; after three warm days it hatches into one of the 777 Fatliners. If the node stops, the egg dies.${asleep} https://fatline.ink`,
      ...(art.eggs?.[t.stone] ?? art.egg),
      external_url: surname ? `https://fatline.ink/f/${surname}` : 'https://fatline.ink',
      attributes: attrs,
    };
  writeFileSync(join(out, fid), JSON.stringify(meta, null, 2) + '\n');
  written++;
}
console.log(`wrote metadata for ${written} tokens to ${out}`);
