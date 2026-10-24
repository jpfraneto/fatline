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
      state: !info ? 'offline' : behind !== null && behind <= 200 ? 'alive' : 'catching-up',
      blocksBehind: behind, messages: info?.dbStats?.numMessages ?? null,
    });
  }
  result.fatlines.push({ ticker: f.ticker, name: f.name, image: f.image, page: f.page, notice: f.notice, coin: f.coin, fatliner: f.fatliner ?? null, server: f.server ? await server(f.server) : null, owner: await profile(f.ownerFid, f.nodes), nodes });
}
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
