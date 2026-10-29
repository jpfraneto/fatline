// The registry: every Farcaster node and client that joined Fatline, each measured from this server.
//
// The records live on Farcaster, not here. An operator joins with one cast whose parent is https://fatline.ink/nodes:
//
//   fatline node
//   node: https://hub.example.com:3381
//   client: https://example.com
//
// Every node holds those casts, so anyone can read the list without Fatline: GET <any node>/v1/castsByParent?url=https://fatline.ink/nodes.
// Deleting the cast takes the node out. A newer cast from the same account for the same node replaces the older one.
//
// A URL is listed under an account only when its host says so (proof):
//   well-known  http(s)://<host>/.well-known/fatline holds "fid: <FID>"
//   dns         a TXT record at _fatline.<host> holds "fid=<FID>"
//   egg         a Fatline place: the keeper's app key signed the egg that names this node, and the hatcheries check it
//               hourly. Another node or client on the same host, cast by the same keeper, is covered by the same egg.
// Without proof a record is kept but not listed (?include=unproven shows it, marked).
//
// Health is measured here, once an hour, against this server's own reference nodes for the same network. Never the
// node's own word for it (its blockDelay is not used):
//   synced       answers /v1/info, every shard within MAX_LAG_BLOCKS of the reference, and returns a settled cast by hash
//   behind       answers like a node, but at least one shard is more than MAX_LAG_BLOCKS behind
//   invalid      answers, but not like a Farcaster node: no shards, a shard missing, or a known cast missing or wrong
//   unreachable  no answer: refused, timed out, HTTP error, or not a public address
//   unknown      not measured yet, or no reference node answered, so nothing could be judged
// When read, a measurement older than STALE_MS is "stale": it is shown with its time, never as now.
// The network is measured too: Hypersnap answers /v2/farcaster/user/bulk, Snapchain does not.
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { isPublicAddress, outsideFetch } from './outside-fetch.mjs';
import { toMs } from './hub.mjs';

export const RECORDS_URL = 'https://fatline.ink/nodes';
export const SCHEMA = 'fatline.registry/1';
export const MAX_LAG_BLOCKS = 600; // ~10 minutes of blocks, the hatchery's rule
export const EVERY_MS = 60 * 60_000; // the pace of Fatline: hourly, on purpose
export const STALE_MS = 150 * 60_000; // two missed rounds and a half
const PROOF_RECHECK_MS = 7 * 24 * 3600_000; // a proof found is looked for again weekly; one not found, every round
const PROOF_VALID_MS = 30 * 24 * 3600_000; // and it counts for 30 days after it was last seen (a host can be down a while)
const KEEP_CHECKS_MS = 7 * 24 * 3600_000;
const SETTLED_S = 30 * 60; // a cast this old is on every node in sync
const FC_EPOCH_S = 1_609_459_200;
const MAX_PER_RECORD = 4;
const RECORDS_PER_FID = 4; // only an account's latest records count
const PROOFS_PER_ROUND = 60; // proof lookups a round may start; the rest wait for the next round
const MAX_NODES = 300;
const NETWORK_KEY = { snapchain: 'farcaster', hypersnap: 'hypersnap' }; // the config's names for the two networks
const PUBLIC_NAME = { farcaster: 'snapchain', snapchain: 'snapchain', hypersnap: 'hypersnap' };

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// ------------------------------------------------------------------ records

/**
 * An endpoint as it is listed: scheme, host and port, nothing else. Returns null for anything that can't be a public
 * node or client address (a path, a query, credentials, localhost, a private IP, a bare name without a dot).
 */
export function normalizeEndpoint(input) {
  let s = String(input ?? '').trim();
  if (!s || s.length > 200) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== '/' && u.pathname !== '') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host)) { if (!isPublicAddress(host)) return null; }
  else if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) || /(^|\.)localhost$|\.local$|\.internal$/.test(host)) return null;
  return `${u.protocol}//${u.host.toLowerCase()}`;
}

