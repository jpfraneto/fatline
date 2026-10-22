// The Farline archive: one personal archive per FID, fed by independent network adapters.
//
// Each adapter (one per network node) calls ingest() with normalized events. This module is the only
// code that writes these tables. Two tables matter:
//   fl_events    the log: every event each adapter saw, as it saw it. Append-only, idempotent.
//   fl_messages  the state: what each network says about each message now (merged/pruned/revoked/removed).
// Networks are never merged into one truth. A message seen on both has two fl_messages rows with the
// same dedup_key (its hash). "Never seen on a network" is the absence of a row: on Farcaster that can also
// mean it existed before we started watching (pruned history is not served by *ByFid backfills).
// Content is never deleted: a pruned, revoked or displaced message keeps its body.
// Hashes are lowercase hex, 0x + 40 characters. The adapter normalizes (the HTTP API mixes hex and base64).
//
// The interface and the reasons are in research/FARLINE-ARCHIVE.md. Engine: SQLite (node:sqlite) for now.

export const NETWORKS = ['farcaster', 'hypersnap'];
export const EVENT_TYPES = ['MERGE_MESSAGE', 'PRUNE_MESSAGE', 'REVOKE_MESSAGE', 'MERGE_FAILURE', 'MERGE_ON_CHAIN_EVENT', 'MERGE_USERNAME_PROOF', 'BACKFILL'];
// What each event says about its message on that network. A message displaced by a newer one
// (a remove, a re-like, a newer profile field) becomes 'displaced'.
const STATUS_OF = { PRUNE_MESSAGE: 'pruned', REVOKE_MESSAGE: 'revoked', MERGE_FAILURE: 'failed' }; // everything else: merged
const HASH = /^0x[0-9a-f]{40}$/;
export const TYPES = {
  cast: ['MESSAGE_TYPE_CAST_ADD'],
  reaction: ['MESSAGE_TYPE_REACTION_ADD'],
  link: ['MESSAGE_TYPE_LINK_ADD'],
  profile: ['MESSAGE_TYPE_USER_DATA_ADD'],
  verification: ['MESSAGE_TYPE_VERIFICATION_ADD_ETH_ADDRESS'],
};
const MAX_JSON = 64 * 1024; // an event bigger than this keeps a reference, not a copy

const fail = (msg) => { throw Object.assign(new Error(`archive: ${msg}`), { status: 400 }); };
const jsonOrNull = (x) => {
  if (x === undefined || x === null) return null;
  const s = JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  return s.length > MAX_JSON ? JSON.stringify({ truncated: true, bytes: s.length }) : s;
};

export class Archive {
  constructor(db, { now = Date.now } = {}) {
    this.db = db;
    this.now = now;
    db.exec(`
      PRAGMA busy_timeout = 5000; -- adapters run as separate processes; wait for the writer instead of failing
      CREATE TABLE IF NOT EXISTS fl_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT, network TEXT NOT NULL, node_url TEXT NOT NULL, label TEXT NOT NULL,
        UNIQUE (network, node_url));
      CREATE TABLE IF NOT EXISTS fl_cursors (
        source_id INTEGER NOT NULL, shard INTEGER NOT NULL, event_id INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, shard));
      CREATE TABLE IF NOT EXISTS fl_fids (fid INTEGER PRIMARY KEY, added_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS fl_backfill (
        source_id INTEGER NOT NULL, fid INTEGER NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL,
        page_token TEXT, done_at INTEGER, PRIMARY KEY (source_id, fid, kind));
      CREATE TABLE IF NOT EXISTS fl_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL, network TEXT NOT NULL, ref TEXT NOT NULL,
        shard INTEGER, event_id INTEGER, event_type TEXT NOT NULL, dedup_key TEXT NOT NULL, fid INTEGER NOT NULL,
        msg_type TEXT, protocol_ts INTEGER, signer TEXT, ingested_at INTEGER NOT NULL, body TEXT, raw TEXT,
        UNIQUE (network, ref));
      CREATE INDEX IF NOT EXISTS fl_events_fid ON fl_events (fid, protocol_ts);
      CREATE INDEX IF NOT EXISTS fl_events_key ON fl_events (dedup_key);
      CREATE TABLE IF NOT EXISTS fl_messages (
        network TEXT NOT NULL, dedup_key TEXT NOT NULL, fid INTEGER NOT NULL, msg_type TEXT, protocol_ts INTEGER, signer TEXT,
        status TEXT NOT NULL, first_event INTEGER NOT NULL, last_event INTEGER NOT NULL, body TEXT,
        PRIMARY KEY (network, dedup_key));
      CREATE INDEX IF NOT EXISTS fl_messages_fid ON fl_messages (fid, protocol_ts);`);
  }

