// The birth: what the holder of an egg needs to hatch it and then bring its coin into the world, from their own
// wallet, inside Farcaster or a browser. GET /api/birth/<fid>.
//
//   egg, not ready   its warmth (the client shows the usual status)
//   egg, ready       the hatch transaction (every attester's signature, gathered by a hatchery: /eggs/<fid>/hatch)
//   Fatliner         its being; the coin's launch transaction (or the coin, once it exists)
// Anyone can read it; only the holder's wallet can send the coin's launch, and the contract checks that.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { ROOT } from './config.mjs';

const nftAbi = parseAbi([
  'function stageOf(uint256) view returns (uint8)',
  'function ownerOf(uint256) view returns (address)',
  'function surnameOf(uint256) view returns (string)',
  'function stoneOf(uint256) view returns (uint8)',
  'function coinOfFatliner(uint256) view returns (address)',
  'function vaultOfFatliner(uint256) view returns (address)',
  'function predictFatlinerVault(uint256) view returns (address)',
]);
const STONES = ['ivory', 'marble', 'sandstone', 'basalt', 'moss', 'gold', 'opal'];
const ZERO = '0x0000000000000000000000000000000000000000';
const factoryAbi = parseAbi([
  'struct AppParams { address owner; address keeper; uint256 billingPeriod; string uri; bytes32 salt; }',
  'function launchFatline(uint256 fid, AppParams p, bytes deployCalldata, uint256 deposit) payable returns (address vault, address coin)',
]);

// Art lives on Arweave; this server keeps its own copy and serves it (GET /api/art/<id>), so the moment never waits
// on a gateway (some networks never reach arweave.net's redirect).
const local = (url) => {
  const id = String(url ?? '').match(/^https:\/\/arweave\.net\/([\w-]{43})$/)?.[1];
  return id ? `/api/art/${id}` : url;
};

export function artOf(fid, stone, art = JSON.parse(readFileSync(join(ROOT, 'apps/site/fatliners-art.json'), 'utf8'))) {
  const egg = (art.eggs?.[stone] ?? art.egg).image, being = art.beings?.[fid]?.image ?? null;
  return { egg: local(egg), being: being && local(being), arweave: { egg, being } };
}

/** The art this server serves: only ids listed in fatliners-art.json, fetched once from Arweave, kept in dataDir/art. */
export function makeArt({ dataDir, fetchImpl = fetch }) {
  const known = () => new Set(JSON.stringify(JSON.parse(readFileSync(join(ROOT, 'apps/site/fatliners-art.json'), 'utf8'))).match(/[\w-]{43}/g));
  const pending = new Map();
  return async function art(id) {
    if (!known().has(id)) throw Object.assign(new Error('Not a Fatliner picture.'), { status: 404 });
    const dir = join(dataDir, 'art');
    const file = join(dir, id);
    if (!existsSync(file)) {
      if (!pending.has(id)) {
        pending.set(id, (async () => {
          const r = await fetchImpl(`https://arweave.net/${id}`, { signal: AbortSignal.timeout(60_000) });
          if (!r.ok) throw Object.assign(new Error(`Arweave answered ${r.status}.`), { status: 502 });
          mkdirSync(dir, { recursive: true });
          writeFileSync(`${file}.tmp`, Buffer.from(await r.arrayBuffer()));
          writeFileSync(`${file}.type`, r.headers.get('content-type') ?? 'application/octet-stream');
          renameSync(`${file}.tmp`, file);
        })().finally(() => pending.delete(id)));
      }
      await pending.get(id);
    }
    return { file, type: readFileSync(`${file}.type`, 'utf8') };
  };
}

/** Coin images: the 1:1 icon and the 3:1 banner, if they were made (apps/site/img/coin/<surname>-*.jpg). */
export function coinImages(surname) {
  const name = String(surname).toLowerCase();
  const out = {};
  for (const kind of ['icon', 'banner', 'banner-3x2']) {
    try { readFileSync(join(ROOT, `apps/site/img/coin/${name}-${kind}.jpg`)); out[kind] = `https://fatline.ink/img/coin/${name}-${kind}.jpg`; } catch { /* not made yet */ }
  }
  return out;
}

export function makeBirth({ config, client, contract, hatcheries, plan, fetchImpl = fetch }) {
  const read = (functionName, fid) => client.readContract({ address: contract, abi: nftAbi, functionName, args: [BigInt(fid)] });

  async function hatchOf(fid) {
    let last = null;
    for (const a of await hatcheries()) {
      try {
        const r = await fetchImpl(`${String(a.url).replace(/\/$/, '')}/eggs/${fid}/hatch`, { signal: AbortSignal.timeout(20_000) });
        const body = await r.json();
        if (r.ok) return body;
        last = body.error;
      } catch (err) { last = err.message; }
    }
    return { ready: false, error: last ?? 'No hatchery answered.' };
  }

  return async function birth(fid) {
    fid = Number(fid);
    if (!Number.isInteger(fid) || fid <= 0) throw Object.assign(new Error('Which egg?'), { status: 400 });
    if (!contract) throw Object.assign(new Error('No Fatliners contract here.'), { status: 503 });
    const stage = ['none', 'egg', 'fatliner'][Number(await read('stageOf', fid).catch(() => 0))] ?? 'none';
    if (stage === 'none') return { fid, stage };
    const [holder, surname, stoneN] = await Promise.all([read('ownerOf', fid), read('surnameOf', fid), read('stoneOf', fid).catch(() => 0)]);
    const stone = STONES[Number(stoneN)] ?? 'ivory';
    const g = config.deployments?.Fatliners?.genesis;
    const titled = surname.charAt(0) + surname.slice(1).toLowerCase();
    const name = g && Number(g.fid) === fid ? `${g.name} ${titled}` : titled;
    const vault = await read('predictFatlinerVault', fid).catch(() => null);
    const out = { fid, stage, name, holder, surname, stone, vault, chainId: client.chain?.id ?? 8453, art: artOf(fid, stone), images: coinImages(surname) };
    if (stage === 'egg') {
      const h = await hatchOf(fid);
      return { ...out, hatch: { ready: Boolean(h.ready), signatures: h.signatures ?? 0, threshold: h.threshold ?? null, attesters: h.attesters ?? [], tx: h.tx ?? null, error: h.error ?? null } };
    }
    const coin = await read('coinOfFatliner', fid).catch(() => ZERO);
    if (coin !== ZERO) return { ...out, coin: { address: coin, vault: await read('vaultOfFatliner', fid) } };
    try {
      const p = await plan(config, { fid });
      const data = encodeFunctionData({ abi: factoryAbi, functionName: 'launchFatline', args: [BigInt(p.fid), p.params, p.launch.data, 0n] });
      return { ...out, launch: { to: p.factory, data, value: String(p.launch.value ?? 0n), name: p.name, ticker: p.ticker, vault: p.vault, coin: p.launch.expectedToken ?? null, payee: p.keeper, image: p.image } };
    } catch (err) {
      return { ...out, launch: null, launchError: err.shortMessage ?? err.message };
    }
  };
}
