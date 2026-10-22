// History → the five dimensions of life. Every output is a ratio, a shape or a bucket, never a raw
// volume, so a loud account has no more "stuff" to draw than a quiet one. Text is never read.

import { round6 } from './canonical.mjs';

export const FEATURES_VERSION = 'fatliners.features/1';
const DAY = 86_400_000;
export const PULSE_BINS = 48;
// A return: a silence of at least 90 days, followed by activity, that is also unusual for THIS person
// (at least 6× their median gap). A sparse poster's normal rhythm is not an absence.
const ABSENCE_DAYS = 90, ABSENCE_FACTOR = 6;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const share = (a, b) => (b > 0 ? a / b : 0);
const r = (x) => round6(x);

function entropyEvenness(counts) {
  const total = counts.reduce((s, c) => s + c, 0);
  if (counts.length < 2 || !total) return 0;
  const h = -counts.reduce((s, c) => (c ? s + (c / total) * Math.log(c / total) : s), 0);
  return h / Math.log(counts.length);
}

export function extractFeatures(history) {
  const { messages, snapshotAt } = history;
  const posts = messages.filter((m) => m.kind === 'cast' || m.kind === 'reply');
  const replies = messages.filter((m) => m.kind === 'reply');
  const reactions = messages.filter((m) => m.kind === 'reaction');
  const self = history.subject.kind === 'fid' ? history.subject.fid : null;

  // ---------------------------------------------------------------- ROOTS: existence through time
  const firstTs = history.registeredAt ?? messages[0]?.ts ?? snapshotAt;
  const spanDays = Math.max(1, (snapshotAt - firstTs) / DAY);
  const months = Math.max(1, Math.ceil(spanDays / 30));
  const activeMonthSet = new Set(messages.map((m) => Math.floor((m.ts - firstTs) / (30 * DAY))));
  const gaps = messages.slice(1).map((m, i) => (m.ts - messages[i].ts) / DAY);
  const median = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
  const returns = gaps.filter((g) => g >= ABSENCE_DAYS && g >= ABSENCE_FACTOR * median).length;
  const longestGap = Math.max(0, ...gaps);
  const roots = {
    ageDays: Math.round(spanDays),
    ageKnown: history.registeredAt != null, // false: age is a lower bound (oldest message the node still holds)
    continuity: r(clamp01(activeMonthSet.size / months)),
    returns,
    longestSilenceDays: Math.round(longestGap),
  };

  // ---------------------------------------------------------------- ORBIT: connection with others
  const partnerCounts = new Map();
  for (const m of replies) if (m.parentFid && m.parentFid !== self) partnerCounts.set(m.parentFid, (partnerCounts.get(m.parentFid) ?? 0) + 1);
  const othersReplies = [...partnerCounts.values()].reduce((s, c) => s + c, 0);
  // Bonds: what share of their replies go to their 3 most-answered people, and how many people their
  // replies effectively spread over (exp of entropy). Both are shapes of the distribution, not volumes.
  const pc = [...partnerCounts.values()].sort((a, b) => b - a);
  const top3 = pc.slice(0, 3).reduce((s, c) => s + c, 0);
  const ent = othersReplies ? -pc.reduce((s, c) => s + (c / othersReplies) * Math.log(c / othersReplies), 0) : 0;
  const touched = new Set([...partnerCounts.keys(), ...messages.filter((m) => m.targetFid && m.targetFid !== self).map((m) => m.targetFid)]);
  const orbit = {
    replyShare: r(share(replies.length, posts.length)),
    // How much of their conversation returns to the same few people. Needs ≥8 replies to mean anything.
    // Reciprocity proper needs the other side's replies, which a per-FID archive doesn't hold.
    bonds: r(othersReplies >= 8 ? share(top3, othersReplies) : 0),
    circle: r(Math.min(99, Math.exp(ent))), // effective number of people their replies spread over
    // How evenly replies spread over the people they answer (0..1). Needs ≥8 distinct people.
    spread: r(pc.length >= 8 ? ent / Math.log(pc.length) : 0),
    // Breadth as a log bucket 0..1 (1 ≈ 1,000+ distinct people). Shown in the owner's Atlas only;
    // NOT used for any trait, because it grows with volume.
    breadth: r(clamp01(Math.log10(1 + touched.size) / 3)),
  };

  // ---------------------------------------------------------------- VOICE: how they express themselves
  const voice = {
    listening: r(share(reactions.length, reactions.length + posts.length)), // reacting vs speaking
    mediaShare: r(share(posts.filter((m) => m.media > 0).length, posts.length)),
    linkShare: r(share(posts.filter((m) => m.embeds > m.media).length, posts.length)),
    length: r(clamp01(share(posts.reduce((s, m) => s + m.textLen, 0), posts.length) / 320)),
    longShare: r(share(posts.filter((m) => m.long).length, posts.length)),
    mentionShare: r(share(posts.filter((m) => m.mentions > 0).length, posts.length)),
  };

  // ---------------------------------------------------------------- PULSE: rhythm over the whole life
  const counts = new Array(PULSE_BINS).fill(0);
  const binMs = Math.max(1, snapshotAt - firstTs) / PULSE_BINS;
  for (const m of messages) counts[Math.min(PULSE_BINS - 1, Math.max(0, Math.floor((m.ts - firstTs) / binMs)))]++;
  // sqrt then divide by the max: the curve keeps its shape whatever the volume.
  const root = counts.map(Math.sqrt);
  const max = Math.max(...root);
  const curve = root.map((v, i) => {
    const a = root[i - 1] ?? v, b = root[i + 1] ?? v;
    return max ? r((a + 2 * v + b) / 4 / max) : 0;
  });
  const weeks = new Map();
  for (const m of messages) { const w = Math.floor((m.ts - firstTs) / (7 * DAY)); weeks.set(w, (weeks.get(w) ?? 0) + 1); }
  const nWeeks = Math.max(1, Math.ceil(spanDays / 7));
  const weekly = Array.from({ length: nWeeks }, (_, i) => weeks.get(i) ?? 0);
  const mean = weekly.reduce((s, c) => s + c, 0) / nWeeks;
  const sd = Math.sqrt(weekly.reduce((s, c) => s + (c - mean) ** 2, 0) / nWeeks);
  const pulse = {
    curve,
    burstiness: r(mean + sd > 0 ? (sd - mean) / (sd + mean) : 0), // -1 metronome … 0 random … 1 bursts
    activeWeekShare: r(share(weeks.size, nWeeks)),
    peakAt: r(max ? counts.indexOf(Math.max(...counts)) / (PULSE_BINS - 1) : 0.5),
    silent: messages.length === 0,
  };

  // ---------------------------------------------------------------- BLOOM: what they cultivate
  const chan = new Map();
  for (const m of posts) if (m.channel) chan.set(m.channel, (chan.get(m.channel) ?? 0) + 1);
  const chanCounts = [...chan.values()];
  const inChannels = chanCounts.reduce((s, c) => s + c, 0);
  const bloom = {
    channels: Math.min(chan.size, 99),
    evenness: r(entropyEvenness(chanCounts)),          // spread evenly (1) or one home (0)
    rootedShare: r(share(inChannels, posts.length)),     // how much of their posting lives in channels
    makerShare: voice.mediaShare,                        // creative practice, as structure only
  };

  return { version: FEATURES_VERSION, roots, orbit, voice, pulse, bloom };
}
