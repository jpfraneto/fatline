// For you: the landing of a Fatline. Not everything, in order: a handful of casts worth answering, from the people you
// follow and from the people they are paying attention to. Read from this server's node and kept for a few minutes;
// the iPhone app scores the same way (apps/ios).
//
//   Pool A: what the people you follow said in the last day and a half (their latest top-level casts).
//   Pool B: what they liked and recast in that time, from anyone: the way to meet people you don't follow yet.
//   score = (1 + social + conversation + near + new) / (1 + hours/8)^1.2
//     social        2·log2(1 + Σ over people you follow who reacted: like 1, recast 1.6)
//     conversation  +1.2 asks a question, +0.6 has something to read (60–700 characters), +0.4 a picture, −1 only a link
//     near          +1.5 its author has been around you this week (replied, said your name, liked, recast)
//     new           +0.8 someone you don't follow, brought by people you do
//   Never: your own casts, casts you already answered, empty ones. At most two per person, never two in a row.
import { normalizeCast, toMs } from './hub.mjs';

const FOLLOWS = 300;
const PER_PERSON = 6;
const REACTORS = 150;
const TARGETS = 120;
const WINDOW_MS = 36 * 3600_000;
const AT_ONCE = 24;
const KEEP_MS = 8 * 60_000;
const TOP = 30;

const IMAGE = /^https:\/\/(imagedelivery\.net|i\.imgur\.com|.*\.(png|jpe?g|gif|webp)(\?|$))/i;
const ONLY_LINK = /^\s*https?:\/\/\S+\s*$/;

/** The score of one cast, and the reasons shown with it. Pure, so the web and the tests agree with the phone. */
export function score(c, { reactors = [], follows, near, nowMs }) {
  const likes = reactors.filter((r) => r.kind === 'like').map((r) => r.fid);
  const recasts = reactors.filter((r) => r.kind === 'recast').map((r) => r.fid);
  const weight = new Set(likes).size * 1 + new Set(recasts).size * 1.6;
  const social = weight ? 2 * Math.log2(1 + weight) : 0;
  const text = c.text ?? '';
  const pics = (c.embeds ?? []).some((e) => typeof e === 'string' && IMAGE.test(e));
  let conversation = 0;
  if (text.includes('?')) conversation += 1.2;
  if (text.length >= 60 && text.length <= 700) conversation += 0.6;
  if (pics) conversation += 0.4;
  if (ONLY_LINK.test(text)) conversation -= 1;
  const isNear = near.has(c.fid) ? 1.5 : 0;
  const isNew = !follows.has(c.fid) && social > 0 ? 0.8 : 0;
  const hours = Math.max(0, (nowMs - c.timestamp) / 3600_000);
  const value = (1 + social + conversation + isNear + isNew) / (1 + hours / 8) ** 1.2;
  const why = [];
  if (likes.length) why.push({ kind: 'liked', fids: [...new Set(likes)] });
  if (recasts.length) why.push({ kind: 'recast', fids: [...new Set(recasts)] });
  if (isNear) why.push({ kind: 'near' });
  if (isNew) why.push({ kind: 'new' });
  if (text.includes('?')) why.push({ kind: 'question' });
  return { value, why };
}

