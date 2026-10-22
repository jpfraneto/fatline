// Synthetic histories. Invented on purpose, labeled on purpose: subject.kind = 'synthetic', never a FID,
// so no one can mistake one of these for a real person's history.
//
// A profile is a few knobs; history() turns it into deterministic messages (same profile, same bytes).

import { HISTORY_SCHEMA } from '../history.mjs';
import { sha256Hex } from '../hash.mjs';
import { prng } from '../prng.mjs';

const DAY = 86_400_000;
export const SYNTHETIC_NOW = Date.UTC(2026, 9, 21); // fixed "now" so fixtures never drift

// knobs: days (age), n (messages), reply, react, media, link, len (0..1 of 320), long, mention,
// channels (count), even (0..1), partners, recurrence, windows [[from,to] fractions of life],
// bursts [[at, width, weight]], steady (0..1 regular spacing)
export const ARCHETYPES = [
  { id: 'syn-newcomer', label: 'Newcomer: three weeks old', days: 21, n: 18, reply: 0.3, react: 0.4, media: 0.1, len: 0.25, channels: 2, even: 0.5, partners: 6 },
  { id: 'syn-lurker', label: 'Lurker: three years, almost only likes', days: 1100, n: 260, reply: 0.2, react: 0.97, media: 0, len: 0.1, channels: 0, partners: 3 },
  { id: 'syn-elder', label: 'Elder broadcaster: daily for 3 years', days: 1150, n: 3200, reply: 0.05, react: 0.25, media: 0.15, len: 0.4, channels: 3, even: 0.4, partners: 40, steady: 0.9 },
  { id: 'syn-talker', label: 'Conversationalist: mostly replies, same friends', days: 700, n: 1400, reply: 0.82, react: 0.3, len: 0.2, channels: 4, even: 0.6, partners: 9, recurrence: 0.75, close: 2, mention: 0.4 },
  { id: 'syn-returner', label: 'Returner: two long absences', days: 1000, n: 600, reply: 0.35, react: 0.4, len: 0.3, channels: 3, even: 0.5, partners: 30, windows: [[0, 0.22], [0.48, 0.6], [0.85, 1]] },
  { id: 'syn-painter', label: 'Visual artist: images most days', days: 520, n: 900, reply: 0.2, react: 0.3, media: 0.7, len: 0.12, channels: 2, even: 0.3, partners: 50 },
  { id: 'syn-storyteller', label: 'Storyteller: long casts', days: 800, n: 300, reply: 0.15, react: 0.2, len: 0.75, long: 0.25, channels: 2, even: 0.2, partners: 20 },
  { id: 'syn-wanderer', label: 'Wanderer: twelve channels, evenly', days: 600, n: 1100, reply: 0.3, react: 0.35, media: 0.1, len: 0.3, channels: 12, even: 0.95, partners: 200 },
  { id: 'syn-devotee', label: 'Devotee: one channel, for years', days: 900, n: 700, reply: 0.4, react: 0.3, len: 0.3, channels: 1, partners: 25, recurrence: 0.3 },
  { id: 'syn-burst', label: 'Burst poster: three storms, long calm', days: 500, n: 800, reply: 0.25, react: 0.3, media: 0.2, len: 0.2, channels: 3, even: 0.7, partners: 60, bursts: [[0.15, 0.015, 0.3], [0.55, 0.01, 0.35], [0.9, 0.02, 0.3]] },
  { id: 'syn-unwritten', label: 'Unwritten: registered, never posted', days: 400, n: 0 },
  { id: 'syn-linker', label: 'Linker: shares the web', days: 650, n: 700, reply: 0.1, react: 0.2, link: 0.6, len: 0.25, channels: 5, even: 0.5, partners: 80 },
];