  // ------------------------------------------------------------------ for adapters

  /** Registers an adapter (get or create). The node URL stays server-side. */
  source({ network, nodeUrl, label }) {
    if (!NETWORKS.includes(network)) fail(`unknown network "${network}"`);
    if (typeof nodeUrl !== 'string' || !/^https?:\/\//.test(nodeUrl)) fail('nodeUrl must be an http(s) URL');
    // The label is what readers see; the latest registration wins, so a corrected label replaces an old one.
    this.db.prepare(`INSERT INTO fl_sources (network, node_url, label) VALUES (?, ?, ?)
      ON CONFLICT (network, node_url) DO UPDATE SET label = excluded.label`).run(network, nodeUrl, String(label ?? network).slice(0, 64));
    return this.db.prepare('SELECT id FROM fl_sources WHERE network = ? AND node_url = ?').get(network, nodeUrl).id;
  }

  #sourceRow(sourceId) {
    const row = this.db.prepare('SELECT * FROM fl_sources WHERE id = ?').get(sourceId);
    if (!row) fail(`unknown source ${sourceId}`);
    return row;
  }

  /** The last event id fully ingested from this shard, or null. */
  cursor(sourceId, shard) {
    return this.db.prepare('SELECT event_id FROM fl_cursors WHERE source_id = ? AND shard = ?').get(sourceId, shard)?.event_id ?? null;
  }

