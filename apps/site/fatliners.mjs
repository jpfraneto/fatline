// Writes the token metadata the Fatliners contract points to: tokenURI(fid) = https://fatline.ink/fatliners/<fid>.
// The site is static, so the site's workflow runs this every 15 minutes: it reads every egg taken and every
// Fatliner born from the contract's events on Base and writes one JSON file per token (no extension, as the
// contract's URI has none). An egg shows the egg coming alive under the arch; a Fatliner shows its being.
// Usage: node apps/site/fatliners.mjs [out-dir]   (no dependencies: plain JSON-RPC)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    found.push(...await rpc('eth_getLogs', [{ address: contract, topics: [topic], fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }]));
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

const tokens = new Map(); // fid -> { dna, laidAt, surname? }
for (const l of await logs(EGG_TAKEN)) tokens.set(tokenId(l), { dna: word(l.data, 0), laidAt: Number(BigInt(word(l.data, 1))) });
for (const l of await logs(BORN)) tokens.set(tokenId(l), { ...tokens.get(tokenId(l)), dna: word(l.data, 1), born: true });
// Genesis is born in the constructor, before any event can be read with its egg: always include it.
const g = deployments.Fatliners.genesis;
tokens.set(String(g.fid), { ...tokens.get(String(g.fid)), dna: g.dna, laidAt: g.laidAt, born: true });

mkdirSync(out, { recursive: true });
for (const [fid, t] of tokens) {
  const attrs = [{ trait_type: 'FID', value: Number(fid), display_type: 'number' }, { trait_type: 'DNA', value: t.dna }];
  let meta;
  if (t.born) {
    const surname = decodeString(await rpc('eth_call', [{ to: contract, data: SURNAME_OF + BigInt(fid).toString(16).padStart(64, '0') }, 'latest']));
    const a = art.beings[fid] ?? art.unrevealedBeing ?? art.egg;
    meta = {
      name: fid === String(g.fid) ? `${g.name} ${surname}` : `${surname} · Fatliner #${fid}`,
      description: fid === String(g.fid)
        ? `The genesis Fatliner, the one that starts it all: Farcaster account #${fid}, born when the Fatliners contract was deployed. Every resale of any Fatliner pays its vault. Its surname, ${surname}, was read from its DNA and is the ticker of the first coin. https://fatline.ink/f/${surname}`
        : `One of the 777 Fatliners: it hatched from the egg of Farcaster account #${fid} after its Fatline server kept it warm for three days. Its surname, ${surname}, was read from its DNA and is its coin's ticker. https://fatline.ink/f/${surname}`,
      image: a.image, ...(a.animation_url ? { animation_url: a.animation_url } : {}),
      external_url: `https://fatline.ink/f/${surname}`,
      attributes: [{ trait_type: 'Stage', value: 'Fatliner' }, { trait_type: 'Surname', value: surname }, ...attrs],
    };
  } else {
    meta = {
      name: `Egg #${fid}`,
      description: `The egg of Farcaster account #${fid}. It holds the account's history (its DNA) and cannot be moved. A Fatline server keeps it warm; after three warm days it hatches into one of the 777 Fatliners. https://fatline.ink/manifesto.html`,
      ...(art.eggs?.[t.stone] ?? art.egg),
      external_url: 'https://fatline.ink/manifesto.html',
      attributes: [{ trait_type: 'Stage', value: 'Egg' }, ...attrs],
    };
  }
  writeFileSync(join(out, fid), JSON.stringify(meta, null, 2) + '\n');
}
console.log(`wrote metadata for ${tokens.size} tokens to ${out}`);