/** A readable, stable id: the host and port, with dashes. https://crackle.farcaster.xyz:3381 -> crackle-farcaster-xyz-3381 */
export function endpointId(url) {
  const u = new URL(url);
  return `${u.hostname}${u.port ? `-${u.port}` : ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
}

const hostOf = (url) => new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();

/**
 * One cast's text, read as a record. Lines of `key: value`; the keys are node, client, reads, name, usdc, cost, vault
 * (the vault of a Fatliner the same account keeps: its rent money then shows on these nodes too).
 * Returns null when the cast names no node and no client (a comment under fatline.ink/nodes, not a record).
 */
export function parseRecord(text) {
  const out = { nodes: [], clients: [], reads: [], name: null, usdc: null, costMonthUsd: null, vault: null };
  for (const raw of String(text ?? '').split(/\r?\n/).slice(0, 40)) {
    const m = raw.match(/^\s*(node|client|reads|name|usdc|cost|vault)\s*:\s*(.+?)\s*$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2];
    if (key === 'node' || key === 'client' || key === 'reads') {
      const url = normalizeEndpoint(value);
      const list = out[key === 'reads' ? 'reads' : `${key}s`];
      if (url && !list.includes(url) && list.length < MAX_PER_RECORD) list.push(url);
    } else if (key === 'name' && !out.name) {
      out.name = value.replace(/[\u0000-\u001f<>]/g, '').slice(0, 40) || null;
    } else if (key === 'usdc' && !out.usdc && /^0x[0-9a-fA-F]{40}$/.test(value)) {
      out.usdc = value;
    } else if (key === 'vault' && !out.vault && /^0x[0-9a-fA-F]{40}$/.test(value)) {
      out.vault = value.toLowerCase();
    } else if (key === 'cost' && out.costMonthUsd == null) {
      const n = Number(value.replace(/[$,]|usd|\/\s*month|a month|per month/gi, '').trim());
      if (Number.isFinite(n) && n >= 0 && n < 100_000) out.costMonthUsd = n;
    }
  }
  return out.nodes.length || out.clients.length ? out : null;
}

/** The record a person casts to join: what the join page shows and sends. */
export function recordText({ node = null, clients = [], name = null, usdc = null, costMonthUsd = null } = {}) {
  const lines = [node ? 'fatline node' : 'fatline client'];
  if (node) lines.push(`node: ${node}`);
  for (const c of clients) lines.push(`client: ${c}`);
  if (name) lines.push(`name: ${name}`);
  if (usdc) lines.push(`usdc: ${usdc}`);
  if (costMonthUsd != null) lines.push(`cost: ${costMonthUsd} USD a month`);
  return lines.join('\n');
}

// ------------------------------------------------------------------ proof

/** The FIDs a /.well-known/fatline file or a TXT record names: "fid: 16098", "fid=16098", or JSON { fid } / { fids }. */
export function proofFids(text) {
  const s = String(text ?? '').slice(0, 4096);
  const fids = new Set();
  try {
    const j = JSON.parse(s);
    for (const f of [j?.fid, ...(Array.isArray(j?.fids) ? j.fids : [])]) if (Number.isInteger(Number(f)) && Number(f) > 0) fids.add(Number(f));
  } catch { /* not JSON: lines */ }
  for (const m of s.matchAll(/\bfid\s*[:=]\s*(\d{1,12})\b/gi)) fids.add(Number(m[1]));
  return [...fids];
}

/** Does this host name this FID? Tries the well-known file (https, then http, on the host's usual ports) and DNS. */
export async function proveHost(url, fid, { fetchImpl = outsideFetch, resolveTxt = dns.resolveTxt, timeoutMs = 6000 } = {}) {
  const host = hostOf(url);
  const u = new URL(url);
  const tried = [];
  const h = host.includes(':') ? `[${host}]` : host;
  const origins = [...new Set([`${u.protocol}//${u.host}`, `https://${h}`, `http://${h}`])];
  for (const origin of origins) {
    const where = `${origin}/.well-known/fatline`;
    try {
      const r = await fetchImpl(where, { signal: AbortSignal.timeout(timeoutMs), maxBytes: 4096 });
      if (!r.ok) { tried.push(`${where}: HTTP ${r.status}`); continue; }
      const fids = proofFids(await r.text());
      if (fids.includes(Number(fid))) return { ok: true, method: 'well-known', where };
      tried.push(`${where}: ${fids.length ? `names FID ${fids.join(', ')}` : 'no fid in it'}`);
    } catch (err) { tried.push(`${where}: ${whyFailed(err, timeoutMs)}`); }
  }
  if (!isIP(host)) {
    const name = `_fatline.${host}`;
    try {
      let timer;
      const rows = await Promise.race([resolveTxt(name), new Promise((_, no) => { timer = setTimeout(() => no(new Error('timeout')), timeoutMs); })])
        .finally(() => clearTimeout(timer));
      const fids = proofFids(rows.map((r) => r.join('')).join('\n'));
      if (fids.includes(Number(fid))) return { ok: true, method: 'dns', where: name };
      tried.push(`${name}: ${fids.length ? `names FID ${fids.join(', ')}` : 'no fid'}`);
    } catch (err) { tried.push(`${name}: ${String(err.code ?? err.message).slice(0, 40)}`); }
  }
  return { ok: false, tried };
}

// ------------------------------------------------------------------ measuring

/** A failed request, in words. */
export function whyFailed(err, timeoutMs = 8000) {
  const code = String(err?.cause?.code ?? err?.code ?? '');
  if (code === 'ENOTPUBLIC') return 'not a public address';
  if (code === 'ECONNREFUSED') return 'the machine answered, but nothing listens on that port';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'that name does not resolve';
  if (/Timeout|Abort/.test(String(err?.name)) || code === '23' || /timeout|aborted/i.test(String(err?.message))) return `no answer within ${timeoutMs / 1000} s`;
  if (/CERT|SSL|TLS|EPROTO/i.test(code)) return `its https certificate was refused (${code})`;
  return `could not connect (${(code || String(err?.message ?? err)).slice(0, 40)})`;
}

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const heightsOf = (info) => Object.fromEntries((Array.isArray(info?.shardInfos) ? info.shardInfos : []).slice(0, 64)
  .filter((s) => num(s?.shardId) > 0 && num(s?.maxHeight) !== null).map((s) => [num(s.shardId), num(s.maxHeight)]));

