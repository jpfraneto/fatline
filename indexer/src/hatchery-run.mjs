// fatline hatchery: run an attester.
//
//   fatline hatchery install  put the hatchery on your rented server, next to its node (over SSH)
//   fatline hatchery init     make this attester's key (.fatline/attester.key, mode 600) and show its address
//   fatline hatchery          serve eggs on :8791 and check them every hour
//
// Config (fatline.config.json → "hatchery"), all optional:
//   port        8791
//   chainId     8453 (Base)
//   contract    the Fatliners address (Hatches are signed for it; null until it is deployed)
//   rpc         for the relay: https://mainnet.base.org
//   relay       true: submit mints for people, paying the gas from the attester's key
//   reference   { farcaster: url, hypersnap: url }: this attester's own nodes (default: localhost 3381 / 4381)
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, http, parseAbi, recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, foundry } from 'viem/chains';
import { loadConfig } from './config.mjs';
import { eggTypes, hatchDomain, hatchTypes } from './egg.mjs';
import { Hatchery } from './hatchery.mjs';

export const fatlinersAbi = parseAbi([
  'function takeEgg((uint256 fid, address to, address server, string url, bytes32 dna, uint64 laidAt, uint256 deadline) e, bytes[] signatures)',
  'function hatch((uint256 fid, string surname, uint256 deadline) h, bytes[] signatures)',
  'function stageOf(uint256) view returns (uint8)',
  'function serverOf(uint256) view returns (address)',
  'function isFatliner(uint256) view returns (bool)',
  'function surnameOf(uint256) view returns (string)',
  'function genesisFid() view returns (uint256)',
  'function hatcheries() view returns (address[] who, string[] urls)',
  'function attesters() view returns (address[])',
  'function threshold() view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
]);

export function hatcheryConfig(config) {
  const h = config.hatchery ?? {};
  return {
    port: Number(process.env.HATCHERY_PORT ?? h.port ?? 8791),
    chainId: Number(process.env.FATLINERS_CHAIN_ID ?? h.chainId ?? 8453),
    contract: process.env.FATLINERS_ADDRESS ?? h.contract ?? null,
    rpc: process.env.FATLINERS_RPC ?? h.rpc ?? 'https://mainnet.base.org',
    relay: process.env.HATCHERY_RELAY ? process.env.HATCHERY_RELAY === '1' : Boolean(h.relay),
    reference: h.reference ?? { farcaster: 'http://127.0.0.1:3381', hypersnap: 'http://127.0.0.1:4381' },
    attesters: h.attesters ?? [],
    dayMs: Number(process.env.HATCHERY_DAY_MS ?? h.dayMs ?? 24 * 3_600_000), // shorter only for tests
    checkEveryMs: Number(process.env.HATCHERY_CHECK_MS ?? h.checkEveryMs ?? 3_600_000),
  };
}

const chainOf = (id) => ({ 8453: base, 84532: baseSepolia, 31337: foundry })[id] ?? { ...base, id };
const keyPath = (dataDir) => join(dataDir, 'attester.key');

function loadKey(dataDir) {
  const p = keyPath(dataDir);
  if (!existsSync(p)) throw new Error('No attester key yet. Run: fatline hatchery init');
  return readFileSync(p, 'utf8').trim();
}

/** The history commitment at the egg's cutoff, read from this attester's own nodes. */
function dnaFrom(config, reference) {
  return async (fid, snapshotAt) => {
    const { historyFromNodes } = await import('../../fatliners/src/sources/node.mjs');
    const { commitment } = await import('../../fatliners/src/history.mjs');
    // The same archive the backfill writes to: this attester's data folder.
    const got = await historyFromNodes(fid, { config, dbPath: join(config.dataDir, 'indexer.sqlite'), snapshotAt, overrides: reference });
    if (got.state === 'unavailable' || got.state === 'account-not-found') throw new Error(`history: ${got.state}`);
    return commitment(got.history);
  };
}