  /**
   * One transaction: append the events, update each network's message state, move the cursor.
   * Idempotent: replaying events changes nothing. Returns how many events were new.
   */
  ingest(sourceId, events, { shard = null, cursor = null } = {}) {
    const source = this.#sourceRow(sourceId);
    const clean = events.map((e) => this.#check(e, source));
    const insert = this.db.prepare(`INSERT OR IGNORE INTO fl_events
      (source_id, network, ref, shard, event_id, event_type, dedup_key, fid, msg_type, protocol_ts, signer, ingested_at, body, raw)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const getState = this.db.prepare('SELECT * FROM fl_messages WHERE network = ? AND dedup_key = ?');
    // Fills in what was missing (a prune can be the first time we see a message), never erases content.
    const upsert = this.db.prepare(`INSERT INTO fl_messages (network, dedup_key, fid, msg_type, protocol_ts, signer, status, first_event, last_event, body)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (network, dedup_key) DO UPDATE SET status = excluded.status, last_event = excluded.last_event,
        msg_type = COALESCE(fl_messages.msg_type, excluded.msg_type), protocol_ts = COALESCE(fl_messages.protocol_ts, excluded.protocol_ts),
        signer = COALESCE(fl_messages.signer, excluded.signer), body = COALESCE(fl_messages.body, excluded.body)`);
    let added = 0;
    const at = this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const e of clean) {
        const r = insert.run(sourceId, source.network, e.ref, e.shard, e.eventId, e.eventType, e.dedupKey, e.fid, e.msgType, e.protocolTs, e.signer, at, e.body, e.raw);
        if (!r.changes) continue; // seen before: nothing changes
        added++;
        const eventRow = Number(r.lastInsertRowid);
        const status = STATUS_OF[e.eventType] ?? 'merged';
        const prev = getState.get(source.network, e.dedupKey);
        // A backfill never undoes what an event already said (prune, revoke, displace),
        // and a failed merge never overrides a message the network does hold.
        const keep = prev && ((e.eventType === 'BACKFILL' && prev.status !== 'merged') || (status === 'failed' && prev.status !== 'failed'));
        upsert.run(source.network, e.dedupKey, e.fid, e.msgType, e.protocolTs, e.signer, keep ? prev.status : status, prev?.first_event ?? eventRow, eventRow, e.body);
        // Messages this merge displaced (node's deletedMessages, or a CAST_REMOVE's target): on this network only.
        if (status === 'merged') {
          for (const d of e.displaced) {
            const t = getState.get(source.network, d.key);
            upsert.run(source.network, d.key, t?.fid ?? d.fid ?? e.fid, d.msgType, d.protocolTs, d.signer, 'displaced', t?.first_event ?? eventRow, eventRow, d.body);
          }
        }
      }
      if (shard !== null && cursor !== null) {
        // Cursors only move forward.
        this.db.prepare(`INSERT INTO fl_cursors (source_id, shard, event_id, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (source_id, shard) DO UPDATE SET event_id = MAX(fl_cursors.event_id, excluded.event_id), updated_at = excluded.updated_at`)
          .run(sourceId, Number(shard), Number(cursor), at);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return added;
  }

  /** Node output is untrusted: check every field, build the raw reference here. */
  #check(e, source) {
    if (!e || typeof e !== 'object') fail('event must be an object');
    if (e.network && e.network !== source.network) fail(`event says ${e.network}, source is ${source.network}`);
    if (!EVENT_TYPES.includes(e.eventType)) fail(`unknown eventType "${e.eventType}"`);
    const fid = Number(e.fid);
    if (!Number.isSafeInteger(fid) || fid <= 0) fail('fid must be a positive integer');
    const key = String(e.dedupKey ?? '').toLowerCase();
    if (!/^(0x[0-9a-f]{40}|[\w:.|-]{3,128})$/.test(key)) fail(`bad dedupKey "${String(e.dedupKey).slice(0, 40)}"`);
    const signer = e.signer ? String(e.signer).toLowerCase() : null;
    if (signer && !/^0x[0-9a-f]{64}$/.test(signer)) fail('signer must be a 32-byte Ed25519 key in hex');
    // displaced: [hash] or [{ hash, fid, msgType, protocolTs, signer, body }] when the node sent the full message.
    if (e.displaced !== undefined && !Array.isArray(e.displaced)) fail('displaced must be an array');
    // A CAST_REMOVE that displaced nothing on this node names its cast in `target`: same effect.
    const list = [...(e.displaced ?? []), ...(e.target ? [e.target] : [])];
    const displaced = list.slice(0, 1000).map((d) => {
      const o = typeof d === 'string' ? { hash: d } : d ?? {};
      const k = String(o.hash ?? '').toLowerCase();
      if (!HASH.test(k)) fail('displaced hashes must be 0x + 40 hex');
      const dts = o.protocolTs === undefined || o.protocolTs === null ? null : Number(o.protocolTs);
      const ds = o.signer ? String(o.signer).toLowerCase() : null;
      return { key: k, fid: Number(o.fid) > 0 ? Number(o.fid) : null, msgType: o.msgType ? String(o.msgType).slice(0, 48) : null,
        protocolTs: Number.isFinite(dts) ? dts : null, signer: ds && /^0x[0-9a-f]{64}$/.test(ds) ? ds : null, body: jsonOrNull(o.body) };
    });
    const backfill = e.eventType === 'BACKFILL';
    const given = (x) => x !== null && x !== undefined && x !== '';
    const shard = backfill ? null : given(e.shard) ? Number(e.shard) : NaN;
    const eventId = backfill ? null : given(e.eventId) ? Number(e.eventId) : NaN;
    if (!backfill && (!Number.isSafeInteger(shard) || shard < 0 || !Number.isSafeInteger(eventId) || eventId < 0)) fail('shard and eventId are required for node events');
    const ts = e.protocolTs === null || e.protocolTs === undefined ? null : Number(e.protocolTs);
    if (ts !== null && !Number.isFinite(ts)) fail('protocolTs must be milliseconds');
    return {
      // Event ids repeat across networks, so the network is always part of the reference.
      ref: backfill ? `${source.network}:backfill:${key}` : `${source.network}:${shard}:${eventId}`,
      shard, eventId, eventType: e.eventType, dedupKey: key, fid, displaced, signer,
      msgType: e.msgType ? String(e.msgType).slice(0, 48) : null, protocolTs: ts,
      body: jsonOrNull(e.body), raw: jsonOrNull(e.raw),
    };
  }

  /** FIDs that have an archive. */
  fids() { return this.db.prepare('SELECT fid FROM fl_fids ORDER BY fid').all().map((r) => r.fid); }

  track(fid) {
    fid = Number(fid);
    if (!Number.isSafeInteger(fid) || fid <= 0) fail('fid must be a positive integer');
    this.db.prepare('INSERT OR IGNORE INTO fl_fids (fid, added_at) VALUES (?, ?)').run(fid, this.now());
  }

  backfill(sourceId, fid, kind, { state, pageToken = null } = {}) {
    if (!['running', 'done', 'failed'].includes(state)) fail('state must be running, done or failed');
    this.db.prepare(`INSERT INTO fl_backfill (source_id, fid, kind, state, page_token, done_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (source_id, fid, kind) DO UPDATE SET state = excluded.state, page_token = excluded.page_token, done_at = excluded.done_at`)
      .run(sourceId, Number(fid), String(kind).slice(0, 24), state, pageToken, state === 'done' ? this.now() : null);
  }

  /** With a kind: { state, pageToken, doneAt } or null, to resume. Without: every kind for that FID. */
  backfillState(sourceId, fid, kind) {
    const q = 'SELECT kind, state, page_token AS pageToken, done_at AS doneAt FROM fl_backfill WHERE source_id = ? AND fid = ?';
    if (kind === undefined) return this.db.prepare(q).all(sourceId, Number(fid));
    const row = this.db.prepare(`${q} AND kind = ?`).get(sourceId, Number(fid), String(kind));
    return row ? { state: row.state, pageToken: row.pageToken, doneAt: row.doneAt } : null;
  }

  /** The node no longer has the events after our cursor: backfill every tracked FID again for this source. */
  markGap(sourceId) {
    this.db.prepare("UPDATE fl_backfill SET state = 'running', page_token = NULL, done_at = NULL WHERE source_id = ?").run(sourceId);
  }

  // ------------------------------------------------------------------ for the API

  /** One archive for a FID, newest first, each message with what every network says about it. */
  read(fid, { before = null, types = null, limit = 50 } = {}) {
    fid = Number(fid);
    if (!Number.isSafeInteger(fid) || fid <= 0) fail('fid must be a positive integer');
    const msgTypes = (types ?? ['cast']).flatMap((t) => TYPES[t] ?? []);
    if (!msgTypes.length) fail(`types must be some of: ${Object.keys(TYPES).join(', ')}`);
    const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const marks = msgTypes.map(() => '?').join(',');
    // Paging cursor "<ms>_<key>": messages can share a timestamp, so the key breaks ties. A bare ms also works.
    const [beforeTs, beforeKey] = before ? String(before).split('_') : [];
    const ts0 = Number.isFinite(Number(beforeTs)) && beforeTs !== undefined ? Number(beforeTs) : Number.MAX_SAFE_INTEGER;
    const key0 = beforeKey && /^[\w:.|-]{3,128}$/.test(beforeKey) ? beforeKey.toLowerCase() : '';
    const keys = this.db.prepare(`SELECT dedup_key, MAX(protocol_ts) AS ts FROM fl_messages
      WHERE fid = ? AND msg_type IN (${marks})
      GROUP BY dedup_key HAVING ts < ? OR (ts = ? AND dedup_key < ?)
      ORDER BY ts DESC, dedup_key DESC LIMIT ?`).all(fid, ...msgTypes, ts0, ts0, key0, cap);
    const rows = keys.length
      ? this.db.prepare(`SELECT * FROM fl_messages WHERE dedup_key IN (${keys.map(() => '?').join(',')})`).all(...keys.map((k) => k.dedup_key))
      : [];
    const items = keys.map(({ dedup_key: key, ts }) => {
      const mine = rows.filter((r) => r.dedup_key === key);
      const best = mine.find((r) => r.status === 'merged' && r.body) ?? mine.find((r) => r.body) ?? mine[0];
      return {
        key, fid, type: best.msg_type, at: ts, signer: best.signer,
        body: best.body ? JSON.parse(best.body) : null,
        networks: Object.fromEntries(NETWORKS.map((n) => [n, mine.find((r) => r.network === n)?.status ?? null])),
      };
    });
    return { fid, items, sources: this.sources(), more: items.length === cap ? `${items.at(-1).at}_${items.at(-1).key}` : null };
  }

  /** What each adapter has done, without its node URL. */
  sources() {
    return this.db.prepare(`SELECT s.id, s.network, s.label, MAX(c.updated_at) AS cursorAt,
        (SELECT MAX(ingested_at) FROM fl_events e WHERE e.source_id = s.id) AS lastEventAt
      FROM fl_sources s LEFT JOIN fl_cursors c ON c.source_id = s.id GROUP BY s.id ORDER BY s.id`).all()
      .map((r) => ({ network: r.network, label: r.label, cursorAt: r.cursorAt, lastEventAt: r.lastEventAt }));
  }
}
