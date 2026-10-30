// Around you: everything that happened around you, newest first, in the order it happened: who liked or recast
// one of your casts, who replied, who said your name, who began following you. Read from this server's node.
// No counts anywhere: the tab says ∞.
//
// The node has no notifications list, so it is put together from what the node does keep, newest first: your casts
// (and, for each, its replies and reactions), casts that mention you, and follows of you. It is read a stretch at a
// time and kept for a minute. Everything newer than the "horizon" is complete; scrolling past it reads the next stretch.
// Not shown: a like today on a cast older than the stretch read when that moment scrolled by (the node has no index
// of reactions to you; reading every cast you ever made for each page would be too slow).
import { normalizeCast, toMs } from './hub.mjs';

const CASTS_PER_STRETCH = 40;
const AT_ONCE = 10;
const FRESH_MS = 45_000;
const PAGE = 40;

const tsOf = (m) => toMs(m.data?.timestamp ?? 0);

/**
 * How far back a newest-first page is complete. A node answers per shard, so one page can hold two newest-first runs;
 * the page is complete down to the newest of their oldest items.
 */
export function frontier(messages) {
  if (!messages.length) return null;
  const ts = messages.map(tsOf);
  let floor = -Infinity, low = ts[0];
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] > ts[i - 1]) { floor = Math.max(floor, low); low = ts[i]; } else low = Math.min(low, ts[i]);
  }
  return Math.max(floor, low);
}

