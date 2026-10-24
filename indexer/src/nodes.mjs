const ago = (s) => { s = Number(s); return s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} hours` : `${Math.round(s / 86400)} days`; }; // Snapchain's blockDelay is in seconds
// Master nodes: the read nodes an app runs on, watched from this server.
//
// The server asks each configured node for Snapchain's own /v1/info on a timer, decides what state
// it is in, and keeps every answer (a heartbeat) and every change of state (an event) in SQLite.
// The browser only ever talks to this server, never to the node itself.
//
// States, and what proves each one:
//   online    /v1/info answered with shard data, every shard is close to the network (small blockDelay),
//             and block heights keep moving. An HTTP 200 alone is not enough.
//   degraded  it answers, but is catching up (large blockDelay), has no shard data, or its heights stopped moving.
//   offline   the machine refused the connection (nothing listening), answered with an error,
//             or has not answered at all for OFFLINE_AFTER_MS.
//   unknown   no probe yet, a short silence (could be our network), or telemetry older than staleMs.

const DAY = 86_400_000;
export const MAX_HEALTHY_DELAY = 200; // the same rule the client uses to pick a node (hub.mjs)
const STALL_MS = 5 * 60_000; // heights frozen this long while "synced" counts as stalled
const OFFLINE_AFTER_MS = 5 * 60_000; // continuous silence before "unknown" becomes "offline"
const KEEP_PROBES_MS = 2 * DAY;

/** One look at a node. Never throws: every failure is a result. */
export async function probe(url, { fetchImpl = fetch, timeoutMs = 8000, now = Date.now } = {}) {
  const at = now();
  const started = Date.now();
  try {
    const res = await fetchImpl(`${url}/v1/info`, { signal: AbortSignal.timeout(timeoutMs) });
    const latencyMs = Date.now() - started;
    if (!res.ok) return { at, kind: 'http-error', httpStatus: res.status, latencyMs };
    let info;
    try { info = await res.json(); } catch { return { at, kind: 'bad-body', latencyMs }; }
    return { at, kind: 'answered', latencyMs, ...readInfo(info) };
  } catch (err) {
    const code = err.cause?.code ?? err.code;
    if (code === 'ECONNREFUSED') return { at, kind: 'refused' };
    if (err.name === 'TimeoutError' || err.name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT') return { at, kind: 'timeout' };
    return { at, kind: 'network-error', error: String(code ?? err.message).slice(0, 120) };
  }
}

/** Keeps only the fields we use from Snapchain's /v1/info, with types checked: it is untrusted input. */
export function readInfo(info) {
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
  const shards = (Array.isArray(info?.shardInfos) ? info.shardInfos : []).slice(0, 64)
    .map((s) => ({ shard: num(s?.shardId), height: num(s?.maxHeight), blockDelay: num(s?.blockDelay), messages: num(s?.numMessages) }))
    .filter((s) => s.shard !== null && s.shard !== 0); // shard 0 orders blocks; data lives on 1..n (as in hub.mjs)
  const version = typeof info?.version === 'string' ? info.version.slice(0, 40) : null;
  return { version, shards, messages: num(info?.dbStats?.numMessages) };
}

/**
 * The state after a probe. `last` is what we knew before: { state, lastAnswerAt, lastMoveAt, heights }.
 * Returns the new state with its reason and sync state.
 */
export function classify(p, last = {}, { maxDelay = MAX_HEALTHY_DELAY, stallMs = STALL_MS, offlineAfterMs = OFFLINE_AFTER_MS } = {}) {
  if (p.kind === 'refused') return { state: 'offline', reason: 'The machine answered, but no node is listening on its API port.', sync: null };
  if (p.kind === 'http-error') return { state: 'offline', reason: `The node API answered HTTP ${p.httpStatus}.`, sync: null };
  if (p.kind === 'bad-body') return { state: 'offline', reason: 'The node API answered with something that is not node info.', sync: null };
  if (p.kind !== 'answered') {
    const silentFor = last.lastAnswerAt ? p.at - last.lastAnswerAt : null;
    const since = last.silentSince ?? p.at;
    if (p.at - since >= offlineAfterMs) return { state: 'offline', reason: `No answer for ${Math.round((p.at - since) / 60_000)} minutes.`, sync: null };
    return { state: 'unknown', reason: p.kind === 'timeout' ? 'No answer yet (timed out). Could be the node or the network in between.' : `Could not reach it (${p.error}).`, sync: null, silentFor };
  }
  if (!p.shards.length) return { state: 'degraded', reason: 'It answers, but reports no shards.', sync: 'no shard data' };
  const worst = Math.max(...p.shards.map((s) => s.blockDelay ?? Infinity));
  if (!Number.isFinite(worst)) return { state: 'degraded', reason: 'It answers, but does not say how far behind it is.', sync: 'unknown' };
  if (worst > maxDelay) return { state: 'degraded', reason: `Catching up: ${ago(worst)} behind the network.`, sync: 'catching up', blocksBehind: worst };
  const moved = movedHeights(last.heights, p.shards);
  const lastMoveAt = moved || last.lastMoveAt == null ? p.at : last.lastMoveAt;
  if (p.at - lastMoveAt >= stallMs) return { state: 'degraded', reason: `Block heights have not moved for ${Math.round((p.at - lastMoveAt) / 60_000)} minutes.`, sync: 'stalled', blocksBehind: worst };
  return { state: 'online', reason: `In sync: at most ${ago(worst)} behind.`, sync: 'synced', blocksBehind: worst };
}

function movedHeights(before, shards) {
  if (!before) return true;
  return shards.some((s) => s.height !== null && s.height > (before[s.shard] ?? -1));
}

/** What a reader may see about a node. Never the probe URL unless the operator made it public. */
export class NodeMonitor {
  constructor(db, nodes = [], { fetchImpl = fetch, now = Date.now, intervalMs = 15_000, log = () => {} } = {}) {
    this.db = db;
    this.fetch = fetchImpl;
    this.now = now;
    this.intervalMs = intervalMs;
    this.log = log;
    this.nodes = nodes.filter((n) => n?.id && n?.url).map((n) => ({
      id: String(n.id),
      label: n.label ?? String(n.id),
      network: n.network ?? 'farcaster',
      url: String(n.url).replace(/\/$/, ''),
      publicUrl: n.public === false ? null : (n.publicUrl ?? String(n.url)).replace(/\/$/, ''),
      operator: n.operator ?? null,
      host: n.host ?? null,
      apps: (n.apps ?? []).map((a) => String(a).toLowerCase()),
    }));
    db.exec(`
      CREATE TABLE IF NOT EXISTS node_probes (
        node_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, reason TEXT,
        sync TEXT, blocks_behind INTEGER, heights TEXT, version TEXT, messages INTEGER, latency_ms INTEGER);
      CREATE INDEX IF NOT EXISTS node_probes_time ON node_probes (node_id, at DESC);
      CREATE TABLE IF NOT EXISTS node_events (
        node_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, from_state TEXT, to_state TEXT, detail TEXT);
      CREATE INDEX IF NOT EXISTS node_events_time ON node_events (node_id, at DESC);`);
    this.memory = new Map(); // node id -> { state, lastAnswerAt, lastMoveAt, heights, silentSince, version }
    for (const n of this.nodes) this.memory.set(n.id, this.#restore(n.id));
  }

  #restore(id) {
    const last = this.db.prepare('SELECT * FROM node_probes WHERE node_id = ? ORDER BY at DESC LIMIT 1').get(id);
    const answer = this.db.prepare("SELECT * FROM node_probes WHERE node_id = ? AND kind = 'answered' ORDER BY at DESC LIMIT 1").get(id);
    return {
      state: last?.state ?? null,
      lastAnswerAt: answer?.at ?? null,
      lastMoveAt: answer?.at ?? null,
      heights: answer?.heights ? Object.fromEntries(JSON.parse(answer.heights).map((s) => [s.shard, s.height])) : null,
      version: answer?.version ?? null,
      sync: last?.sync ?? null,
      silentSince: null,
    };
  }

  find(id) { return this.nodes.find((n) => n.id === id) ?? null; }

  /** Nodes the operator tied to this app (by vault or coin address). */
  forApp(...addresses) {
    const want = addresses.filter(Boolean).map((a) => a.toLowerCase());
    return this.nodes.filter((n) => n.apps.some((a) => want.includes(a)));
  }

  /** A node whose public URL matches what an app declared onchain. We never probe URLs that come from the chain. */
  byPublicUrl(url) {
    if (typeof url !== 'string') return null;
    const norm = (u) => { try { const x = new URL(u); return `${x.protocol}//${x.host}`; } catch { return null; } };
    const want = norm(url);
    return want ? this.nodes.find((n) => n.publicUrl && norm(n.publicUrl) === want) ?? null : null;
  }

  async check(node) {
    const p = await probe(node.url, { fetchImpl: this.fetch, now: this.now });
    const mem = this.memory.get(node.id);
    if (p.kind === 'answered') mem.silentSince = null;
    else if (p.kind === 'timeout' || p.kind === 'network-error') mem.silentSince ??= p.at;
    const c = classify(p, mem);
    const heights = p.shards?.map((s) => ({ shard: s.shard, height: s.height, blockDelay: s.blockDelay })) ?? null;
    this.db.prepare(`INSERT INTO node_probes (node_id, at, kind, state, reason, sync, blocks_behind, heights, version, messages, latency_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(node.id, p.at, p.kind, c.state, c.reason, c.sync, c.blocksBehind ?? null,
      heights ? JSON.stringify(heights) : null, p.version ?? null, p.messages ?? null, p.latencyMs ?? null);

    // Events: only changes, so history is short and every line means something.
    const event = (kind, detail) => this.db.prepare('INSERT INTO node_events (node_id, at, kind, from_state, to_state, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(node.id, p.at, kind, mem.state, c.state, detail);
    if (c.state !== mem.state) {
      const kind = c.state === 'online' ? (mem.sync === 'catching up' ? 'synced' : mem.state === 'degraded' || mem.state === 'offline' ? 'recovered' : 'online')
        : c.state; // degraded | offline | unknown
      event(kind, c.reason);
      this.log(`[nodes] ${node.id}: ${mem.state ?? 'new'} -> ${c.state} (${c.reason})`);
    }
    if (p.version && mem.version && p.version !== mem.version) event('version', `${mem.version} -> ${p.version}`);

    if (p.kind === 'answered') {
      if (movedHeights(mem.heights, p.shards) || mem.lastMoveAt == null) mem.lastMoveAt = p.at;
      mem.lastAnswerAt = p.at;
      mem.heights = Object.fromEntries(p.shards.map((s) => [s.shard, s.height]));
      mem.version = p.version ?? mem.version;
    }
    mem.state = c.state;
    mem.sync = c.sync;
    return c;
  }

  async checkAll() {
    await Promise.all(this.nodes.map((n) => this.check(n).catch((err) => this.log(`[nodes] ${n.id}: ${err.message}`))));
    this.db.prepare('DELETE FROM node_probes WHERE at < ?').run(this.now() - KEEP_PROBES_MS);
  }

  start() {
    if (!this.nodes.length) return;
    const tick = async () => { await this.checkAll(); this.timer = setTimeout(tick, this.intervalMs); };
    tick();
  }

  stop() { clearTimeout(this.timer); }

  /** The public status of one node. Stale telemetry is reported as unknown, never as the last good state. */
  status(id) {
    const node = this.find(id);
    if (!node) return null;
    const now = this.now();
    const staleMs = Math.max(3 * this.intervalMs, 45_000);
    const last = this.db.prepare('SELECT * FROM node_probes WHERE node_id = ? ORDER BY at DESC LIMIT 1').get(id);
    const answer = this.db.prepare("SELECT * FROM node_probes WHERE node_id = ? AND kind = 'answered' ORDER BY at DESC LIMIT 1").get(id);
    const day = this.db.prepare('SELECT state, COUNT(*) AS n FROM node_probes WHERE node_id = ? AND at >= ? GROUP BY state').all(id, now - DAY);
    const total = day.reduce((s, r) => s + r.n, 0);
    const upEvent = this.db.prepare("SELECT at FROM node_events WHERE node_id = ? AND to_state != 'online' ORDER BY at DESC LIMIT 1").get(id);
    const firstOnline = this.db.prepare("SELECT at FROM node_events WHERE node_id = ? AND to_state = 'online' AND at > ? ORDER BY at ASC LIMIT 1").get(id, upEvent?.at ?? 0);

    let state = last?.state ?? 'unknown';
    let reason = last?.reason ?? 'Not checked yet.';
    const stale = !last || now - last.at > staleMs;
    if (last && stale) { state = 'unknown'; reason = `Telemetry is stale: the last check was ${Math.round((now - last.at) / 1000)} s ago.`; }

    return {
      id: node.id, label: node.label, network: node.network, url: node.publicUrl, operator: node.operator, host: node.host,
      apps: node.apps,
      state, reason, stale,
      checkedAt: last?.at ?? null,
      lastHeartbeatAt: answer?.at ?? null, // the last time the node itself answered with node info
      sync: stale ? null : last?.sync ?? null,
      blocksBehind: stale ? null : last?.blocks_behind ?? null,
      version: answer?.version ?? null,
      commit: null, // Snapchain's /v1/info reports a version, not a commit
      shards: answer?.heights ? JSON.parse(answer.heights) : [],
      messages: answer?.messages ?? null,
      latencyMs: last?.latency_ms ?? null,
      onlineSince: state === 'online' && firstOnline ? firstOnline.at : null,
      observed24h: total ? { checks: total, online: day.find((r) => r.state === 'online')?.n ?? 0 } : null,
      intervalMs: this.intervalMs,
      staleAfterMs: staleMs,
    };
  }

  list() { return this.nodes.map((n) => this.status(n.id)); }

  events(ids, { before = Infinity, limit = 50 } = {}) {
    if (!ids.length) return [];
    const marks = ids.map(() => '?').join(',');
    return this.db.prepare(`SELECT * FROM node_events WHERE node_id IN (${marks}) AND at < ? ORDER BY at DESC LIMIT ?`)
      .all(...ids, Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER, limit)
      .map((e) => ({ source: 'node', node: e.node_id, at: e.at, kind: e.kind, from: e.from_state, to: e.to_state, detail: e.detail }));
  }
}
