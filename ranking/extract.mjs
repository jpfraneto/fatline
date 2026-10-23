// Fatline ranking, step 1: copy what the score needs from one node into compact files.
//
//   node ranking/extract.mjs <node http url> <out dir>      e.g. http://localhost:3381 /data/rank/snapchain
//
// For every FID the node knows, it reads (read-only, standard /v1 HTTP API):
//   - onchain ID_REGISTER events → registration time and last custody transfer (the age reset)
//   - onchain signer events      → which app (requestFid) asked for each of its keys
//   - follows                    → follows edges with time
//   - reactions (likes, recasts) → who it reacted to, with time
//   - casts                      → reply targets, mentions, cast counts, active days, which apps signed them
// and writes them as gzipped TSV, 10,000 FIDs per chunk. A chunk is written whole (temp file + rename), so
// a re-run skips finished chunks and redoes the one that was interrupted. No text is kept.
// Times are Farcaster seconds (since 2021-01-01) for messages and unix seconds for onchain events.
import { createWriteStream, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { join } from 'node:path';

const [NODE, OUT] = process.argv.slice(2);
if (!NODE || !OUT) throw new Error('usage: node extract.mjs <node url> <out dir>');
const CHUNK = 10_000;
const PARALLEL = Number(process.env.PARALLEL ?? 24);
mkdirSync(OUT, { recursive: true });

async function get(path, tries = 6) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(`${NODE}${path}`, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) return await res.json();
      if (res.status === 400 || res.status === 404) return {};
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (i >= tries) throw new Error(`${path}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function* pages(path) {
  let token = '';
  for (;;) {
    const r = await get(`${path}&pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
    yield r.messages ?? r.events ?? [];
    token = r.nextPageToken;
    if (!token) return;
  }
}

// requestFid from SignedKeyRequestMetadata: abi.encode(tuple(uint256 requestFid, address, bytes, uint256)).
// Word 0 is the tuple offset (0x20), word 1 is requestFid.
// Write with backpressure: wait when the gzip buffer is full, so busy accounts don't fill the memory.
async function put(stream, text) {
  if (text && !stream.write(text)) await new Promise((r) => stream.once('drain', r));
}

function requestFid(b64) {
  try {
    const buf = Buffer.from(b64 ?? '', 'base64');
    if (buf.length < 64) return 0;
    return Number(BigInt('0x' + buf.subarray(32, 64).toString('hex')));
  } catch { return 0; }
}

