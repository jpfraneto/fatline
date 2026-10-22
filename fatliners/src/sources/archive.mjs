// Read one FID's history from the Fatline archive (the indexer's SQLite file). READ-ONLY.
//
// Contract agreed with session infinicaster-28 (archive owner), 2026-10-22:
//   - open the file readOnly, SELECT only, short reads (the indexer writes it live, WAL mode)
//   - tables/columns: fl_messages(network, dedup_key, fid, msg_type, protocol_ts, status, body)
//   - only status = 'merged' (a deleted cast stays as 'displaced': deleted means deleted here too)
//   - never read fl_sources.node_url (private)
// Text is reduced to its length before it leaves this function. Channel URLs are hashed.

import { HISTORY_SCHEMA } from '../history.mjs';
import { sha256Hex } from '../hash.mjs';

const MEDIA = /\.(png|jpe?g|gif|webp|avif|mp4|mov|webm|m3u8)(\?|$)|imagedelivery\.net|stream\.warpcast\.com/i;
const KIND = { MESSAGE_TYPE_CAST_ADD: 'cast', MESSAGE_TYPE_REACTION_ADD: 'reaction', MESSAGE_TYPE_LINK_ADD: 'link' };

/** Pure: archive rows → history snapshot. Exported for tests. */
export function rowsToHistory(fid, rows, { snapshotAt, registeredAt = null }) {
  const messages = [];
  for (const row of rows) {
    const kind0 = KIND[row.msg_type];
    if (!kind0 || row.status !== 'merged' || row.protocol_ts == null) continue;
    let body = {};
    try { body = row.body ? JSON.parse(row.body) : {}; } catch { body = {}; }
    if (body.truncated) body = {};
    const m = { hash: row.dedup_key, networks: [row.network], ts: Number(row.protocol_ts) };
    if (kind0 === 'cast') {
      const embeds = Array.isArray(body.embeds) ? body.embeds : [];
      Object.assign(m, {
        kind: body.parent ? 'reply' : 'cast',
        parentFid: body.parent?.fid ?? null,
        channel: body.parentUrl ? sha256Hex(String(body.parentUrl)) : null,
        embeds: embeds.length,
        media: embeds.filter((e) => typeof e === 'string' && MEDIA.test(e)).length,
        long: !!body.long,
        textLen: typeof body.text === 'string' ? [...body.text].length : 0,
        mentions: Array.isArray(body.mentions) ? body.mentions.length : 0,
      });
    } else if (kind0 === 'reaction') {
      Object.assign(m, { kind: 'reaction', targetFid: body.target?.fid ?? null });
    } else {
      Object.assign(m, { kind: 'link', targetFid: body.targetFid ?? null });
    }
    messages.push(m);
  }
  return { schema: HISTORY_SCHEMA, subject: { kind: 'fid', fid }, snapshotAt, registeredAt, messages };
}

/** The repo's archive file: .fatline/ after the Fatline rename, .infinicaster/ before it. Node only. */
export function defaultDbPath(repoRoot) {
  const { existsSync } = process.getBuiltinModule('node:fs');
  for (const dir of ['.fatline', '.infinicaster']) {
    const p = `${repoRoot}/${dir}/indexer.sqlite`;
    if (existsSync(p)) return p;
  }
  return `${repoRoot}/.fatline/indexer.sqlite`;
}

export async function readArchive(dbPath, fid, { snapshotAt = Date.now(), registeredAt = null } = {}) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const rows = db.prepare(`SELECT network, dedup_key, msg_type, protocol_ts, status, body FROM fl_messages
      WHERE fid = ? AND msg_type IN ('MESSAGE_TYPE_CAST_ADD','MESSAGE_TYPE_REACTION_ADD','MESSAGE_TYPE_LINK_ADD')
        AND status = 'merged' AND protocol_ts <= ?`).all(fid, snapshotAt);
    const networks = db.prepare('SELECT network, label FROM fl_sources ORDER BY id').all(); // never node_url
    return { history: rowsToHistory(fid, rows, { snapshotAt, registeredAt }), sources: networks };
  } finally {
    db.close();
  }
}