/** Puts the signatures in the order the contract wants (by signer, ascending), keeping only real attesters. */
export async function orderSignatures(message, contract, sigs, attesters, kind = 'Hatch') {
  const types = kind === 'Egg' ? eggTypes : hatchTypes;
  const allowed = new Set(attesters.map((a) => a.toLowerCase()));
  const seen = new Map();
  for (const s of sigs) {
    const signer = await recoverTypedDataAddress({ domain: hatchDomain(contract), types, primaryType: kind, message, signature: s.signature }).catch(() => null);
    if (signer && allowed.has(signer.toLowerCase())) seen.set(signer.toLowerCase(), s.signature);
  }
  return [...seen.entries()].sort(([a], [b]) => (BigInt(a) < BigInt(b) ? -1 : 1));
}

/** Is this FID's Fatliner already born? (No contract: never.) */
export function bornCheck(hc) {
  if (!hc.contract) return async () => false;
  const reader = createPublicClient({ chain: chainOf(hc.chainId), transport: http(hc.rpc) });
  return (fid) => reader.readContract({ address: hc.contract, abi: fatlinersAbi, functionName: 'isFatliner', args: [BigInt(fid)] }).catch(() => false);
}

const toHatch = (m) => ({ fid: BigInt(m.fid), surname: m.surname, deadline: BigInt(m.deadline) });
const toEgg = (m) => ({ fid: BigInt(m.fid), to: m.to, server: m.server, url: m.url, dna: m.dna, laidAt: BigInt(m.laidAt), deadline: BigInt(m.deadline) });

/** Every attester and its hatchery URL, from the one Fatliners contract. Without a contract: the config's list. */
export function attesterList(hc) {
  if (!hc.contract) return async () => hc.attesters.map((a) => (typeof a === 'string' ? { address: '', url: a } : { address: a.address ?? '', url: a.url }));
  const reader = createPublicClient({ chain: chainOf(hc.chainId), transport: http(hc.rpc) });
  let cache = null, at = 0;
  return async () => {
    if (cache && Date.now() - at < 60_000) return cache;
    const [who, urls] = await reader.readContract({ address: hc.contract, abi: fatlinersAbi, functionName: 'hatcheries' });
    cache = who.map((address, i) => ({ address, url: urls[i] }));
    at = Date.now();
    return cache;
  };
}