async function fid(f, w) {
  // Age: registration, and the last custody transfer (FIP §2: a transfer resets the age).
  let reg = 0, transfer = 0;
  for (const e of (await get(`/v1/onChainEventsByFid?fid=${f}&event_type=EVENT_TYPE_ID_REGISTER`)).events ?? []) {
    const t = Number(e.blockTimestamp ?? 0), k = e.idRegisterEventBody?.eventType;
    if (k === 'Register' || k === 'ID_REGISTER_EVENT_TYPE_REGISTER') reg = reg || t;
    if (k === 'Transfer' || k === 'ID_REGISTER_EVENT_TYPE_TRANSFER') transfer = Math.max(transfer, t);
  }
  // App keys: key → requesting app FID (onchain keys; gasless keys are counted by signer only).
  const appOf = new Map();
  for await (const evs of pages(`/v1/onChainSignersByFid?fid=${f}`)) {
    let out = '';
    for (const e of evs) {
      const b = e.signerEventBody ?? {};
      if (b.eventType === 'SIGNER_EVENT_TYPE_ADD' && b.key) {
        const app = b.metadataType === 1 ? requestFid(b.metadata) : 0;
        appOf.set(b.key, app);
        if (app) out += `${f}\t${app}\n`;
      }
    }
    await put(w.signers, out);
  }
  for await (const msgs of pages(`/v1/linksByFid?fid=${f}&link_type=follow`)) {
    let out = '';
    for (const m of msgs) {
      const d = m.data, t = d?.linkBody?.targetFid;
      if (d?.type === 'MESSAGE_TYPE_LINK_ADD' && t && t !== f) out += `${f}\t${t}\t${d.timestamp}\n`;
    }
    await put(w.follows, out);
  }
  for (const [type, code] of [['REACTION_TYPE_LIKE', 'l'], ['REACTION_TYPE_RECAST', 'c']]) {
    for await (const msgs of pages(`/v1/reactionsByFid?fid=${f}&reaction_type=${type}`)) {
      let out = '';
      for (const m of msgs) {
        const d = m.data, t = d?.reactionBody?.targetCastId?.fid;
        if (d?.type === 'MESSAGE_TYPE_REACTION_ADD' && t && t !== f) out += `${f}\t${t}\t${d.timestamp}\t${code}\n`;
      }
      await put(w.inter, out);
    }
  }
  let casts = 0, replies = 0, first = 0, last = 0;
  const apps = new Set(), days = new Set();
  for await (const msgs of pages(`/v1/castsByFid?fid=${f}`)) {
    let out = '';
    for (const m of msgs) {
      const d = m.data, b = d?.castAddBody;
      if (d?.type !== 'MESSAGE_TYPE_CAST_ADD' || !b) continue;
      const ts = d.timestamp;
      first = first ? Math.min(first, ts) : ts; last = Math.max(last, ts);
      casts++;
      const p = b.parentCastId?.fid;
      if (p) { replies++; if (p !== f) out += `${f}\t${p}\t${ts}\tr\n`; }
      for (const mm of new Set(b.mentions ?? [])) if (mm !== f) out += `${f}\t${mm}\t${ts}\tm\n`;
      const app = appOf.get(m.signer);
      if (app) apps.add(app);
      days.add(Math.floor(ts / 86400));
    }
    await put(w.inter, out);
  }
  await put(w.fids, `${f}\t${reg}\t${transfer}\t${casts}\t${replies}\t${first}\t${last}\t${days.size}\t${[...apps].sort((a, b) => a - b).join(',')}\n`);
}

function writers(dir) {
  const names = ['fids', 'follows', 'inter', 'signers'];
  const w = {};
  for (const n of names) {
    const gz = createGzip({ level: 6 });
    gz.setMaxListeners(PARALLEL + 10); // each worker may wait for 'drain'
    gz.pipe(createWriteStream(join(dir, `${n}.tsv.gz`)));
    w[n] = gz;
  }
  w.close = () => Promise.all(names.map((n) => new Promise((r) => { w[n].on('end', r); w[n].end(); })));
  return w;
}

// Every FID the node knows, from both message shards, in order.
const all = [];
for (const shard of [1, 2]) {
  let token = '';
  for (;;) {
    const r = await get(`/v1/fids?shard_id=${shard}&pageSize=10000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
    all.push(...(r.fids ?? []));
    token = r.nextPageToken;
    if (!token) break;
  }
}
all.sort((a, b) => a - b);
if (process.env.LIMIT) all.length = Math.min(all.length, Number(process.env.LIMIT)); // for a quick test run
const info = await get('/v1/info');
writeFileSync(join(OUT, 'meta.json'), JSON.stringify({
  node: NODE, startedAt: new Date().toISOString(), version: info.version, fids: all.length,
  heights: (info.shardInfos ?? []).map((s) => ({ shard: s.shardId, height: s.maxHeight, blockDelay: s.blockDelay })),
}, null, 2));
console.log(`${all.length} FIDs on ${NODE}`);

const started = Date.now();
for (let c = 0; c * CHUNK < all.length; c++) {
  const done = join(OUT, `chunk-${String(c).padStart(4, '0')}`);
  if (existsSync(done)) continue;
  const tmp = `${done}.tmp`;
  mkdirSync(tmp, { recursive: true });
  const w = writers(tmp);
  const ids = all.slice(c * CHUNK, (c + 1) * CHUNK);
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < ids.length) { const f = ids[next++]; await fid(f, w); }
  }));
  await w.close();
  renameSync(tmp, done);
  const doneN = Math.min((c + 1) * CHUNK, all.length);
  console.log(`${new Date().toISOString()} chunk ${c}: FIDs up to ${ids.at(-1)}, ${doneN}/${all.length}, ${((Date.now() - started) / 60000).toFixed(1)} min`);
}
writeFileSync(join(OUT, 'DONE'), new Date().toISOString() + '\n');
console.log('done');
