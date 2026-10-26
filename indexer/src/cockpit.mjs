// The cockpit: everything a person needs to know about their own Fatline, in one answer.
//   who      their FID (from the app key or `fatline connect`), name and picture when the node can say
//   nodes    each of their nodes: answering?, in sync?, how far behind, and how fast it is catching up
//   token    their egg or Fatliner on Base: stage, stone, surname, asleep, hibernation; and the 777 count
//   hatch    what the hatcheries see: warm days so far, today's checks, the last check
// Read-only. Every part fails on its own: a syncing node or a slow RPC leaves that part empty, with why.
import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { loadIdentity } from './connect.mjs';
import { attesterList, hatcheryConfig } from './hatchery-run.mjs';
import { loadAppKey } from './writer.mjs';

const STONES = ['ivory', 'marble', 'sandstone', 'basalt', 'moss', 'gold', 'opal'];
const STAGES = ['none', 'egg', 'fatliner'];
const abi = parseAbi([
  'function stageOf(uint256) view returns (uint8)',
  'function stoneOf(uint256) view returns (uint8)',
  'function surnameOf(uint256) view returns (string)',
  'function laidAtOf(uint256) view returns (uint64)',
  'function ownerOf(uint256) view returns (address)',
  'function isAsleep(uint256) view returns (bool)',
  'function hibernatingUntil(uint256) view returns (uint256)',
  'function liveEggs() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function maxSupply() view returns (uint256)',
  'function appOf(uint256) view returns (address)',
  'function genesisFid() view returns (uint256)',
  'function genesisTo() view returns (address)',
]);

// How fast each node is catching up: its block delay over the last half hour.
const samples = new Map(); // url -> [{ at, delay }]
function catchUp(url, delay) {
  const now = Date.now();
  const list = (samples.get(url) ?? []).filter((s) => now - s.at < 30 * 60_000);
  if (Number.isFinite(delay)) list.push({ at: now, delay });
  samples.set(url, list);
  const first = list[0], last = list.at(-1);
  if (!first || last.at - first.at < 60_000) return null;
  const perMin = (first.delay - last.delay) / ((last.at - first.at) / 60_000);
  return { blocksPerMinute: Math.round(perMin), etaMinutes: perMin > 0 ? Math.round(last.delay / perMin) : null };
}

export function makeCockpit({ config, networks, api, fetchImpl = fetch }) {
  const hc = hatcheryConfig(config);
  const reader = hc.contract ? createPublicClient({ chain: base, transport: http(hc.rpc) }) : null;
  const attesters = attesterList(hc);
  let tokenCache = { at: 0, fid: null, value: null };

  async function who(fallbackFid) {
    const key = loadAppKey(config.dataDir);
    const id = loadIdentity(config);
    const fid = Number(key?.fid ?? id?.fid ?? fallbackFid ?? 0) || null;
    if (!fid) return { fid: null, canWrite: false };
    let profile = null;
    for (const n of Object.values(networks)) {
      profile = await api.user(n, fid).catch(() => null);
      if (profile?.username) break;
    }
    return { fid, canWrite: Boolean(key), username: profile?.username ?? null, displayName: profile?.displayName ?? null, pfp: profile?.pfp ?? null };
  }

  async function nodes() {
    const out = [];
    for (const n of Object.values(networks)) {
      const mine = n.nodes.filter((x) => x.own);
      for (const node of (mine.length ? mine : n.nodes.slice(0, 1))) {
        const s = await n.checkNode?.(node).catch(() => null) ?? node.status ?? {};
        const delay = Number.isFinite(Number(s.blockDelay)) ? Number(s.blockDelay) : null;
        out.push({
          network: n.name, label: n.label, url: node.url, own: Boolean(node.own),
          answering: !s.error && delay !== null, error: s.error ?? null,
          blocksBehind: delay, synced: Boolean(s.ok), messages: s.messages ?? null, version: s.version ?? null,
          sizeBytes: s.approxSizeBytes ?? null, checkedAt: s.checkedAt ?? null, ...(catchUp(node.url, delay) ?? {}),
        });
      }
    }
    return out;
  }

  async function token(fid) {
    if (!reader || !fid) return { contract: hc.contract, stage: 'none' };
    if (tokenCache.fid === fid && Date.now() - tokenCache.at < 30_000) return tokenCache.value;
    const id = BigInt(fid);
    const read = (functionName, args = [id]) => reader.readContract({ address: hc.contract, abi, functionName, args }).catch(() => undefined);
    const [stage, stone, surname, laidAt, owner, asleep, hibernating, liveEggs, totalSupply, maxSupply, app, genesisFid, genesisTo] = await Promise.all([
      read('stageOf'), read('stoneOf'), read('surnameOf'), read('laidAtOf'), read('ownerOf'), read('isAsleep'), read('hibernatingUntil'),
      read('liveEggs', []), read('totalSupply', []), read('maxSupply', []), read('appOf'), read('genesisFid', []), read('genesisTo', []),
    ]);
    const value = {
      contract: hc.contract, chainId: hc.chainId,
      stage: STAGES[Number(stage ?? 0)] ?? 'none', readError: stage === undefined ? 'Could not read Base right now.' : null,
      stone: stone !== undefined && Number(stage ?? 0) > 0 ? STONES[Number(stone)] ?? null : null,
      surname: surname || null, laidAt: laidAt ? Number(laidAt) : null, owner: owner ?? null, asleep: asleep ?? null,
      hibernatingUntil: hibernating ? Number(hibernating) : null,
      app: app && !/^0x0{40}$/i.test(app) ? app : null,
      genesis: genesisFid !== undefined && Number(genesisFid) === Number(fid) ? { to: genesisTo ?? null } : null,
      slots: { eggs: liveEggs !== undefined ? Number(liveEggs) : null, fatliners: totalSupply !== undefined ? Number(totalSupply) : null, max: maxSupply !== undefined ? Number(maxSupply) : 777 },
    };
    tokenCache = { at: Date.now(), fid, value };
    return value;
  }

  async function hatch(fid) {
    if (!fid) return null;
    const list = await attesters().catch(() => []);
    for (const a of list) {
      try {
        const res = await fetchImpl(`${a.url.replace(/\/$/, '')}/eggs/${fid}`, { signal: AbortSignal.timeout(6_000) });
        if (!res.ok) continue;
        const e = await res.json();
        const today = e.days?.at(-1) ?? null;
        return { hatchery: a.url, warmDays: e.warmDays, needed: e.needed, days: e.days, today, recent: e.recent, laidAt: e.laidAt, hatched: e.hatched, node: e.node, network: e.network };
      } catch { /* the next attester */ }
    }
    return { hatchery: null, warmDays: 0, needed: 3, days: [], today: null, recent: [], none: true, attesters: list.length };
  }

  // fallbackFid: whose place this is when this client has no key yet (FATLINE_OWNER_FID on a server).
  return async function cockpit(fallbackFid = null) {
    const me = await who(fallbackFid);
    const [ns, tk, ht] = await Promise.all([nodes().catch((e) => ({ error: e.message })), token(me.fid).catch((e) => ({ error: e.message })), hatch(me.fid).catch(() => null)]);
    return { me, nodes: ns, token: tk, hatch: ht, at: Date.now() };
  };
}