const order = (a, b) => (b.at - a.at) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function makeAround({ api, castsPerStretch = CASTS_PER_STRETCH, now = () => Date.now() }) {
  const kept = new Map(); // `${network}:${fid}` -> state

  function fresh(network, fid) {
    return { network, fid, at: now(), events: new Map(), mine: new Map(),
      lists: { casts: { token: null, edge: Infinity, done: false }, mentions: { token: null, edge: Infinity, done: false }, follows: { token: null, edge: Infinity, done: false } } };
  }

  const add = (s, e) => { if (!s.events.has(e.key)) s.events.set(e.key, e); };
  const quiet = (p) => p.catch(() => ({ data: null }));

  /** Reads the next stretch of each list that is still the furthest behind. */
  async function extend(s) {
    const { network, fid } = s;
    const next = async (name, path, params) => {
      const l = s.lists[name];
      if (l.done) return [];
      const { data } = await network.get(path, { ...params, reverse: true, pageToken: l.token ?? undefined });
      const msgs = data?.messages ?? [];
      l.token = data?.nextPageToken || null;
      l.done = !l.token;
      const f = frontier(msgs);
      l.edge = l.done ? -Infinity : Math.min(l.edge, f ?? -Infinity);
      return msgs;
    };
    const [casts, mentions, follows] = await Promise.all([
      next('casts', '/v1/castsByFid', { fid, pageSize: castsPerStretch }),
      next('mentions', '/v1/castsByMention', { fid, pageSize: 100 }),
      next('follows', '/v1/linksByTargetFid', { target_fid: fid, link_type: 'follow', pageSize: 100 }),
    ]);
    const mine = casts.filter((m) => m.data?.type === 'MESSAGE_TYPE_CAST_ADD').map((m) => normalizeCast(m, network.name));
    for (const c of mine) s.mine.set(c.id, c);
    for (let i = 0; i < mine.length; i += AT_ONCE) {
      await Promise.all(mine.slice(i, i + AT_ONCE).map(async (c) => {
        const [replies, reactions] = await Promise.all([
          quiet(network.get('/v1/castsByParent', { fid, hash: c.id, pageSize: 100 })),
          quiet(network.get('/v1/reactionsByCast', { target_fid: fid, target_hash: c.id, reaction_type: 'None', pageSize: 100 })),
        ]);
        for (const m of reactions.data?.messages ?? []) {
          if (m.data?.type !== 'MESSAGE_TYPE_REACTION_ADD' || Number(m.data.fid) === fid) continue;
          const kind = m.data.reactionBody?.type === 'REACTION_TYPE_RECAST' ? 'recast' : 'like';
          add(s, { key: `${kind}:${m.data.fid}:${c.id}`, kind, at: tsOf(m), fid: Number(m.data.fid), target: c.id });
        }
        for (const m of replies.data?.messages ?? []) {
          if (m.data?.type !== 'MESSAGE_TYPE_CAST_ADD' || Number(m.data.fid) === fid) continue;
          const r = normalizeCast(m, network.name);
          add(s, { key: `cast:${r.id}`, kind: 'reply', at: r.timestamp, fid: r.fid, cast: r, target: c.id });
        }
      }));
    }
    for (const m of mentions) {
      if (m.data?.type !== 'MESSAGE_TYPE_CAST_ADD' || Number(m.data.fid) === fid) continue;
      const c = normalizeCast(m, network.name);
      // A reply that also says your name is a reply; it is shown once.
      const key = `cast:${c.id}`;
      if (!s.events.has(key)) add(s, { key, kind: c.parent && Number(c.parent.fid) === fid ? 'reply' : 'mention', at: c.timestamp, fid: c.fid, cast: c, target: c.parent && Number(c.parent.fid) === fid ? c.parent.hash : null });
    }
    for (const m of follows) {
      if (m.data?.type !== 'MESSAGE_TYPE_LINK_ADD') continue;
      add(s, { key: `follow:${m.data.fid}`, kind: 'follow', at: tsOf(m), fid: Number(m.data.fid) });
    }
  }

  /** Everything at or after this moment is complete. */
  const horizon = (s) => Math.max(...Object.values(s.lists).map((l) => (l.done ? -Infinity : l.edge)));
  const finished = (s) => Object.values(s.lists).every((l) => l.done);

  return async function around(choice, fid, { before = null, limit = PAGE } = {}) {
    fid = Number(fid);
    if (!Number.isInteger(fid) || fid <= 0) throw Object.assign(new Error('Which account?'), { status: 400 });
    const network = api.network(choice);
    limit = Math.min(Math.max(Number(limit) || PAGE, 1), 100);
    // before: "<ms>_<key>" of the last thing shown, so two things in the same second are never lost between pages.
    let cut = null;
    if (before) {
      const m = String(before).match(/^(\d{1,15})_(.{1,200})$/);
      if (!m) throw Object.assign(new Error('That cursor is not one this server made.'), { status: 400 });
      cut = { at: Number(m[1]), key: m[2] };
    }
    const id = `${network.name}:${network.pinnedTo ?? ''}:${fid}`;
    let s = kept.get(id);
    // The top of the flow is always fresh; deeper pages keep reading the same snapshot.
    if (!s || (!cut && now() - s.at > FRESH_MS)) { s = fresh(network, fid); kept.set(id, s); if (kept.size > 200) kept.delete(kept.keys().next().value); }

    const after = (e) => !cut || order(cut, e) < 0;
    for (let i = 0; i < 8; i++) {
      const h = horizon(s);
      const ready = [...s.events.values()].filter((e) => after(e) && e.at >= h);
      if (ready.length >= limit || finished(s)) break;
      await extend(s);
    }
    const h = horizon(s);
    const page = [...s.events.values()].filter((e) => after(e) && e.at >= h).sort(order).slice(0, limit);
    const more = !finished(s) || [...s.events.values()].some((e) => after(e)) && page.length === limit;

    // Your cast each one is about (a line of it), the casts said, and every face.
    const targets = await Promise.all(page.map(async (e) => {
      if (!e.target) return null;
      const t = s.mine.get(e.target) ?? (await quiet(network.get('/v1/castById', { fid, hash: e.target }))).data;
      return t?.data ? normalizeCast(t, network.name) : t ?? null;
    }));
    const said = await api.renderCasts(network, [...page.map((e) => e.cast), ...targets].filter(Boolean));
    const byId = new Map(said.map((c) => [c.id, c]));
    const items = page.map((e, i) => ({ kind: e.kind, at: e.at, fid: e.fid, key: e.key,
      cast: e.cast ? byId.get(e.cast.id) ?? e.cast : null,
      yours: targets[i] ? { id: targets[i].id, text: byId.get(targets[i].id)?.text ?? targets[i].text, embeds: targets[i].embeds } : null }));
    const users = await api.usersFor(network, [fid, ...items.map((e) => e.fid)]);
    const last = page.at(-1);
    return {
      network: network.name, fid, items, users,
      next: more && last ? `${last.at}_${last.key}` : more ? `${Math.max(0, h)}_~` : null,
      complete: finished(s), at: s.at,
    };
  };
}
