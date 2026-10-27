// One cast, read from this server's own node: fatline.ink/c/<who>/<hash> shows it.
// <who> is a username or an FID. <hash> is the full hash or its start (farcaster.xyz links use the first 8 hex digits).
// Snapchain finds a cast only by author + hash, so a short hash is looked up in that author's recent casts.
import { normalizeCast, normalizeUser, renderMentions } from './hub.mjs';

const SHORT_PAGES = 10; // up to 1,000 of the author's latest casts, for a short hash
const err = (status, message) => Object.assign(new Error(message), { status });

export function parseCastPath(who, hash) {
  const name = String(who ?? '').replace(/^@/, '').toLowerCase();
  if (!/^(\d{1,12}|[a-z0-9][a-z0-9.-]{0,40})$/.test(name)) throw err(400, 'who: a username or an FID');
  const h = String(hash ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{8,40}$/.test(h)) throw err(400, 'hash: 0x and 8 to 40 hex digits');
  return { name, hash: h };
}

/**
 * Reads one cast from a node that speaks the Snapchain HTTP API.
 * Returns the cast (mentions written in), its author, quoted casts one level deep, and which node answered.
 */
export async function readCast({ node, network = 'snapchain', label, fetchImpl = fetch, timeoutMs = 8000 }, who, hash) {
  const p = parseCastPath(who, hash);
  const get = async (path, params = {}) => {
    const url = new URL(node.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
    let res;
    try { res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) }); } catch (e) { throw err(503, `The node did not answer (${label ?? node}).`); }
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw err(503, `The node answered HTTP ${res.status} (${label ?? node}).`);
    return res.json();
  };

  const fid = /^\d+$/.test(p.name) ? Number(p.name) : (await get('/v1/userNameProofByName', { name: p.name }))?.fid;
  if (!fid) throw err(404, `No account named ${p.name} on this node.`);

  let message = null;
  if (p.hash.length === 42) {
    message = await get('/v1/castById', { fid, hash: p.hash });
  } else {
    let pageToken;
    for (let i = 0; i < SHORT_PAGES && !message; i++) {
      const page = await get('/v1/castsByFid', { fid, pageSize: 100, reverse: true, pageToken });
      message = (page?.messages ?? []).find((m) => m.hash?.toLowerCase().startsWith(p.hash)) ?? null;
      pageToken = page?.nextPageToken;
      if (!pageToken || !page?.messages?.length) break;
    }
  }
  if (message?.data?.type !== 'MESSAGE_TYPE_CAST_ADD') throw err(404, `No cast ${p.hash} by ${p.name} on this node.`);

  const users = new Map();
  const user = async (f) => {
    if (!users.has(f)) users.set(f, normalizeUser(f, (await get('/v1/userDataByFid', { fid: f }))?.messages ?? []));
    return users.get(f);
  };
  const render = async (c) => {
    const names = new Map();
    for (const m of c.mentions.slice(0, 20)) names.set(m, (await user(m)).username);
    return { ...c, text: renderMentions(c, names) };
  };

  const cast = await render(normalizeCast(message, network));
  const quotes = [];
  for (const e of cast.embeds) {
    if (typeof e === 'string' || quotes.length >= 4) continue;
    const q = await get('/v1/castById', { fid: e.cast.fid, hash: e.cast.hash }).catch(() => null);
    if (q?.data?.type === 'MESSAGE_TYPE_CAST_ADD') quotes.push({ ...(await render(normalizeCast(q, network))), author: await user(q.data.fid) });
  }
  const info = await get('/v1/info').catch(() => null);
  return {
    cast,
    author: await user(fid),
    quotes,
    source: { network, label: label ?? node, version: info?.version ?? null, messages: info?.dbStats?.numMessages ?? null, readAt: new Date().toISOString() },
  };
}