async function getJson(fetchImpl, url, timeoutMs, maxBytes = 1_000_000) {
  const started = Date.now();
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), maxBytes });
  const ms = Date.now() - started;
  if (!r.ok) return { status: r.status, ms, body: null };
  try { return { status: r.status, ms, body: await r.json() }; } catch { return { status: r.status, ms, body: null, bad: true }; }
}

/**
 * What the reference nodes say, for one network, this round: the highest height of each shard among the references
 * that answered, and two settled casts (by hash) any node in sync must hold. Reference nodes come from this server's
 * own config, so they are fetched directly (they may be 127.0.0.1).
 */
export async function readReference(urls, { fetchImpl = fetch, random = Math.random, now = Date.now } = {}) {
  const answers = (await Promise.all(urls.map((u) => getJson(fetchImpl, `${u}/v1/info`, 10_000).then((r) => ({ url: u, ...r })).catch(() => null))))
    .filter((r) => r?.body && Object.keys(heightsOf(r.body)).length);
  if (!answers.length) return null;
  const heights = {};
  for (const a of answers) for (const [shard, h] of Object.entries(heightsOf(a.body))) heights[shard] = Math.max(heights[shard] ?? 0, h);
  const casts = [];
  const nowFc = Math.floor(now() / 1000) - FC_EPOCH_S;
  for (let i = 0; i < 30 && casts.length < 2; i++) {
    const fid = 1 + Math.floor(random() * 1_200_000);
    const r = await getJson(fetchImpl, `${answers[0].url}/v1/castsByFid?fid=${fid}&pageSize=5&reverse=true`, 8_000).catch(() => null);
    const m = (r?.body?.messages ?? []).find((x) => x.data?.type === 'MESSAGE_TYPE_CAST_ADD' && Number(x.data?.timestamp) < nowFc - SETTLED_S);
    if (m && !casts.some((c) => c.hash === m.hash)) casts.push({ fid, hash: m.hash });
  }
  return { heights, casts, from: answers.map((a) => a.url), at: now() };
}

/**
 * One measurement of one node. refs: { snapchain: readReference(...), hypersnap: ... } (either may be null), or a
 * function of the network that returns one (so only the network the node turns out to serve is read).
 * Never throws: every failure is a result.
 */
export async function measure(url, refs, { fetchImpl = outsideFetch, now = Date.now, timeoutMs = 8000 } = {}) {
  const at = now();
  const base = { at, network: null, version: null, latencyMs: null, behindBlocks: null, shards: null, dataCheck: null, messages: null };
  let info;
  try {
    info = await getJson(fetchImpl, `${url}/v1/info`, timeoutMs);
  } catch (err) {
    return { ...base, state: 'unreachable', reason: whyFailed(err, timeoutMs) };
  }
  base.latencyMs = info.ms;
  if (!info.body) return { ...base, state: info.bad ? 'invalid' : 'unreachable', reason: info.bad ? '/v1/info is not node info' : `/v1/info answered HTTP ${info.status}` };
  const got = heightsOf(info.body);
  base.version = typeof info.body.version === 'string' ? info.body.version.slice(0, 40) : null;
  base.messages = num(info.body.dbStats?.numMessages);
  base.shards = Object.entries(got).map(([shard, height]) => ({ shard: Number(shard), height }));
  if (!base.shards.length) return { ...base, state: 'invalid', reason: 'it answers, but reports no shards' };

  // Which network: Hypersnap serves a user API that Snapchain does not have.
  const v2 = await getJson(fetchImpl, `${url}/v2/farcaster/user/bulk?fids=3`, timeoutMs, 200_000).catch(() => null);
  base.network = Number(v2?.body?.users?.[0]?.fid) === 3 ? 'hypersnap' : 'snapchain';

  const ref = typeof refs === 'function' ? await refs(base.network) : refs?.[base.network];
  if (!ref) return { ...base, state: 'unknown', reason: `no ${base.network} reference node answered here this round, so its sync could not be judged` };
  let behind = 0;
  for (const [shard, h] of Object.entries(ref.heights)) {
    if (!(shard in got)) return { ...base, state: 'invalid', reason: `shard ${shard} is missing` };
    behind = Math.max(behind, h - got[shard]);
  }
  base.behindBlocks = Math.max(0, behind);
  if (behind > MAX_LAG_BLOCKS) return { ...base, state: 'behind', reason: `${behind.toLocaleString('en-US')} blocks behind the reference` };
  if (!ref.casts.length) return { ...base, state: 'unknown', reason: 'in sync by height, but no cast could be picked to ask it for' };
  for (const c of ref.casts) {
    const r = await getJson(fetchImpl, `${url}/v1/castById?fid=${c.fid}&hash=${c.hash}`, timeoutMs, 200_000).catch(() => null);
    if (r?.body?.hash !== c.hash) return { ...base, dataCheck: false, state: 'invalid', reason: `in sync by height, but it did not return cast ${c.hash.slice(0, 10)}… (FID ${c.fid})` };
  }
  base.dataCheck = true;
  return { ...base, state: 'synced', reason: behind > 0 ? `${behind} ${behind === 1 ? 'block' : 'blocks'} behind the reference, and it returned the casts it was asked for` : 'at the reference height, and it returned the casts it was asked for' };
}

