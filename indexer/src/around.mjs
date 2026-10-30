// Around you: what your casts set moving (replies, likes, recasts), who said your name, and who began following you.
// Read from this server's node, a window of your casts at a time, back to your very first cast. No counts anywhere:
// the tab says ∞, and each cast shows faces, not numbers.
//
// The cursor walks three lists the node keeps newest first: your casts, casts that mention you, and follows of you.
// Each page is the stretch of time covered by your next few casts; mentions and follows are cut to the same stretch.
// A page of mentions or follows that reaches past the stretch is read again next time instead of skipped.
import { normalizeCast, toMs } from './hub.mjs';

const CASTS_PER_PAGE = 8;
const FACES = 7; // faces shown per kind of reaction; the rest are "and others"
const REPLIES = 12;
const SIDE_PAGES = 6; // pages of mentions or follows read per answer, at most

const encode = (c) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decode(s) {
  if (!s) return { top: null, casts: null, mentions: null, follows: null };
  try { return JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8')); } catch {
    throw Object.assign(new Error('That cursor is not one this server made.'), { status: 400 });
  }
}

const tsOf = (m) => toMs(m.data?.timestamp ?? 0);

export function makeAround({ api, castsPerPage = CASTS_PER_PAGE, now = () => Date.now() }) {
  /** Reads one side list (mentions or follows) within [bottom, top). Returns kept messages and where to read next. */
  async function side(network, path, params, token, bottom, top, keep) {
    if (token === '') return { got: [], token: '' }; // finished earlier
    const got = [];
    let at = token ?? undefined;
    for (let i = 0; i < SIDE_PAGES; i++) {
      const { data } = await network.get(path, { ...params, pageSize: 50, reverse: true, pageToken: at });
      const msgs = (data?.messages ?? []).filter(keep);
      got.push(...msgs.filter((m) => tsOf(m) >= bottom && (top == null || tsOf(m) < top)));
      const next = data?.nextPageToken || '';
      // This page reaches back past the window: the next window starts by reading it again.
      if (msgs.some((m) => tsOf(m) < bottom)) return { got, token: at ?? null };
      at = next;
      if (!next) return { got, token: '' };
    }
    return { got, token: at };
  }

  return async function around(choice, fid, { cursor = null } = {}) {
    fid = Number(fid);
    if (!Number.isInteger(fid) || fid <= 0) throw Object.assign(new Error('Which account?'), { status: 400 });
    const network = api.network(choice);
    const cur = decode(cursor);
    const top = cur.top ?? null;

    // 1. Your next casts (replies too: a reply of yours has consequences like any cast).
    let mine = [];
    let castsToken = cur.casts;
    let node = null;
    if (castsToken !== '') {
      const { data, node: n } = await network.get('/v1/castsByFid', { fid, pageSize: castsPerPage, reverse: true, pageToken: castsToken ?? undefined });
      mine = (data?.messages ?? []).filter((m) => m.data?.type === 'MESSAGE_TYPE_CAST_ADD').map((m) => normalizeCast(m, network.name));
      castsToken = data?.nextPageToken || '';
      node = n;
    }
    // The stretch of time this page covers: down to your oldest cast here, or all the way once your casts are done.
    const bottom = castsToken === '' ? 0 : mine.length ? Math.min(...mine.map((c) => c.timestamp)) : (top ?? now());

    // 2. What each cast set moving, and the side lists for the same stretch.
    const quiet = (p) => p.catch(() => ({ data: null }));
    const [echoes, mentions, follows] = await Promise.all([
      Promise.all(mine.map(async (cast) => {
        const [replies, reactions] = await Promise.all([
          quiet(network.get('/v1/castsByParent', { fid, hash: cast.id, pageSize: 50 })),
          quiet(network.get('/v1/reactionsByCast', { target_fid: fid, target_hash: cast.id, reaction_type: 'None', pageSize: 100 })),
        ]);
        const others = (m) => Number(m.data?.fid) !== fid;
        const r = (reactions.data?.messages ?? []).filter((m) => m.data?.type === 'MESSAGE_TYPE_REACTION_ADD' && others(m));
        const who = (type) => [...new Set(r.filter((m) => m.data.reactionBody?.type === type).sort((a, b) => tsOf(b) - tsOf(a)).map((m) => Number(m.data.fid)))];
        const likes = who('REACTION_TYPE_LIKE');
        const recasts = who('REACTION_TYPE_RECAST');
        const answers = (replies.data?.messages ?? []).filter((m) => m.data?.type === 'MESSAGE_TYPE_CAST_ADD' && others(m))
          .map((m) => normalizeCast(m, network.name)).sort((a, b) => b.timestamp - a.timestamp);
        const last = Math.max(0, ...r.map(tsOf), ...answers.map((a) => a.timestamp));
        return { cast, likes, recasts, replies: answers, last };
      })),
      side(network, '/v1/castsByMention', { fid }, cur.mentions, bottom, top, (m) => m.data?.type === 'MESSAGE_TYPE_CAST_ADD' && Number(m.data.fid) !== fid),
      side(network, '/v1/linksByTargetFid', { target_fid: fid, link_type: 'follow' }, cur.follows, bottom, top, (m) => m.data?.type === 'MESSAGE_TYPE_LINK_ADD'),
    ]);

    // 3. One flow, newest first. A reply that also mentions you is shown once, under your cast.
    const shownReplies = new Set(echoes.flatMap((e) => e.replies.map((r) => r.id)));
    const said = await api.renderCasts(network, mentions.got.map((m) => normalizeCast(m, network.name)).filter((c) => !shownReplies.has(c.id)));
    const items = [
      ...echoes.filter((e) => e.likes.length || e.recasts.length || e.replies.length).map((e) => ({
        kind: 'echo', at: e.cast.timestamp, last: e.last, cast: e.cast,
        likes: e.likes.slice(0, FACES), moreLikes: e.likes.length > FACES,
        recasts: e.recasts.slice(0, FACES), moreRecasts: e.recasts.length > FACES,
        replies: e.replies.slice(0, REPLIES), moreReplies: e.replies.length > REPLIES,
      })),
      ...said.map((c) => ({ kind: 'mention', at: c.timestamp, cast: c })),
      ...follows.got.map((m) => ({ kind: 'follow', at: tsOf(m), fid: Number(m.data.fid) })),
    ].sort((a, b) => b.at - a.at);
    for (const e of items) if (e.kind === 'echo') { e.cast = (await api.renderCasts(network, [e.cast]))[0]; e.replies = await api.renderCasts(network, e.replies); }

    const fids = items.flatMap((i) => i.kind === 'echo' ? [...i.likes, ...i.recasts, ...i.replies.map((r) => r.fid)] : i.kind === 'mention' ? [i.cast.fid] : [i.fid]);
    const users = await api.usersFor(network, [fid, ...fids]);
    const done = castsToken === '' && mentions.token === '' && follows.token === '';
    return {
      network: network.name, fid, items, users,
      source: node ? network.source(node) : null,
      next: done ? null : encode({ top: castsToken === '' ? top : bottom, casts: castsToken, mentions: mentions.token, follows: follows.token }),
      at: now(),
    };
  };
}
