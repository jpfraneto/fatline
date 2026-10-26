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
//   reference   { farcaster: url, hypersnap: url }: this attester's own nodes (default: localhost 3381 / 4381;
//               env HATCHERY_FARCASTER_NODE / HATCHERY_HYPERSNAP_NODE override)
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, fallback, http, parseAbi, recoverTypedDataAddress, keccak256, toBytes } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, foundry } from 'viem/chains';
import { loadConfig } from './config.mjs';
import { eggTypes, hatchDomain, hatchTypes } from './egg.mjs';
import { Hatchery } from './hatchery.mjs';
import { EVERY_MS, World } from './world.mjs';

export const fatlinersAbi = parseAbi([
  'function takeEgg((uint256 fid, address to, address server, string url, bytes32 dna, uint64 laidAt, string surname, uint8 stone, uint256 deadline) e, bytes[] signatures, uint256 position, bytes32[] proof)',
  'function fidOfSurname(bytes32) view returns (uint256)',
  'error SurnameTaken()',
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
    // Empty env values (a service file with nothing set) fall through to the config, which defaults to the
    // one deployment in smart-contracts/deployments/base.json.
    chainId: Number(process.env.FATLINERS_CHAIN_ID || h.chainId || 8453),
    contract: process.env.FATLINERS_ADDRESS || h.contract || null,
    rpc: process.env.FATLINERS_RPC || h.rpc || 'https://mainnet.base.org',
    relay: process.env.HATCHERY_RELAY ? process.env.HATCHERY_RELAY === '1' : Boolean(h.relay),
    // In a container, this server's nodes are not on 127.0.0.1: HATCHERY_FARCASTER_NODE / HATCHERY_HYPERSNAP_NODE.
    reference: {
      ...(h.reference ?? { farcaster: 'http://127.0.0.1:3381', hypersnap: 'http://127.0.0.1:4381' }),
      ...(process.env.HATCHERY_FARCASTER_NODE ? { farcaster: process.env.HATCHERY_FARCASTER_NODE } : {}),
      ...(process.env.HATCHERY_HYPERSNAP_NODE ? { hypersnap: process.env.HATCHERY_HYPERSNAP_NODE } : {}),
    },
    attesters: h.attesters ?? [],
    dayMs: Number(process.env.HATCHERY_DAY_MS ?? h.dayMs ?? 24 * 3_600_000), // shorter only for tests
    checkEveryMs: Number(process.env.HATCHERY_CHECK_MS ?? h.checkEveryMs ?? 3_600_000),
  };
}

const chainOf = (id) => ({ 8453: base, 84532: baseSepolia, 31337: foundry })[id] ?? { ...base, id };
const keyPath = (dataDir) => join(dataDir, 'attester.key');
/** The key that owns Fatline's app account: app-custody.key once its custody moved off the attester key (so a person
 *  can sign in to it with a recovery phrase), else the attester key itself. Read each time: dropping it in needs no restart. */
export function appCustodyKey(dataDir) {
  const p = join(dataDir, 'app-custody.key');
  const k = existsSync(p) ? readFileSync(p, 'utf8').trim() : loadKey(dataDir);
  return k.startsWith('0x') ? k : `0x${k}`;
}

function loadKey(dataDir) {
  const p = keyPath(dataDir);
  if (!existsSync(p)) throw new Error('No attester key yet. Run: fatline hatchery init');
  return readFileSync(p, 'utf8').trim();
}