async function serve() {
  const config = loadConfig();
  const hc = hatcheryConfig(config);
  const privateKey = loadKey(config.dataDir);
  const contract = { chainId: hc.chainId, address: hc.contract };
  const hatchery = new Hatchery({ config, privateKey, contract, reference: hc.reference, dataDir: config.dataDir,
    computeDna: dnaFrom(config, hc.reference), listAttesters: attesterList(hc), isBorn: bornCheck(hc), dayMs: hc.dayMs, checkEveryMs: hc.checkEveryMs });
  const chain = chainOf(hc.chainId);
  const reader = createPublicClient({ chain, transport: http(hc.rpc) });
  const wallet = createWalletClient({ account: privateKeyToAccount(privateKey), chain, transport: http(hc.rpc) });

  /** Submits a takeEgg ('Egg') or a hatch ('Hatch'): this attester's signature plus those sent, sorted. */
  async function relay(fid, body, kind) {
    if (!hc.relay) throw Object.assign(new Error('This attester does not submit transactions.'), { status: 404 });
    if (!hc.contract) throw Object.assign(new Error('Fatliners is not deployed yet.'), { status: 409 });
    const own = hatchery.status(fid);
    const mine = kind === 'Egg' ? own?.egg : own?.hatch;
    if (!mine) throw Object.assign(new Error(kind === 'Egg' ? 'This attester has not signed that egg (its DNA may still be read).' : 'This attester has not seen that egg hatch.'), { status: 409 });
    const read = (functionName, args = []) => reader.readContract({ address: hc.contract, abi: fatlinersAbi, functionName, args });
    const [stage, server] = await Promise.all([read('stageOf', [BigInt(fid)]), read('serverOf', [BigInt(fid)])]);
    if (Number(stage) === 2) throw Object.assign(new Error(`Already born. Fatliner #${fid} hatched as $${await read('surnameOf', [BigInt(fid)])}.`), { status: 409 });
    if (kind === 'Egg' && Number(stage) === 1 && server.toLowerCase() === mine.message.server.toLowerCase()) {
      throw Object.assign(new Error(`Egg #${fid} is already onchain, kept warm by this server.`), { status: 409 });
    }
    if (kind === 'Hatch' && Number(stage) !== 1) throw Object.assign(new Error(`Egg #${fid} is not onchain yet: fatline egg take`), { status: 409 });
    const message = kind === 'Egg' ? toEgg(mine.message) : toHatch(mine.message);
    const [attesters, threshold] = await Promise.all([read('attesters'), read('threshold')]);
    const ordered = await orderSignatures(message, contract, [mine, ...(body?.signatures ?? [])], attesters, kind);
    if (BigInt(ordered.length) < threshold) {
      throw Object.assign(new Error(`${ordered.length} of the ${threshold} attester signatures needed.`), { status: 409 });
    }
    const hash = await wallet.writeContract({ address: hc.contract, abi: fatlinersAbi, functionName: kind === 'Egg' ? 'takeEgg' : 'hatch', args: [message, ordered.map(([, sig]) => sig)] });
    const receipt = await reader.waitForTransactionReceipt({ hash });
    return { tx: hash, status: receipt.status, signers: ordered.map(([a]) => a) };
  }

  const routes = [
    ['GET', /^\/$/, () => hatchery.info()],
    ['GET', /^\/eggs\/(\d{1,12})$/, (m) => hatchery.status(m[1]) ?? Promise.reject(Object.assign(new Error('No egg for that FID here.'), { status: 404 }))],
    ['POST', /^\/eggs$/, (m, body) => hatchery.lay(body)],
    ['POST', /^\/eggs\/(\d{1,12})\/take$/, (m, body) => relay(Number(m[1]), body, 'Egg')],
    ['POST', /^\/eggs\/(\d{1,12})\/hatch$/, (m, body) => relay(Number(m[1]), body, 'Hatch')],
  ];
  const server = createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') return res.end();
    const path = new URL(req.url, 'http://x').pathname;
    const route = routes.find(([m, re]) => m === req.method && re.test(path));
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj, null, 1)); };
    if (!route) return send(404, { error: 'Not found.' });
    try {
      let body = null;
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 20_000) throw Object.assign(new Error('Too big.'), { status: 413 }); }
        body = raw ? JSON.parse(raw) : {};
      }
      send(200, await route[2](path.match(route[1]), body));
    } catch (err) {
      send(err.status ?? 500, { error: err.message });
    }
  });
  server.listen(hc.port, () => {
    console.log(`Hatchery on :${hc.port}. Attester ${hatchery.address}. Fatliners ${hc.contract ?? '(not deployed: Hatches are signed for address null)'} on chain ${hc.chainId}.`);
    console.log(`Checks every ${hc.checkEveryMs / 60_000} min against ${JSON.stringify(hc.reference)}. Relay ${hc.relay ? 'on' : 'off'}.`);
  });
  const loop = async () => { try { await hatchery.tick(); } catch (err) { console.log(`[hatchery] tick failed: ${err.message}`); } };
  loop();
  setInterval(loop, Math.min(5 * 60_000, hc.checkEveryMs / 4));
}

async function init() {
  const config = loadConfig();
  const p = keyPath(config.dataDir);
  if (existsSync(p)) {
    console.log(`This attester already has a key: ${privateKeyToAccount(loadKey(config.dataDir)).address}`);
    return;
  }
  writeFileSync(p, `${generatePrivateKey()}\n`, { mode: 0o600 });
  chmodSync(p, 0o600);
  console.log(`Attester key made: ${p} (mode 600, never committed).`);
  console.log(`Address: ${privateKeyToAccount(loadKey(config.dataDir)).address}`);
  console.log('This address goes into the Fatliners contract\'s attester list when it is deployed.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  const install = async () => {
    const { installHatchery } = await import('../../infra/hatchery-remote.mjs');
    const i = process.argv.indexOf('--ip');
    const hc = hatcheryConfig(loadConfig());
    installHatchery({ ip: i > 0 ? process.argv[i + 1] : undefined, env: { FATLINERS_ADDRESS: hc.contract, FATLINERS_CHAIN_ID: hc.chainId, FATLINERS_RPC: hc.rpc } });
  };
  (cmd === 'init' ? init() : cmd === 'install' ? install() : serve()).catch((err) => { console.error(err.message); process.exit(1); });
}