/** What a reader sees: the measurement, or "stale" when it is too old to say anything about now. */
export function healthNow(m, { now = Date.now(), lastSyncedAt = null } = {}) {
  if (!m) return { state: 'unknown', measured: null, reason: 'not measured yet', checkedAt: null, lastSyncedAt, stale: false };
  const stale = now - m.at > STALE_MS;
  return {
    state: stale ? 'stale' : m.state,
    measured: m.state,
    reason: stale ? `last measured ${Math.round((now - m.at) / 60_000)} min ago (${m.state}); nothing newer` : m.reason,
    checkedAt: m.at, lastSyncedAt, stale,
    network: m.network, version: m.version, latencyMs: m.latencyMs, behindBlocks: m.behindBlocks, dataCheck: m.dataCheck,
  };
}

/**
 * A vault's money in plain numbers. f: { usdc (kept + fees waiting, in USDC), ratePerSecond (USDC units), paidThrough,
 * aliveUntil (unix seconds) }, as the vault contract returns them. The rent is the contract's, not anyone's estimate.
 */
export function vaultMoney(f, now = Date.now()) {
  const rate = Number(f.ratePerSecond ?? 0);
  const out = { vaultUsdc: f.usdc ?? null, rentMonthUsdc: rate > 0 ? Math.round((rate * 30 * 86400) / 1e4) / 100 : null };
  if (f.paidThrough) out.paidThrough = Number(f.paidThrough) * 1000;
  if (f.aliveUntil && rate > 0) {
    out.aliveUntil = Number(f.aliveUntil) * 1000;
    out.runwayDays = Math.max(0, Math.floor((out.aliveUntil - now) / 86_400_000));
  }
  return out;
}

// ------------------------------------------------------------------ the registry