/** The history commitment at the egg's cutoff, and the egg's stone from that same history, read from this attester's own nodes. */
function dnaFrom(config, reference) {
  return async (fid, snapshotAt) => {
    const { historyFromNodes } = await import('../../fatliners/src/sources/node.mjs');
    const { commitment } = await import('../../fatliners/src/history.mjs');
    // The same archive the backfill writes to: this attester's data folder.
    const got = await historyFromNodes(fid, { config, dbPath: join(config.dataDir, 'indexer.sqlite'), snapshotAt, overrides: reference });
    if (got.state === 'unavailable' || got.state === 'account-not-found') throw new Error(`history: ${got.state}`);
    const { extractFeatures } = await import('../../fatliners/src/features.mjs');
    const { networkEvidence, rootsMaterial, STONES } = await import('../../fatliners/src/pfp/traits.mjs');
    const { loadCalibration } = await import('../../fatliners/src/pfp/pipeline.mjs');
    const history = got.history;
    const network = networkEvidence(history, [...new Set((got.sources ?? []).map((s) => s.network))]);
    const messages = history.messages.filter((m) => m.kind !== 'link').length;
    const material = rootsMaterial({ features: extractFeatures(history), network, coverage: { messages }, calibration: loadCalibration() });
    return { dna: commitment(history), stone: Math.max(0, STONES.indexOf(material)) };
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

/** Which FID holds this surname onchain (0: free). No two eggs share one, so no two coins share a ticker. */
export function surnameCheck(hc) {
  if (!hc.contract) return async () => 0;
  const reader = createPublicClient({ chain: chainOf(hc.chainId), transport: http(hc.rpc) });
  return (name) => reader.readContract({ address: hc.contract, abi: fatlinersAbi, functionName: 'fidOfSurname', args: [keccak256(toBytes(name))] });
}

/** Is this FID's Fatliner already born? (No contract: never.) */
export function bornCheck(hc) {
  if (!hc.contract) return async () => false;
  const reader = createPublicClient({ chain: chainOf(hc.chainId), transport: http(hc.rpc) });
  return (fid) => reader.readContract({ address: hc.contract, abi: fatlinersAbi, functionName: 'isFatliner', args: [BigInt(fid)] }).catch(() => false);
}

const toHatch = (m) => ({ fid: BigInt(m.fid), surname: m.surname, deadline: BigInt(m.deadline) });
const toEgg = (m) => ({ fid: BigInt(m.fid), to: m.to, server: m.server, url: m.url, dna: m.dna, laidAt: BigInt(m.laidAt), surname: m.surname, stone: Number(m.stone ?? 0), deadline: BigInt(m.deadline) });

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
    computeDna: dnaFrom(config, hc.reference), listAttesters: attesterList(hc), isBorn: bornCheck(hc), dayMs: hc.dayMs, checkEveryMs: hc.checkEveryMs,
    surnameTaken: surnameCheck(hc) });
  const chain = chainOf(hc.chainId);
  const reader = createPublicClient({ chain, transport: http(hc.rpc) });
  const wallet = createWalletClient({ account: privateKeyToAccount(privateKey), chain, transport: http(hc.rpc) });

  /** Submits a takeEgg ('Egg') or a hatch ('Hatch'): this attester's signature plus those sent, sorted. */
  async function relay(fid, body, kind, { self = false } = {}) {
    if (!hc.relay && !self) throw Object.assign(new Error('This attester does not submit transactions.'), { status: 404 });
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
    let hash;
    try {
      hash = await wallet.writeContract({ address: hc.contract, abi: fatlinersAbi, functionName: kind === 'Egg' ? 'takeEgg' : 'hatch', args: kind === 'Egg' ? [message, ordered.map(([, sig]) => sig), BigInt(body?.position ?? 0), body?.proof ?? []] : [message, ordered.map(([, sig]) => sig)] });
    } catch (err) {
      // Another egg took this surname first: sign again with the next free one, and say to retry.
      if (kind === 'Egg' && /SurnameTaken/.test(String(err.shortMessage ?? err.message) + String(err.cause?.data?.errorName ?? ''))) {
        const egg = hatchery.state.eggs[fid];
        egg.surname = null; egg.egg = null;
        await hatchery.signEgg(egg); hatchery.save();
        throw Object.assign(new Error('That surname was just taken by another egg. Signed again with the next one: fatline egg take'), { status: 409 });
      }
      throw err;
    }
    const receipt = await reader.waitForTransactionReceipt({ hash });
    return { tx: hash, status: receipt.status, signers: ordered.map(([a]) => a) };
  }

  // The world: this server's own copy of the Fatliners contract, read once an hour (indexer/src/world.mjs).
  const world = hc.contract ? new World({
    client: createPublicClient({ chain, transport: fallback([http(hc.rpc), ...(hc.chainId === 8453 ? [http('https://base-rpc.publicnode.com')] : [])]) }),
    address: hc.contract, chainId: hc.chainId, dataDir: config.dataDir,
    fromBlock: config.hatchery?.fromBlock ?? (config.deployments?.Fatliners?.address?.toLowerCase() === hc.contract.toLowerCase() ? config.deployments.fromBlock : 0),
  }) : null;
  const warmthOf = (fid) => {
    const w = hatchery.status(fid);
    if (!w) return null;
    const today = w.days?.at(-1);
    return { warmDays: w.warmDays, needed: w.needed, day: today?.day ?? null, passed: today?.passed ?? null, need: today?.need ?? null, since: w.layingAt ?? null, lastCheck: w.recent?.at(-1) ?? null, network: w.network, hatched: w.hatched ?? false };
  };
  const noWorld = () => Promise.reject(Object.assign(new Error('This hatchery has no contract to read.'), { status: 404 }));

  const routes = [
    ['GET', /^\/$/, () => hatchery.info()],
    ['GET', /^\/world$/, () => (world ? world.view(warmthOf) : noWorld())],
    ['GET', /^\/world\/events$/, (m, body, req) => (world ? { events: world.events(new URL(req.url, 'http://x').searchParams.get('limit')) } : noWorld())],
    ['GET', /^\/eggs\/(\d{1,12})$/, (m) => hatchery.status(m[1]) ?? Promise.reject(Object.assign(new Error('No egg for that FID here.'), { status: 404 }))],
    // Sign in with Farcaster: this server signs key requests as Fatline's app account (with its custody key, appCustodyKey).
    // The Farcaster app then shows the person what they approve, and adds the key itself.
    ['POST', /^\/signer-request$/, async (m, body) => {
      // Fatline's app account: from its key file on this server (app-account.mjs writes it), so no setting can lose it.
      let appFid = Number(process.env.FATLINE_APP_FID || 0);
      if (!appFid) try { appFid = Number(JSON.parse(readFileSync(join(config.dataDir, 'app-account.key.json'), 'utf8')).fid) || 0; } catch {}
      if (!appFid) throw Object.assign(new Error('Sign in with Farcaster is not set up on this server yet (no app account).'), { status: 503 });
      if (!/^0x[0-9a-fA-F]{64}$/.test(body?.key ?? '')) throw Object.assign(new Error('key: a 32-byte Ed25519 public key, 0x…'), { status: 400 });
      const { ViemLocalEip712Signer } = await import('@farcaster/core');
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const sig = await new ViemLocalEip712Signer(privateKeyToAccount(appCustodyKey(config.dataDir))).signKeyRequest({ requestFid: BigInt(appFid), key: Buffer.from(body.key.slice(2), 'hex'), deadline: BigInt(deadline) });
      if (sig.isErr()) throw new Error(sig.error.message);
      return { requestFid: appFid, deadline, signature: `0x${Buffer.from(sig.value).toString('hex')}` };
    }],
    // <surname>.fatline.ink → the server that runs that egg's node (read by the master's router, infra/names-router.mjs).
    ['GET', /^\/names$/, () => ({ domain: 'fatline.ink', names: hatchery.names() })],
    // Which name is mine? Matched against the address the request comes from, so ask this port directly (not through a proxy).
    ['GET', /^\/names\/mine$/, (m, body, req) => {
      const ip = String(req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
      const mine = hatchery.names().filter((n) => n.host === ip);
      if (!mine.length) throw Object.assign(new Error(`No egg here has its node at ${ip}. Lay your egg first (fatline egg), then ask again.`), { status: 404 });
      return { ip, names: mine.map((n) => ({ ...n, url: `https://${n.label}.fatline.ink` })) };
    }],
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
      send(200, await route[2](path.match(route[1]), body, req));
    } catch (err) {
      send(err.status ?? 500, { error: err.message });
    }
  });
  server.listen(hc.port, () => {
    console.log(`Hatchery on :${hc.port}. Attester ${hatchery.address}. Fatliners ${hc.contract ?? '(not deployed: Hatches are signed for address null)'} on chain ${hc.chainId}.`);
    console.log(`Checks every ${hc.checkEveryMs / 60_000} min against ${JSON.stringify(hc.reference)}. Relay ${hc.relay ? 'on' : 'off'}.`);
  });
  // The genesis egg (Aster) is kept warm by this very server, once its keeper has claimed it onchain. It has no claim
  // signed by an app key: its record starts at the claim, and its node is checked against an outside node (crackle),
  // not against itself. Three warm days and this attester signs its Hatch, like any other.
  const genesis = async () => {
    if (!hc.contract) return;
    const read = (functionName, args = []) => reader.readContract({ address: hc.contract, abi: fatlinersAbi, functionName, args });
    const fid = Number(await read('genesisFid'));
    if (hatchery.state.eggs[fid] || Number(await read('stageOf', [BigInt(fid)])) !== 1) return;
    const d = config.deployments?.Fatliners?.genesis ?? {};
    const to = (await read('ownerOf', [BigInt(fid)])).toLowerCase();
    const url = `http://${String(d.hatchery ?? 'http://46.225.208.199:8791').replace(/^https?:\/\//, '').split(':')[0]}`;
    hatchery.state.eggs[fid] = {
      claim: { fid, network: 'farcaster', node: `${url}:3381`, to, server: hatchery.address.toLowerCase(), hatchery: `${url}:8791`, at: Date.now(), reference: 'https://crackle.farcaster.xyz:3381', genesis: true },
      publicKey: null, signature: null, laidAt: Number(d.laidAt), dna: d.dna, surname: d.surname ?? 'FATLINE', stone: 5,
      egg: { genesis: true, onchain: true }, checks: [], hatch: null,
    };
    hatchery.save();
    console.log(`[hatchery] FID ${fid}: the genesis egg is onchain (held by ${to}); keeping it warm from now`);
  };
  // Aster's birth needs no one at a keyboard (owner's go, 2026-10-26): once this attester has signed its Hatch,
  // this server sends the hatch transaction itself (a little of the attester key's ETH), even with the relay off. Only the genesis egg.
  let born = false;
  const birth = async () => {
    if (born || !hc.contract) return;
    const fid = Number(await reader.readContract({ address: hc.contract, abi: fatlinersAbi, functionName: 'genesisFid' }));
    if (!hatchery.state.eggs[fid]?.claim?.genesis || !hatchery.state.eggs[fid]?.hatch) return; // only on the genesis server
    try {
      const r = await relay(fid, {}, 'Hatch', { self: true });
      born = r.status === 'success';
      console.log(`[hatchery] FID ${fid}: hatch sent, ${r.tx} (${r.status})`);
    } catch (err) {
      if (/Already born/.test(err.message)) { born = true; return; }
      throw err;
    }
  };
  const loop = async () => {
    try { await genesis(); } catch (err) { console.log(`[hatchery] genesis: ${err.shortMessage ?? err.message}`); }
    try { await hatchery.tick(); } catch (err) { console.log(`[hatchery] tick failed: ${err.message}`); }
    try { await birth(); } catch (err) { console.log(`[hatchery] birth: ${err.shortMessage ?? err.message}`); }
  };
  loop();
  setInterval(loop, Math.min(5 * 60_000, hc.checkEveryMs / 4));
  const read = async () => {
    try {
      const n = await world.sync();
      console.log(`[world] read to block ${world.get('block')}${n ? `: ${n} new events` : ''}`);
    } catch (err) {
      world.lastError = String(err.shortMessage ?? err.message).slice(0, 200);
      console.log(`[world] read failed, next hour again: ${world.lastError}`);
    }
  };
  if (world) { read(); setInterval(read, EVERY_MS); }
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