/** Best first, at most two per person, never the same person twice in a row. */
export function pick(scored, top = TOP) {
  const best = [...scored].sort((a, b) => b.score - a.score);
  const per = new Map();
  const kept = best.filter((s) => { const n = per.get(s.cast.fid) ?? 0; if (n >= 2) return false; per.set(s.cast.fid, n + 1); return true; }).slice(0, top);
  const out = [];
  while (kept.length) {
    const i = kept.findIndex((s) => s.cast.fid !== out.at(-1)?.cast.fid);
    out.push(kept.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}

export function makeDiscover({ api, network, near = async () => new Set(), now = () => Date.now() }) {
  const kept = new Map(); // fid -> { at, value, pending }

  async function list(path, params, limit) {
    const out = [];
    let pageToken;
    for (let i = 0; i < 6 && out.length < limit; i++) {
      const { data } = await network.get(path, { ...params, pageSize: 100, reverse: true, pageToken });
      out.push(...(data?.messages ?? []));
      pageToken = data?.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  async function inBatches(items, fn) {
    const out = [];
    for (let i = 0; i < items.length; i += AT_ONCE) out.push(...await Promise.all(items.slice(i, i + AT_ONCE).map((x) => fn(x).catch(() => null))));
    return out;
  }

  async function build(fid) {
    const nowMs = now();
    const since = nowMs - WINDOW_MS;
    const links = await list('/v1/linksByFid', { fid, link_type: 'follow' }, FOLLOWS);
    const followList = [...new Set(links.filter((m) => m.data?.type === 'MESSAGE_TYPE_LINK_ADD').map((m) => Number(m.data.linkBody?.targetFid)).filter(Boolean))].slice(0, FOLLOWS);
    const follows = new Set(followList);
    const [nearSet, mine] = await Promise.all([
      near(fid).catch(() => new Set()),
      network.get('/v1/castsByFid', { fid, pageSize: 100, reverse: true }).then((r) => r.data?.messages ?? []).catch(() => []),
    ]);
    const answered = new Set(mine.map((m) => m.data?.castAddBody?.parentCastId?.hash).filter(Boolean));

    // Pool A: what they said.
    const casts = new Map();
    for (const r of await inBatches(followList, (f) => api.casts(network, { fid: f, limit: PER_PERSON }))) {
      for (const c of r?.casts ?? []) if (c.timestamp >= since) casts.set(c.id, c);
    }
    // Pool B: what they liked and recast.
    const reactions = new Map(); // cast id -> [{ fid, kind }]
    const targets = new Map(); // cast id -> { fid, hash }
    for (const [i, msgs] of (await inBatches(followList.slice(0, REACTORS), (f) => network.get('/v1/reactionsByFid', { fid: f, reaction_type: 'None', pageSize: 25, reverse: true })
      .then((r) => r.data?.messages ?? []))).entries()) {
      for (const m of msgs ?? []) {
        const t = m.data?.reactionBody?.targetCastId;
        if (m.data?.type !== 'MESSAGE_TYPE_REACTION_ADD' || !t || toMs(m.data.timestamp) < since) continue;
        const list = reactions.get(t.hash) ?? [];
        list.push({ fid: followList[i], kind: m.data.reactionBody.type === 'REACTION_TYPE_RECAST' ? 'recast' : 'like' });
        reactions.set(t.hash, list);
        targets.set(t.hash, t);
      }
    }
    const missing = [...targets.values()].filter((t) => !casts.has(t.hash))
      .sort((a, b) => (reactions.get(b.hash)?.length ?? 0) - (reactions.get(a.hash)?.length ?? 0)).slice(0, TARGETS);
    for (const m of await inBatches(missing, (t) => network.get('/v1/castById', { fid: t.fid, hash: t.hash }).then((r) => r.data))) {
      if (m?.data?.type === 'MESSAGE_TYPE_CAST_ADD') { const c = normalizeCast(m, network.name); if (c.timestamp >= since) casts.set(c.id, c); }
    }

    const scored = [...casts.values()]
      .filter((c) => c.fid !== fid && !answered.has(c.id) && (c.text?.trim() || c.embeds?.length))
      .map((c) => { const s = score(c, { reactors: (reactions.get(c.id) ?? []).filter((r) => r.fid !== c.fid), follows, near: nearSet, nowMs }); return { cast: c, score: s.value, why: s.why }; });
    return { at: nowMs, follows: follows.size, picked: pick(scored) };
  }

  function get(fid) {
    const hit = kept.get(fid);
    if (hit?.pending) return hit.value ? Promise.resolve(hit.value) : hit.pending;
    if (hit?.value && now() - hit.value.at < KEEP_MS) return Promise.resolve(hit.value);
    const pending = build(fid).then((value) => { kept.set(fid, { value }); return value; })
      .catch((err) => { kept.set(fid, { value: hit?.value ?? null }); throw err; });
    kept.set(fid, { value: hit?.value ?? null, pending });
    if (kept.size > 100) kept.delete(kept.keys().next().value);
    // An older list answers at once while the fresh one is read.
    return hit?.value ? Promise.resolve(hit.value) : pending;
  }

  /** For you, in the shape the client draws: casts with their reasons, and every face needed. */
  return async function discover(fid) {
    fid = Number(fid);
    if (!Number.isInteger(fid) || fid <= 0) throw Object.assign(new Error('Which account?'), { status: 400 });
    const v = await get(fid);
    const casts = await api.renderCasts(network, v.picked.map((p) => p.cast));
    const items = v.picked.map((p, i) => ({ cast: casts[i], why: p.why.map((w) => (w.fids ? { ...w, fids: w.fids.slice(0, 5), more: w.fids.length > 5 } : w)) }));
    const users = await api.usersFor(network, [fid, ...items.flatMap((i) => [i.cast.fid, ...i.why.flatMap((w) => w.fids ?? [])])]);
    return { network: network.name, fid, items, users, follows: v.follows, at: v.at };
  };
}
