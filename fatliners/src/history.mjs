// A history snapshot: the only input the generator accepts. Network-agnostic, text-free.
//
// {
//   schema: 'fatliners.history/1',
//   subject: { kind: 'fid', fid: 18350 } | { kind: 'synthetic', id: 'syn-07' },
//   snapshotAt: 1792600000000,          // ms; nothing after this moment is used
//   registeredAt: null | ms,            // onchain ID_REGISTER time, when known
//   messages: [{
//     hash: '0x<40 hex>',               // the message hash, same on every network that holds it
//     networks: ['farcaster'],          // where this snapshot saw it (provenance, never assumed equal)
//     kind: 'cast' | 'reply' | 'reaction' | 'link',
//     ts: ms,
//     channel: null | '0x<sha256 of parentUrl>',  // hashed: the Atlas never needs channel names
//     parentFid: null | n,              // replies: whose cast it answers
//     targetFid: null | n,              // reactions / links: whom it points at
//     embeds: n, media: n,              // embed count, and how many are images/video
//     long: bool, textLen: n, mentions: n,   // shape of the text, never the text
//   }]
// }
//
// The commitment binds the snapshot to the exact set of message hashes per network. Anyone with a node
// that still holds those messages can recompute it. Raw messages are never part of the public Atlas.

import { canonical } from './canonical.mjs';
import { sha256Hex } from './hash.mjs';

export const HISTORY_SCHEMA = 'fatliners.history/1';
export const NETWORKS = ['farcaster', 'hypersnap'];
export const KINDS = ['cast', 'reply', 'reaction', 'link'];
const HASH = /^0x[0-9a-f]{40}$/;

const fail = (m) => { throw new Error(`history: ${m}`); };

export function subjectKey(subject) {
  if (subject?.kind === 'fid' && Number.isSafeInteger(subject.fid) && subject.fid > 0) return `fid:${subject.fid}`;
  if (subject?.kind === 'synthetic' && /^[a-z0-9-]{1,32}$/.test(subject.id ?? '')) return `synthetic:${subject.id}`;
  return fail('subject must be { kind: "fid", fid } or { kind: "synthetic", id }');
}

/** Checks and normalizes a snapshot. Messages after snapshotAt are dropped, duplicates merged by hash. */
export function validateHistory(h) {
  if (h?.schema !== HISTORY_SCHEMA) fail(`schema must be ${HISTORY_SCHEMA}`);
  subjectKey(h.subject);
  if (!Number.isSafeInteger(h.snapshotAt) || h.snapshotAt <= 0) fail('snapshotAt must be ms');
  if (h.registeredAt != null && (!Number.isSafeInteger(h.registeredAt) || h.registeredAt > h.snapshotAt)) fail('bad registeredAt');
  const byHash = new Map();
  for (const m of h.messages ?? []) {
    const hash = String(m.hash ?? '').toLowerCase();
    if (!HASH.test(hash)) fail(`bad hash ${String(m.hash).slice(0, 44)}`);
    if (!KINDS.includes(m.kind)) fail(`bad kind ${m.kind}`);
    if (!Number.isSafeInteger(m.ts)) fail('ts must be ms');
    if (m.ts > h.snapshotAt) continue;
    const networks = [...new Set(m.networks ?? [])];
    if (!networks.length || networks.some((n) => !NETWORKS.includes(n))) fail(`bad networks for ${hash}`);
    const prev = byHash.get(hash);
    if (prev) { prev.networks = [...new Set([...prev.networks, ...networks])].sort(); continue; }
    byHash.set(hash, {
      hash, networks: networks.sort(), kind: m.kind, ts: m.ts,
      channel: m.channel ?? null, parentFid: m.parentFid ?? null, targetFid: m.targetFid ?? null,
      embeds: m.embeds | 0, media: m.media | 0, long: !!m.long, textLen: m.textLen | 0, mentions: m.mentions | 0,
    });
  }
  const messages = [...byHash.values()].sort((a, b) => a.ts - b.ts || (a.hash < b.hash ? -1 : 1));
  return { schema: HISTORY_SCHEMA, subject: h.subject, snapshotAt: h.snapshotAt, registeredAt: h.registeredAt ?? null, messages };
}

/** Per network: how many messages, and a hash over their sorted hashes. */
export function provenance(history) {
  const out = {};
  for (const n of NETWORKS) {
    const hashes = history.messages.filter((m) => m.networks.includes(n)).map((m) => m.hash).sort();
    out[n] = hashes.length ? { count: hashes.length, root: sha256Hex(hashes.join(',')) } : null;
  }
  return out;
}

/** The verifiable snapshot commitment: subject, time, and the exact message set on each network. */
export function commitment(history) {
  return sha256Hex(canonical({
    schema: history.schema, subject: subjectKey(history.subject),
    snapshotAt: history.snapshotAt, registeredAt: history.registeredAt, networks: provenance(history),
  }));
}
