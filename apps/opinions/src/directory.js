// Fatline: the directory. Every place is a person, their Farcaster node and their client, at <surname>.fatline.ink.
// They are all built the same way, so from any one you can walk into all of them: a network of daily presences.
// Read from fatline.ink/world (the contract, every hour), each runner's last cast from this node.
import { $, api, el, state } from './lib.js';
import { openPlace } from './miniapp.js';

const WORLD = 'https://fatline.ink/world';
const ART = 'https://fatline.ink/fatliners-art.json';
const titled = (s) => s.charAt(0) + s.slice(1).toLowerCase();
const arweaveId = (u) => String(u ?? '').match(/arweave\.net\/([\w-]{43})/)?.[1];
const pic = (u) => (arweaveId(u) ? `https://fatline.ink/api/art/${arweaveId(u)}` : u);

function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

function awake(tk) {
  const c = tk.warmth?.lastCheck;
  if (tk.hibernatingUntil) return { word: 'asleep', cls: 'off' };
  if (c?.ok && Date.now() - c.at < 3 * 3600_000) return { word: 'awake', cls: 'on' };
  return { word: 'quiet', cls: 'off' };
}

function place(tk, { art, users, lastCast, genesis }) {
  const host = `${tk.surname.toLowerCase()}.fatline.ink`;
  const url = `https://${host}`;
  const here = location.host === host;
  const u = users[tk.linkedFid ?? tk.fid];
  const image = pic(art.beings?.[tk.fid]?.image ?? art.eggs?.[tk.stone]?.image ?? art.egg?.image);
  const a = awake(tk);
  const title = tk.fid === genesis ? `Aster ${titled(tk.surname)}` : titled(tk.surname);
  const said = lastCast
    ? el('blockquote', { class: 'pl-said' }, el('span', {}, lastCast.text?.slice(0, 180) || '(a picture)'), el('cite', {}, ago(lastCast.timestamp)))
    : el('p', { class: 'pl-said muted' }, 'Nothing said yet.');
  return el('article', { class: `pl${here ? ' here' : ''}`, onclick: () => (here ? location.assign('#/') : openPlace(url)) },
    el('img', { class: 'pl-art', src: image, alt: '', loading: 'lazy' }),
    el('div', { class: 'pl-body' },
      el('p', { class: 'pl-host' }, host, here ? el('span', { class: 'pl-here' }, ' · you are here') : null),
      el('h2', { class: 'pl-name' }, title),
      el('p', { class: 'pl-who' }, u?.username ? `@${u.username}` : `FID ${tk.fid}`, ' · ',
        el('span', { class: `pl-state ${a.cls}` }, a.word),
        tk.coin ? ` · $${tk.surname}` : '', tk.stage === 'egg' ? ' · still an egg' : ''),
      said));
}

export async function directoryPage() {
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'ck-loading' }, 'Walking the network…'));
  let world, art;
  try {
    [world, art] = await Promise.all([fetch(WORLD).then((r) => r.json()), fetch(ART).then((r) => r.json()).catch(() => ({}))]);
  } catch (err) { main.replaceChildren(el('p', { class: 'warn' }, `fatline.ink did not answer: ${err.message}`)); return; }
  const tokens = (world.tokens ?? []).filter((t) => t.surname && (t.stage === 'egg' || t.stage === 'fatliner'))
    .sort((x, y) => (y.fid === world.genesisFid) - (x.fid === world.genesisFid) || (y.stage === 'fatliner') - (x.stage === 'fatliner') || x.laidAt - y.laidAt);
  const fids = tokens.map((t) => t.linkedFid ?? t.fid);
  // Each runner's last cast, from this node; and who they are.
  const feed = fids.length ? await api('/api/feed', { fids: fids.join(','), limit: 60, network: state.network }).catch(() => null) : null;
  const users = { ...(feed?.users ?? {}) };
  await Promise.all(fids.filter((f) => !users[f]).map(async (f) => { users[f] = await api('/api/user', { q: String(f) }).catch(() => null); }));
  const last = {};
  for (const c of feed?.items ?? []) if (c.kind === 'cast' && !last[c.fid]) last[c.fid] = c;
  main.replaceChildren(el('section', { class: 'dir' },
    el('header', { class: 'day-head' },
      el('p', { class: 'day-date' }, `${tokens.length} ${tokens.length === 1 ? 'place' : 'places'} · ${tokens.filter((t) => awake(t).cls === 'on').length} awake`),
      el('h1', { class: 'day-title' }, 'Fatline'),
      el('p', { class: 'day-whose' }, 'Every place is a person, their own Farcaster node and their own client. Same shape everywhere, so you can walk from one into the next.')),
    ...tokens.map((tk) => place(tk, { art, users, lastCast: last[tk.linkedFid ?? tk.fid], genesis: world.genesisFid })),
    el('footer', { class: 'day-end' },
      el('span', { class: 'day-seal', 'aria-hidden': 'true' }, '✦'),
      el('p', {}, 'Run the next one.'),
      el('p', { class: 'muted' }, el('a', { href: 'https://fatline.ink/#launch', target: '_blank', rel: 'noopener' }, 'How to start a place')),
      state.me?.canWrite ? el('p', { class: 'muted' }, el('a', { href: '#/here' }, 'Your node and your egg')) : null)));
}
