// Checks every real Fatline's nodes and writes status.json for the home page.
// Runs in the site's GitHub workflow every 15 minutes (the page is https; the nodes speak plain http,
// so the browser can't ask them itself). Usage: node apps/site/status.mjs [out-file]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, 'status.json');
const { fatlines } = JSON.parse(readFileSync(join(here, 'fatlines.json'), 'utf8'));

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
  result.fatlines.push({ ticker: f.ticker, coin: f.coin, owner: await profile(f.ownerFid, f.nodes), nodes });
}
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