/** 24 more profiles with knobs drawn from a seed, to fill a 36-being contact sheet. */
export function crowd(count = 24) {
  return Array.from({ length: count }, (_, i) => {
    const r = prng('0xfatliners-crowd', String(i));
    const quiet = r.next() < 0.4;
    const windows = r.next() < 0.3 ? [[0, r.range(0.2, 0.4)], [r.range(0.55, 0.75), 1]] : undefined;
    return {
      id: `syn-crowd-${String(i + 1).padStart(2, '0')}`,
      label: `Crowd #${i + 1} (${quiet ? 'quiet' : 'active'})`,
      days: Math.round(r.range(30, 1300)), n: quiet ? r.int(3, 60) : r.int(200, 2500),
      reply: r.range(0, 0.9), react: r.range(0, 0.95), media: r.next() < 0.3 ? r.range(0.3, 0.8) : r.range(0, 0.2),
      link: r.next() < 0.2 ? r.range(0.35, 0.7) : r.range(0, 0.2), len: r.range(0.05, 0.85), long: r.next() < 0.15 ? 0.2 : 0,
      mention: r.range(0, 0.5), channels: r.int(0, 14), even: r.next(), partners: r.int(1, 300),
      recurrence: r.next() < 0.35 ? r.range(0.4, 0.9) : r.range(0, 0.3), windows,
      bursts: r.next() < 0.3 ? [[r.range(0.1, 0.9), 0.015, 0.4]] : undefined, steady: r.next() < 0.25 ? 0.85 : 0,
    };
  });
}

export function history(p, { now = SYNTHETIC_NOW, networks = ['farcaster'] } = {}) {
  const r = prng(sha256Hex(p.id), 'messages');
  const born = now - p.days * DAY;
  const windows = p.windows ?? [[0, 1]];
  const span = windows.reduce((s, [a, b]) => s + b - a, 0);
  const uniformT = (u) => { // u in [0,1) → a point inside the active windows
    let x = u * span;
    for (const [a, b] of windows) { if (x <= b - a) return a + x; x -= b - a; }
    return windows.at(-1)[1];
  };
  const chanIds = Array.from({ length: p.channels ?? 0 }, (_, i) => sha256Hex(`${p.id}/channel/${i}`));
  const chanWeights = chanIds.map((_, i) => (p.even ?? 0.5) + (1 - (p.even ?? 0.5)) * 6 ** -i); // uneven: one dominant
  const wsum = chanWeights.reduce((s, w) => s + w, 0);
  const pickChannel = () => { let x = r.next() * wsum; for (let i = 0; i < chanIds.length; i++) { x -= chanWeights[i]; if (x <= 0) return chanIds[i]; } return chanIds.at(-1); };
  const partners = Array.from({ length: Math.max(1, p.partners ?? 1) }, (_, i) => 100_000 + i * 37);
  const close = partners.slice(0, Math.max(1, Math.min(partners.length, p.close ?? 5)));

  const messages = [];
  for (let i = 0; i < p.n; i++) {
    let t;
    const bu = r.next();
    let acc = 0, chosen = null;
    for (const b of p.bursts ?? []) { acc += b[2]; if (bu < acc) { chosen = b; break; } }
    if (chosen) t = Math.min(0.999, Math.max(0, chosen[0] + (r.next() + r.next() + r.next() - 1.5) * chosen[1] * 2));
    else if ((p.steady ?? 0) > 0) t = uniformT(((i + 0.5) / p.n) + (r.next() - 0.5) * (1 - p.steady) / Math.max(1, p.n) * 40);
    else t = uniformT(r.next());
    const ts = Math.round(born + Math.min(0.9999, Math.max(0, t)) * (now - born));
    const isReaction = r.next() < (p.react ?? 0.3);
    const hash = '0x' + sha256Hex(`${p.id}#${i}`).slice(2, 42);
    if (isReaction) {
      messages.push({ hash, networks, kind: r.next() < 0.03 ? 'link' : 'reaction', ts, targetFid: r.pick(partners) });
      continue;
    }
    const isReply = r.next() < (p.reply ?? 0.3);
    const media = r.next() < (p.media ?? 0) ? 1 : 0;
    const link = r.next() < (p.link ?? 0) ? 1 : 0;
    const len = Math.max(0, Math.round(320 * (p.len ?? 0.3) * r.range(0.4, 1.6)));
    messages.push({
      hash, networks, kind: isReply ? 'reply' : 'cast', ts,
      channel: chanIds.length && !isReply ? pickChannel() : null,
      parentFid: isReply ? (r.next() < (p.recurrence ?? 0.1) ? r.pick(close) : r.pick(partners)) : null,
      embeds: media + link, media, long: r.next() < (p.long ?? 0), textLen: len, mentions: r.next() < (p.mention ?? 0.1) ? 1 : 0,
    });
  }
  return {
    schema: HISTORY_SCHEMA, subject: { kind: 'synthetic', id: p.id }, label: p.label,
    snapshotAt: now, registeredAt: born, messages,
  };
}

export const allProfiles = () => [...ARCHETYPES, ...crowd()];