/** Runs `fn` over `items`, `n` at a time. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

export class Registry {
  /**
   * db: this server's SQLite. networks: { farcaster: Network, hypersnap: Network } (hub.mjs), read for records.
   * references: { snapchain: [urls], hypersnap: [urls] }: the nodes this server trusts to judge sync.
   * places: async () => [{ fid, surname, stage, node, network, client, coin, vault, earned, being }] (Fatline's eggs and Fatliners).
   * users: async (fid) => { username, pfp } | null.
   * vaults: async ([address]) => { address: { usdc, ratePerSecond, paidThrough, aliveUntil } }: each Fatliner vault, read from Base.
   * extraNodes: [{ url, label }] this server runs; listed only when they share a host with its owner's own place (ownerFid).
   */
  constructor({ db, networks = {}, references = {}, places = async () => [], users = async () => null, vaults = null, ownerFid = null, extraNodes = [],
    measuredBy = 'this server', fetchImpl = outsideFetch, refFetch = fetch, prove = proveHost, now = Date.now, random = Math.random, log = () => {} }) {
    Object.assign(this, { db, networks, references, places, users, vaults, ownerFid, extraNodes, measuredBy, fetchImpl, refFetch, prove, now, random, log });
    db.exec(`
      CREATE TABLE IF NOT EXISTS registry_checks (id TEXT NOT NULL, at INTEGER NOT NULL, state TEXT NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS registry_checks_time ON registry_checks (id, at DESC);
      CREATE TABLE IF NOT EXISTS registry_proofs (key TEXT PRIMARY KEY, ok INTEGER NOT NULL, method TEXT, at INTEGER NOT NULL, ok_at INTEGER, detail TEXT);
      CREATE TABLE IF NOT EXISTS registry_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    const saved = db.prepare("SELECT value FROM registry_state WHERE key = 'entries'").get();
    this.state = saved ? JSON.parse(saved.value) : { nodes: [], clients: [], unproven: [], roundAt: null, records: 0, error: null };
    this.running = null;
    this.checks = new Map(); // url -> { at, value }: the join page's checks, one a minute per address
    this.asked = []; // times of recent checks, for the global limit
  }

  // ---- reading the records

  /** Every cast under fatline.ink/nodes, from this server's own nodes (both networks: the union, by hash). */
  async readRecords() {
    const seen = new Map();
    for (const net of Object.values(this.networks)) {
      let pageToken;
      for (let page = 0; page < 10; page++) {
        const r = await net.get('/v1/castsByParent', { url: RECORDS_URL, pageSize: 100, reverse: true, pageToken }).catch((err) => { this.log(`[registry] ${net.name}: ${err.message}`); return null; });
        for (const m of r?.data?.messages ?? []) {
          if (m?.data?.type !== 'MESSAGE_TYPE_CAST_ADD' || m.data.castAddBody?.parentUrl !== RECORDS_URL || seen.has(m.hash)) continue;
          seen.set(m.hash, { hash: m.hash, fid: Number(m.data.fid), at: toMs(Number(m.data.timestamp)), text: String(m.data.castAddBody.text ?? '') });
        }
        pageToken = r?.data?.nextPageToken;
        if (!pageToken || !(r?.data?.messages ?? []).length) break;
      }
    }
    return [...seen.values()].sort((a, b) => a.at - b.at);
  }

  /** The proof as last looked up, if it is fresh enough to use without looking again; undefined if it is due. */
  cachedProof(url, fid) {
    const row = this.db.prepare('SELECT * FROM registry_proofs WHERE key = ?').get(`${hostOf(url)}|${fid}|${new URL(url).port}`);
    const now = this.now();
    if (!row || now - row.at >= (row.ok ? PROOF_RECHECK_MS : 50 * 60_000)) return undefined;
    return row.ok_at && now - row.ok_at < PROOF_VALID_MS ? { method: row.method, at: row.ok_at } : null;
  }

  async proof(url, fid) {
    const key = `${hostOf(url)}|${fid}|${new URL(url).port}`;
    const row = this.db.prepare('SELECT * FROM registry_proofs WHERE key = ?').get(key);
    const now = this.now();
    const cached = this.cachedProof(url, fid);
    if (cached !== undefined) return cached;
    const p = await this.prove(url, fid, { fetchImpl: this.fetchImpl }).catch((err) => ({ ok: false, tried: [err.message] }));
    const okAt = p.ok ? now : row?.ok_at ?? null;
    const method = p.ok ? p.method : row?.method ?? null;
    this.db.prepare('INSERT OR REPLACE INTO registry_proofs (key, ok, method, at, ok_at, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(key, p.ok ? 1 : 0, method, now, okAt, JSON.stringify(p.tried ?? p.where ?? null).slice(0, 500));
    return okAt && now - okAt < PROOF_VALID_MS ? { method, at: okAt } : null;
  }

  // ---- one round

  /** Reads the records and places, checks proofs, measures every node. Hourly, or when asked (at most every 2 min). */
  round() {
    this.running ??= this.#round().catch((err) => { this.state.error = String(err.message).slice(0, 200); this.log(`[registry] round failed: ${err.message}`); })
      .finally(() => { this.running = null; });
    return this.running;
  }

  async #round() {
    const now = this.now();
    const [records, places] = await Promise.all([this.readRecords(), this.places().catch((err) => { this.log(`[registry] places: ${err.message}`); return []; })]);
    const nodes = new Map(); // url -> entry
    const clients = new Map();
    const unproven = [];
    const placeHosts = new Map(); // host -> keeper fid (an egg covers its host)
    const add = (url, patch) => {
      const e = nodes.get(url) ?? { id: endpointId(url), url, name: null, operator: null, proof: null, sources: [], record: null, clients: [], fatliner: null, funding: null };
      for (const s of patch.sources ?? []) if (!e.sources.includes(s)) e.sources.push(s);
      Object.assign(e, Object.fromEntries(Object.entries(patch).filter(([k, v]) => k !== 'sources' && v != null && (e[k] == null || k === 'record'))));
      nodes.set(url, e);
      return e;
    };
    const addClient = (url, patch) => {
      const c = clients.get(url) ?? { id: endpointId(url), url, name: null, operator: null, proof: null, nodes: [], reads: [], sources: [] };
      for (const n of patch.nodes ?? []) if (!c.nodes.includes(n)) c.nodes.push(n);
      for (const n of patch.reads ?? []) if (!c.reads.includes(n)) c.reads.push(n);
      for (const s of patch.sources ?? []) if (!c.sources.includes(s)) c.sources.push(s);
      for (const k of ['name', 'operator', 'proof', 'fatliner']) if (patch[k] != null && c[k] == null) c[k] = patch[k];
      clients.set(url, c);
      return c;
    };

    // Fatline's places: proven by their eggs.
    for (const p of places) {
      const node = normalizeEndpoint(p.node);
      const fatliner = { fid: p.tokenFid ?? p.fid, surname: p.surname, stage: p.stage, being: p.being ?? null };
      const funding = p.coin || p.vault ? { coin: p.coin ?? null, vault: p.vault ?? null, earnedUsdc: p.earned ?? null } : null;
      const client = p.client ? normalizeEndpoint(p.client) : null;
      const proof = { method: 'egg', at: now };
      if (node) {
        add(node, { sources: ['place'], name: p.surname ? p.surname.charAt(0) + p.surname.slice(1).toLowerCase() : null, operator: p.fid, proof, fatliner, funding });
        placeHosts.set(hostOf(node), p.fid);
      }
      if (client) addClient(client, { sources: ['place'], name: fatliner.surname ? fatliner.surname.charAt(0) + fatliner.surname.slice(1).toLowerCase() : null, operator: p.fid, proof, fatliner, nodes: node ? [endpointId(node)] : [] });
    }
    // Nodes this server runs, on its owner's own place host.
    for (const x of this.extraNodes) {
      const url = normalizeEndpoint(x.url);
      if (url && this.ownerFid && placeHosts.get(hostOf(url)) === Number(this.ownerFid)) add(url, { sources: ['place'], name: x.label ?? null, operator: Number(this.ownerFid), proof: { method: 'egg', at: now } });
    }

    // The records, oldest first, so the newest record for a node wins. Only each account's latest few count, and a
    // round starts at most PROOFS_PER_ROUND proof lookups, so a flood of casts can't stall the hour.
    let lookups = 0;
    const covered = async (url, fid) => {
      if (placeHosts.get(hostOf(url)) === fid) return { method: 'egg', at: now };
      const cached = this.cachedProof(url, fid);
      if (cached !== undefined) return cached;
      if (++lookups > PROOFS_PER_ROUND) return null;
      return this.proof(url, fid);
    };
    const latest = new Map();
    for (const r of records) latest.set(r.fid, [...(latest.get(r.fid) ?? []), r].slice(-RECORDS_PER_FID));
    const counted = new Set([...latest.values()].flat().map((r) => r.hash));
    for (const r of records) {
      if (!counted.has(r.hash)) continue;
      const rec = parseRecord(r.text);
      if (!rec) continue;
      const record = { hash: r.hash, fid: r.fid, at: r.at };
      const provenNodes = [];
      for (const url of rec.nodes) {
        const have = nodes.get(url);
        if (have?.operator && have.operator !== r.fid) { unproven.push({ url, kind: 'node', fid: r.fid, record, why: 'listed under another account' }); continue; }
        const proof = have?.operator === r.fid ? have.proof : await covered(url, r.fid);
        if (!proof) { unproven.push({ url, kind: 'node', fid: r.fid, record, why: 'no proof at its host yet' }); continue; }
        // A vault attached by its keeper: only one of a Fatliner this same account keeps.
        const kept = rec.vault ? places.find((p) => String(p.vault ?? '').toLowerCase() === rec.vault && Number(p.fid) === r.fid) : null;
        const fromVault = kept ? { coin: kept.coin ?? null, vault: kept.vault, earnedUsdc: kept.earned ?? null } : {};
        const funding = rec.usdc || rec.costMonthUsd != null || kept ? { ...(have?.funding ?? {}), ...fromVault, supportUsdc: rec.usdc, costMonthUsd: rec.costMonthUsd } : have?.funding ?? null;
        if (rec.vault && !kept) unproven.push({ url, kind: 'vault', fid: r.fid, record, why: `vault ${rec.vault} is not a Fatliner vault this account keeps` });
        const e = add(url, { sources: ['record'], operator: r.fid, proof, record });
        if (rec.name) e.name = rec.name;
        e.funding = funding;
        provenNodes.push(e.id);
      }
      for (const url of rec.clients) {
        const have = clients.get(url);
        if (have?.operator && have.operator !== r.fid) { unproven.push({ url, kind: 'client', fid: r.fid, record, why: 'listed under another account' }); continue; }
        const proof = have?.operator === r.fid ? have.proof : await covered(url, r.fid);
        if (!proof) { unproven.push({ url, kind: 'client', fid: r.fid, record, why: 'no proof at its address yet' }); continue; }
        const c = addClient(url, { sources: ['record'], operator: r.fid, proof, nodes: provenNodes, reads: rec.reads });
        if (rec.name) c.name = rec.name;
        c.record = record;
      }
    }
    // Each node knows the clients that read it.
    for (const c of clients.values()) for (const id of c.nodes) { const n = [...nodes.values()].find((x) => x.id === id); if (n && !n.clients.includes(c.id)) n.clients.push(c.id); }
    for (const c of clients.values()) {
      for (const u of c.reads) { const n = nodes.get(u); if (n && !c.nodes.includes(n.id)) { c.nodes.push(n.id); if (!n.clients.includes(c.id)) n.clients.push(c.id); } }
    }

    // Measure: the references first (once per network), then every node, four at a time.
    const refs = {};
    for (const [pub, urls] of Object.entries(this.references)) refs[pub] = urls?.length ? await readReference(urls, { fetchImpl: this.refFetch, random: this.random, now: this.now }) : null;
    const list = [...nodes.values()].slice(0, MAX_NODES);
    await pool(list, 4, async (e) => {
      const m = await measure(e.url, refs, { fetchImpl: this.fetchImpl, now: this.now });
      this.db.prepare('INSERT INTO registry_checks (id, at, state, json) VALUES (?, ?, ?, ?)').run(e.id, m.at, m.state, JSON.stringify(m));
    });
    this.db.prepare('DELETE FROM registry_checks WHERE at < ?').run(now - KEEP_CHECKS_MS);

    // Names and faces, vault balances.
    const fids = [...new Set([...list.map((e) => e.operator), ...[...clients.values()].map((c) => c.operator)].filter(Boolean))];
    const people = Object.fromEntries(await Promise.all(fids.map(async (f) => [f, await this.users(f).catch(() => null)])));
    // The money, read from Base: each vault's USDC, the rent its contract pays, and until when it lasts.
    const addrs = [...new Set(list.map((e) => e.funding?.vault).filter(Boolean).map((a) => a.toLowerCase()))];
    const facts = this.vaults && addrs.length ? await this.vaults(addrs).catch((err) => { this.log(`[registry] vaults: ${err.message}`); return {}; }) : {};
    const who = (fid) => (fid ? { fid, username: people[fid]?.username ?? null, pfp: people[fid]?.pfp ?? null } : null);
    for (const e of list) {
      e.operator = who(e.operator);
      const f = e.funding?.vault ? facts[e.funding.vault.toLowerCase()] : null;
      if (f) Object.assign(e.funding, vaultMoney(f, now));
    }
    for (const c of clients.values()) c.operator = who(c.operator);
    this.state = {
      nodes: list, clients: [...clients.values()], unproven: unproven.slice(-100).map((u) => ({ ...u, operator: who(u.fid) })),
      roundAt: now, records: records.length, error: null,
      references: Object.fromEntries(Object.entries(refs).map(([k, r]) => [k, r ? { at: r.at, heights: r.heights, nodes: r.from.length } : null])),
    };
    this.db.prepare("INSERT OR REPLACE INTO registry_state (key, value) VALUES ('entries', ?)").run(JSON.stringify(this.state));
    this.log(`[registry] ${records.length} records, ${list.length} nodes, ${clients.size} clients, ${unproven.length} unproven`);
  }

  start(everyMs = EVERY_MS) {
    const tick = () => { this.round().finally(() => { this.timer = setTimeout(tick, everyMs); }); };
    this.timer = setTimeout(tick, 20_000);
  }

  stop() { clearTimeout(this.timer); }

  /** Someone just published a record (the join page): read again now, unless a round ran in the last 2 minutes. */
  refresh() {
    if (this.running) return { started: false, running: true };
    if (this.state.roundAt && this.now() - this.state.roundAt < 2 * 60_000) return { started: false, roundAt: this.state.roundAt, nextIn: 2 * 60_000 - (this.now() - this.state.roundAt) };
    this.round();
    return { started: true };
  }

  // ---- what readers see

  #history(id, limit = 48) {
    return this.db.prepare('SELECT at, state, json FROM registry_checks WHERE id = ? ORDER BY at DESC LIMIT ?').all(id, limit);
  }

  #node(e, { history = false } = {}) {
    const rows = this.#history(e.id, history ? 48 : 1);
    const last = rows[0] ? JSON.parse(rows[0].json) : null;
    const synced = this.db.prepare("SELECT at FROM registry_checks WHERE id = ? AND state = 'synced' ORDER BY at DESC LIMIT 1").get(e.id);
    const health = { ...healthNow(last, { now: this.now(), lastSyncedAt: synced?.at ?? null }), measuredBy: this.measuredBy };
    const out = {
      id: e.id, url: e.url, network: health.network ?? null, name: e.name, operator: e.operator, proof: e.proof, sources: e.sources,
      record: e.record, clients: e.clients.map((id) => { const c = this.state.clients.find((x) => x.id === id); return c ? { id: c.id, url: c.url, name: c.name } : null; }).filter(Boolean),
      fatliner: e.fatliner, funding: e.funding, health,
    };
    if (history) out.history = rows.map((r) => ({ at: r.at, state: r.state }));
    return out;
  }

  /** GET /api/registry: the listed nodes and clients. network=snapchain|hypersnap, healthy=true, include=unproven. */
  list(q = new URLSearchParams()) {
    const asked = String(q.get('network') ?? '').toLowerCase();
    const net = PUBLIC_NAME[asked] ?? null;
    if (asked && !net) throw fail('network: snapchain or hypersnap.');
    const healthy = q.get('healthy') === 'true' || q.get('healthy') === '1';
    const all = this.state.nodes.map((e) => this.#node(e));
    const byId = new Map(all.map((n) => [n.id, n]));
    let nodes = all;
    if (net) nodes = nodes.filter((n) => n.network === net);
    if (healthy) nodes = nodes.filter((n) => n.health.state === 'synced');
    const order = { synced: 0, behind: 1, unknown: 2, stale: 3, invalid: 4, unreachable: 5 };
    nodes.sort((a, b) => (order[a.health.state] ?? 9) - (order[b.health.state] ?? 9) || (a.health.latencyMs ?? 1e9) - (b.health.latencyMs ?? 1e9));
    const shown = new Set(nodes.map((n) => n.id));
    let clients = this.state.clients.map((c) => ({ ...c, nodes: c.nodes.map((id) => byId.get(id)).filter(Boolean).map((n) => ({ id: n.id, network: n.network, state: n.health.state })) }));
    if (net || healthy) clients = clients.filter((c) => c.nodes.some((n) => shown.has(n.id)));
    return {
      schema: SCHEMA, records: RECORDS_URL, measuredBy: this.measuredBy, roundAt: this.state.roundAt,
      nextRoundAt: this.state.roundAt ? this.state.roundAt + EVERY_MS : null, maxLagBlocks: MAX_LAG_BLOCKS, staleAfterMs: STALE_MS,
      references: this.state.references ?? null, error: this.state.error ?? null,
      nodes, clients,
      ...(q.get('include') === 'unproven' ? { unproven: this.state.unproven } : {}),
      at: this.now(),
    };
  }

  /** GET /api/registry/<id>: one node (with its last 48 measurements), or one client. */
  get(id) {
    const e = this.state.nodes.find((x) => x.id === id);
    if (e) return { schema: SCHEMA, kind: 'node', ...this.#node(e, { history: true }), at: this.now() };
    const c = this.state.clients.find((x) => x.id === id);
    if (c) return { schema: SCHEMA, kind: 'client', ...c, nodes: c.nodes.map((nid) => { const n = this.state.nodes.find((x) => x.id === nid); return n ? this.#node(n) : null; }).filter(Boolean), at: this.now() };
    throw fail('Nothing with that id is listed here.', 404);
  }

  /**
   * GET /api/registry/check?url=&fid=&client=: the join page's look at an address, before anything is published.
   * At most one look per address a minute (the same answer again), 8 a minute from one address, 30 a minute in all.
   */
  async check({ url, fid, client, ip = '' } = {}) {
    const node = url ? normalizeEndpoint(url) : null;
    if (url && !node) throw fail('That is not a public address. Give its scheme, host and port, like http://203.0.113.7:3381 or https://hub.example.com.');
    const app = client ? normalizeEndpoint(client) : null;
    if (client && !app) throw fail('The client address must be a public web address, like https://example.com.');
    if (!node && !app) throw fail('url: your node\'s public address.');
    const who = fid == null || fid === '' ? null : Number(fid);
    if (who !== null && !(Number.isInteger(who) && who > 0)) throw fail('fid: a Farcaster ID.');
    // The node is measured at most once a minute per address (the same answer again); the proofs are looked for
    // every time, so "I put it there: check" sees the file at once. 30 looks a minute in all.
    this.asked = this.asked.filter((t) => this.now() - t.at < 60_000);
    if (this.asked.length >= 30) throw fail('Many checks right now. Try again in a minute.', 429);
    if (ip && this.asked.filter((t) => t.ip === ip).length >= 8) throw fail('That is a lot of checks from here. Try again in a minute.', 429);
    this.asked.push({ at: this.now(), ip });
    let measured = null;
    if (node) {
      const hit = this.checks.get(node);
      if (hit && this.now() - hit.at < 60_000) measured = hit.value;
      else {
        const refs = {};
        const pick = async (pub) => (refs[pub] ??= this.references[pub]?.length ? await readReference(this.references[pub], { fetchImpl: this.refFetch, random: this.random, now: this.now }) : null);
        measured = await measure(node, pick, { fetchImpl: this.fetchImpl, now: this.now });
        this.checks.set(node, { at: this.now(), value: measured });
        if (this.checks.size > 500) this.checks.delete(this.checks.keys().next().value);
      }
    }
    // A keeper's egg already covers every address on its host.
    const egg = (u) => this.state.nodes.some((e) => e.proof?.method === 'egg' && e.operator?.fid === who && hostOf(e.url) === hostOf(u));
    const prove = async (u) => (!who ? null : egg(u) ? { ok: true, method: 'egg', where: 'your egg, on this same host' }
      : this.prove(u, who, { fetchImpl: this.fetchImpl }).catch((err) => ({ ok: false, tried: [err.message] })));
    const [nodeProof, clientProof] = await Promise.all([node ? prove(node) : null, app ? prove(app) : null]);
    const listed = node ? this.state.nodes.find((e) => e.url === node) : null;
    return {
      node: node ? { url: node, id: endpointId(node), health: measured ? healthNow(measured, { now: this.now() }) : null, proof: nodeProof, listed: listed ? this.#node(listed) : null } : null,
      client: app ? { url: app, id: endpointId(app), proof: clientProof } : null,
      proofFile: who ? `fid: ${who}` : null,
      wellKnown: node ? `http://${hostOf(node).includes(':') ? `[${hostOf(node)}]` : hostOf(node)}/.well-known/fatline` : null,
      dns: node && !isIP(hostOf(node)) ? { name: `_fatline.${hostOf(node)}`, value: who ? `fid=${who}` : 'fid=<your FID>' } : null,
      record: recordText({ node, clients: app ? [app] : [] }),
      parentUrl: RECORDS_URL,
      at: this.now(),
    };
  }
}

/** The reference nodes, from a fatline config: each network's nodes, by the registry's public network names. */
export function referencesFrom(config) {
  const out = {};
  for (const [pub, key] of Object.entries(NETWORK_KEY)) {
    const nodes = config.networks?.[key]?.nodes ?? [];
    if (nodes.length) out[pub] = nodes.map((n) => String(n.url).replace(/\/$/, ''));
  }
  return out;
}
