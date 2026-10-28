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

// Awake: its client answers right now (GET <place>/api/health). Asked live, from this browser, every time.
async function awake(url) {
  try { const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(6000) }); return r.ok; } catch { return false; }
}

function place(tk, { art, users, lastCast, genesis }) {
  const host = `${tk.surname.toLowerCase()}.fatline.ink`;
  const url = `https://${host}`;
  const here = location.host === host;
  const u = users[tk.linkedFid ?? tk.fid];
  const image = pic(art.beings?.[tk.fid]?.image ?? art.eggs?.[tk.stone]?.image ?? art.egg?.image);
  const title = tk.fid === genesis ? `Aster ${titled(tk.surname)}` : titled(tk.surname);
  const said = lastCast
    ? el('blockquote', { class: 'dp-said' }, el('span', {}, lastCast.text?.slice(0, 180) || '(a picture)'), el('cite', {}, ago(lastCast.timestamp)))
    : el('p', { class: 'dp-said muted' }, 'Nothing said yet.');
  return el('article', { class: `dp${here ? ' here' : ''}`, onclick: () => (here ? location.assign('#/') : openPlace(url)) },
    el('img', { class: 'dp-art', src: image, alt: '', loading: 'lazy' }),
    el('div', { class: 'dp-body' },
      el('p', { class: 'dp-host' }, host, here ? el('span', { class: 'dp-here' }, ' · you are here') : null),
      el('h2', { class: 'dp-name' }, title),
      el('p', { class: 'dp-who' }, u?.username ? `@${u.username}` : `FID ${tk.fid}`, ' · ',
        el('span', { class: 'dp-state', 'data-url': here ? location.origin : url }, 'checking…'),
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
      el('p', { class: 'day-date', id: 'dir-count' }, `${tokens.length} ${tokens.length === 1 ? 'place' : 'places'}`),
      el('h1', { class: 'day-title' }, 'Fatline'),
      el('p', { class: 'day-whose' }, 'Every place is a person, their own Farcaster node and their own client. Same shape everywhere, so you can walk from one into the next.')),
    ...tokens.map((tk) => place(tk, { art, users, lastCast: last[tk.linkedFid ?? tk.fid], genesis: world.genesisFid })),
    el('footer', { class: 'day-end' },
      el('span', { class: 'day-seal', 'aria-hidden': 'true' }, '✦'),
      el('p', {}, 'Run the next one.'),
      el('p', { class: 'muted' }, el('a', { href: 'https://fatline.ink/#launch', target: '_blank', rel: 'noopener' }, 'How to start a place')),
      state.me?.canWrite ? el('p', { class: 'muted' }, el('a', { href: '#/here' }, 'Your node and your egg')) : null)));
  const spans = [...main.querySelectorAll('.dp-state')];
  let up = 0;
  await Promise.all(spans.map(async (sp) => {
    const ok = await awake(sp.dataset.url);
    if (ok) up++;
    sp.textContent = ok ? 'awake' : 'quiet';
    sp.classList.add(ok ? 'on' : 'off');
  }));
  const count = $('#dir-count');
  if (count) count.textContent += ` · ${up} awake`;
}
