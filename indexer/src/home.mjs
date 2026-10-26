// A person's home feed, read from this server's own node: the latest casts of the people they follow.
// Their follows are read from the node (most recent first, up to MAX_FOLLOWS), each one's last few casts are
// fetched a few at a time, and the merged timeline is kept for a few minutes. Nothing here asks another server.
const MAX_FOLLOWS = 400;
const PER_PERSON = 8;
const AT_ONCE = 24;
const KEEP_MS = 3 * 60_000;

export function makeHome({ api, network, now = () => Date.now() }) {
  const timelines = new Map(); // fid -> { at, casts, pending }

  async function follows(fid) {
    const out = [];
    let pageToken;
    for (let i = 0; i < 8 && out.length < MAX_FOLLOWS; i++) {
      const { data } = await network.get('/v1/linksByFid', { fid, link_type: 'follow', pageSize: 100, reverse: true, pageToken });
      for (const m of data?.messages ?? []) {
        const t = m.data?.linkBody?.targetFid;
        if (m.data?.type === 'MESSAGE_TYPE_LINK_ADD' && t && !out.includes(t)) out.push(t);
      }
      pageToken = data?.nextPageToken;
      if (!pageToken) break;
    }
    return out.slice(0, MAX_FOLLOWS);
  }

  async function build(fid) {
    const fids = [fid, ...(await follows(fid))];
    const casts = [];
    for (let i = 0; i < fids.length; i += AT_ONCE) {
      const got = await Promise.allSettled(fids.slice(i, i + AT_ONCE).map((f) => api.casts(network, { fid: f, limit: PER_PERSON })));
      for (const r of got) if (r.status === 'fulfilled') casts.push(...r.value.casts);
    }
    casts.sort((a, b) => b.timestamp - a.timestamp);
    return { follows: fids.length - 1, casts };
  }

  async function timeline(fid) {
    const hit = timelines.get(fid);
    if (hit?.pending) return hit.pending;
    if (hit && now() - hit.at < KEEP_MS) return hit;
    const pending = build(fid).then((t) => { const v = { at: now(), ...t }; timelines.set(fid, v); return v; })
      .catch((err) => { timelines.delete(fid); throw err; });
    timelines.set(fid, { ...(hit ?? {}), pending });
    // A stale timeline answers at once while the fresh one is read.
    return hit?.casts ? hit : pending;
  }

  /** One page of fid's home, in /api/feed's shape. */
  return async function home(fid, { before = null, limit = 25 } = {}) {
    fid = Number(fid);
    if (!Number.isInteger(fid) || fid <= 0) throw Object.assign(new Error('Which account?'), { status: 400 });
    limit = Math.min(Math.max(Number(limit) || 25, 1), 50);
    const t = await timeline(fid);
    const page = t.casts.filter((c) => !before || c.timestamp < Number(before)).slice(0, limit);
    const items = await api.renderCasts(network, await api.withApps(network, page));
    const users = await api.usersFor(network, items.map((i) => i.fid));
    const node = network.current ?? null;
    return { network: network.name, source: node ? network.source(node) : null, items, users, follows: t.follows,
      next: page.length < limit ? null : page.at(-1).timestamp };
  };
}
