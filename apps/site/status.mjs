// Checks every real Fatline's nodes and writes status.json for the home page.
// Runs in the site's GitHub workflow every 15 minutes (the page is https; the nodes speak plain http,
// so the browser can't ask them itself). Usage: node apps/site/status.mjs [out-file]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, 'status.json');
const { fatlines, prices } = JSON.parse(readFileSync(join(here, 'fatlines.json'), 'utf8'));

async function get(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function profile(fid, nodes) {
  for (const n of nodes) {
    const r = await get(`${n.url}/v1/userDataByFid?fid=${fid}`);
    if (!r?.messages) continue;
    const p = { fid };
    for (const m of r.messages) {
      const { type, value } = m.data?.userDataBody ?? {};
      if (type === 'USER_DATA_TYPE_USERNAME') p.username = value;
      if (type === 'USER_DATA_TYPE_DISPLAY') p.displayName = value;
      if (type === 'USER_DATA_TYPE_PFP') p.pfp = value;
    }
    return { ...p, readFrom: n.network };
  }
  return { fid };
}

// The server a Fatline runs on: its fixed specs, its live numbers (it writes them every 5 minutes,
// infra/server-stats.sh) and what it costs. Volumes are billed by their real size, which the server reports.
async function server(s) {
  const live = s.stats ? await get(s.stats) : null;
  const volumes = Object.entries(s.volumes).map(([name, gb]) => {
    const size = live?.disks?.find((d) => d.name === name)?.deviceGb ?? gb;
    return { name, label: s.disks[name], gb: size, monthUsd: +(size * prices.volumePerGbMonth).toFixed(2) };
  });
  const month = s.monthUsd + volumes.reduce((a, v) => a + v.monthUsd, 0) + prices.ipv4Month;
  const { stats, volumes: _v, ...spec } = s;
  return {
    ...spec,
    cost: { monthUsd: +month.toFixed(2), dayUsd: +(month * 12 / 365).toFixed(2), server: s.monthUsd, volumes, ipv4: prices.ipv4Month, pricesAsOf: prices.asOf },
    live: live && { at: live.at, cpuBusyPct: live.cpu?.busyPct, load: live.cpu?.load, cores: live.cpu?.cores,
      memTotalMb: live.memory?.totalMb, memUsedMb: live.memory ? live.memory.totalMb - live.memory.availableMb : null,
      disks: (live.disks ?? []).map((d) => ({ name: d.name, label: s.disks[d.name] ?? d.name, usedMb: d.usedMb, freeMb: d.freeMb })),
      uptimeSec: live.uptimeSec, nodes: live.nodes },
  };
}

const result = { checkedAt: new Date().toISOString(), fatlines: [] };
for (const f of fatlines) {
  const nodes = [];
  for (const n of f.nodes) {
    const info = await get(`${n.url}/v1/info`);
    const delays = (info?.shardInfos ?? []).filter((s) => s.shardId !== 0).map((s) => Number(s.blockDelay ?? 0));
    const behind = delays.length ? Math.max(...delays) : null;
    nodes.push({
      network: n.network, label: n.label, since: n.since, version: info?.version ?? null,
      state: !info ? (n.paused ? 'paused' : 'offline') : behind !== null && behind <= 200 ? 'alive' : 'catching-up',
      paused: !info && n.paused ? n.paused : undefined,
      blocksBehind: behind, messages: info?.dbStats?.numMessages ?? null,
    });
  }
  result.fatlines.push({ ticker: f.ticker, name: f.name, image: f.image, page: f.page, notice: f.notice, coin: f.coin, fatliner: f.fatliner ?? null, server: f.server ? await server(f.server) : null, owner: await profile(f.ownerFid, f.nodes), nodes });
}
// Every other Fatline: the eggs onchain. Each names the server that keeps it warm (serverUrlOf: its hatchery);
// its node is on the same host. Nobody has to be listed by hand.
async function eggs() {
  const RPC = 'https://mainnet.base.org';
  const call = async (method, params) => {
    for (const url of [RPC, 'https://base-rpc.publicnode.com', 'https://base.llamarpc.com']) {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) }).then((x) => x.json()).catch(() => null);
      if (r && r.result !== undefined && !r.error) return r.result;
    }
    return null;
  };
  const word = (n) => BigInt(n).toString(16).padStart(64, '0');
  const str = (hex) => { if (!hex || hex.length < 130) return ''; const b = hex.slice(2); const len = parseInt(b.slice(64, 128), 16); return Buffer.from(b.slice(128, 128 + len * 2), 'hex').toString(); };
  let d; try { d = JSON.parse(readFileSync(join(here, '../../smart-contracts/deployments/base.json'), 'utf8')); } catch { return []; }
  const nft = d.Fatliners.address;
  // Public RPCs refuse long ranges (publicnode: 50,000 blocks), so read the logs in windows.
  const head = Number(BigInt((await call('eth_blockNumber', [])) ?? '0x0'));
  if (!head) return null;
  const logs = [];
  for (let from = Number(d.fromBlock); from <= head; from += 10_000) {
    const to = Math.min(from + 9_999, head);
    const got = await call('eth_getLogs', [{ address: nft, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics: ['0x8c16cbfb788ff0014645f2e619d6e70982930d43a1a53fcbb22ff48ab6eb0af0'] }]);
    if (!got) return null; // unknown, not "no eggs"
    logs.push(...got);
  }
  const fids = [...new Set(logs.map((l) => Number(BigInt(l.topics[1]))))];
  const out = [];
  for (const fid of fids) {
    const stage = Number(BigInt((await call('eth_call', [{ to: nft, data: '0xc7d25b15' + word(fid) }, 'latest'])) ?? '0x0'));
    if (!stage) continue; // died
    const url = str(await call('eth_call', [{ to: nft, data: '0x60f2ba1d' + word(fid) }, 'latest']));
    const surname = str(await call('eth_call', [{ to: nft, data: '0x8d967a78' + word(fid) }, 'latest']));
    let host = null; try { host = new URL(url).hostname; } catch {}
    const stone = Number(BigInt((await call('eth_call', [{ to: nft, data: '0xeed0951e' + word(fid) }, 'latest'])) ?? '0x0'));
    out.push({ fid, surname, stage, stone, host, hatchery: url, genesis: fid === Number(d.Fatliners.genesis?.fid), name: fid === Number(d.Fatliners.genesis?.fid) ? (d.Fatliners.genesis?.name ?? null) : null });
  }
  return out;
}
const listed = new Set(fatlines.map((f) => Number(f.ownerFid)));
// If Base couldn't be read, keep the last known eggs instead of showing none.
let lastEggs = [];
try { lastEggs = JSON.parse(readFileSync(out, 'utf8')).eggs ?? []; } catch {}
const allEggs = await eggs();
// The hatchery: every egg onchain, who keeps it, its stone, and how warm it is (from the attester that checks it).
const STONES = ['ivory', 'marble', 'sandstone', 'basalt', 'moss', 'gold', 'opal'];
const attester = 'http://46.225.208.199:8791';
result.eggs = allEggs ? [] : lastEggs;
for (const e of allEggs ?? []) {
  const w = (await get(`${attester}/eggs/${e.fid}`)) ?? (e.hatchery ? await get(`${e.hatchery.replace(/\/$/, '')}/eggs/${e.fid}`) : null);
  const today = w?.days?.at(-1);
  result.eggs.push({ fid: e.fid, name: e.name ?? (e.surname ? e.surname.charAt(0) + e.surname.slice(1).toLowerCase() : null), surname: e.surname,
    stone: STONES[e.stone] ?? 'ivory', stage: e.stage === 2 ? 'hatched' : 'egg', genesis: e.genesis,
    keeper: await profile(e.fid, [{ url: 'https://crackle.farcaster.xyz:3381', network: 'snapchain' }]),
    warmth: w ? { warmDays: w.warmDays, needed: w.needed, day: today?.day ?? null, passed: today?.passed ?? null, need: today?.need ?? null, since: w.layingAt ?? null } : null });
}
for (const e of allEggs ?? []) {
  if (e.genesis || listed.has(e.fid) || !e.host) continue;
  const nodes = [];
  for (const [network, port, label] of [['snapchain', 3381, 'Snapchain'], ['hypersnap', 4381, 'Hypersnap']]) {
    const info = await get(`http://${e.host}:${port}/v1/info`);
    if (!info && network === 'hypersnap') continue;
    const delays = (info?.shardInfos ?? []).filter((s) => s.shardId !== 0).map((s) => Number(s.blockDelay ?? 0));
    const behind = delays.length ? Math.max(...delays) : null;
    nodes.push({ network, label, version: info?.version ?? null, state: !info ? 'offline' : behind !== null && behind <= 200 ? 'alive' : 'catching-up', blocksBehind: behind, messages: info?.dbStats?.numMessages ?? null });
  }
  const name = e.surname ? e.surname.charAt(0) + e.surname.slice(1).toLowerCase() : null;
  result.fatlines.push({ ticker: e.surname || String(e.fid), name, page: `/${e.fid}`, fatliner: { id: e.fid, stage: e.stage === 2 ? 'hatched' : 'egg' }, server: null,
    owner: await profile(e.fid, [{ url: 'https://crackle.farcaster.xyz:3381', network: 'snapchain' }]), nodes });
}
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
