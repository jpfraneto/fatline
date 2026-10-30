// Around: everything that happened around you, newest first, as it happens. The tab's number is ∞, never anything else.
//   - Replies and mentions in full; likes, recasts and follows as one line each (likes on the same cast, back to back,
//     share a line). No counts.
//   - New things arrive at the top on their own. Scrolling down goes back in time, without end.
//   - #/around/<fid or name> shows anyone's: it is all public, on every node.
import { $, api, el, state, timeAgo } from './lib.js';
import { castActions } from './post.js';
import { loggedIn } from './fatline-login.js';

const LIVE_MS = 45_000;
const nameOf = (u, fid) => u?.displayName || (u?.username ? `@${u.username}` : `FID ${fid}`);
const isImage = (u) => /^https:\/\/(imagedelivery\.net|i\.imgur\.com|.*\.(png|jpe?g|gif|webp)(\?|$))/i.test(u);
const VERB = { like: 'liked', recast: 'recast', follow: 'began following you', reply: 'replied', mention: 'said your name' };

function face(fid, users) {
  const u = users[fid];
  // The first letter underneath; the picture on top, gone if it does not load.
  const pic = u?.pfp ? el('img', { src: u.pfp, alt: '', loading: 'lazy' }) : null;
  pic?.addEventListener('error', () => pic.remove());
  return el('a', { class: 'ar-face', href: `#/u/${fid}`, title: nameOf(u, fid), 'aria-label': nameOf(u, fid) },
    el('span', {}, (u?.username ?? u?.displayName ?? '·').slice(0, 1)), pic);
}

/** One line of your cast: what this is about. */
function yours(y) {
  if (!y) return null;
  const pic = (y.embeds ?? []).find((e) => typeof e === 'string' && isImage(e));
  return el('p', { class: 'ar-yours' }, pic ? el('img', { src: pic, alt: '', loading: 'lazy' }) : null, y.text || (pic ? '' : 'your cast'));
}

function body(c) {
  const pics = (c.embeds ?? []).filter((e) => typeof e === 'string' && isImage(e));
  return [c.text ? el('p', { class: 'ar-text' }, c.text) : null, pics[0] ? el('img', { class: 'ar-pic', src: pics[0], alt: '', loading: 'lazy' }) : null];
}

const when = (ms) => el('time', { datetime: new Date(ms).toISOString(), title: new Date(ms).toLocaleString(state.lang) }, timeAgo(ms));

function row(g, users) {
  const [first] = g;
  if (first.kind === 'reply' || first.kind === 'mention') {
    const acts = el('div', { class: 'mo-acts', hidden: true }, ...castActions(first.cast));
    const card = el('article', { class: `ar ar-${first.kind}`, 'data-key': first.key },
      el('header', { class: 'ar-who' }, face(first.fid, users),
        el('span', {}, el('a', { href: `#/u/${first.fid}` }, nameOf(users[first.fid], first.fid)), ` ${VERB[first.kind]}`), when(first.at)),
      ...body(first.cast), first.kind === 'reply' ? yours(first.yours) : null, acts);
    if (acts.childNodes.length) card.addEventListener('click', (e) => { if (!e.target.closest('a, button, textarea, input, form')) acts.hidden = !acts.hidden; });
    return card;
  }
  const who = g.map((e) => e.fid);
  const names = who.length === 1 ? el('a', { href: `#/u/${first.fid}` }, nameOf(users[first.fid], first.fid))
    : el('span', {}, el('a', { href: `#/u/${first.fid}` }, nameOf(users[first.fid], first.fid)), ' and others');
  return el('div', { class: `ar-line ar-${first.kind}`, 'data-key': first.key },
    el('span', { class: 'ar-faces' }, ...who.slice(0, 5).map((f) => face(f, users))),
    el('div', { class: 'ar-what' }, el('p', {}, names, ` ${VERB[first.kind]}`), yours(first.yours)),
    when(first.at));
}

/** Likes (or recasts) of the same cast, one right after another, share a line. */
function groups(items) {
  const out = [];
  for (const e of items) {
    const last = out.at(-1);
    if (last && (e.kind === 'like' || e.kind === 'recast') && last[0].kind === e.kind && last[0].yours?.id === e.yours?.id) last.push(e);
    else out.push([e]);
  }
  return out;
}

/** Whose surroundings: the one in the address, else who signed in here, else this place's runner, else this client's account. */
async function whose(q) {
  if (q) {
    const u = await api('/api/user', { network: state.network, q });
    return { fid: u.fid, title: `Around ${u.username ? `@${u.username}` : `FID ${u.fid}`}`, line: 'Everything that happens around them, as it happens.' };
  }
  const me = loggedIn();
  if (me?.fid) return { fid: me.fid, line: null };
  const place = await api('/api/place').catch(() => null);
  const owner = place?.owner ?? (place?.fid ? { fid: place.fid } : null);
  if (owner?.fid) return { fid: owner.fid, line: `Around ${owner.username ? `@${owner.username}` : `FID ${owner.fid}`}. Sign in to see yours.` };
  if (state.me?.fid) return { fid: state.me.fid, line: null };
  return null;
}

let stop = () => {};

export async function aroundPage(q = null) {
  stop();
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'ck-loading' }, '…'));
  const w = await whose(q);
  if (!w) { location.replace('#/fatline'); return; }
  const flow = el('div', { class: 'ar-flow' });
  const tail = el('p', { class: 'ar-tail' }, el('span', { class: 'ar-inf', 'aria-hidden': 'true' }, '∞'));
  main.replaceChildren(el('section', { class: 'day around' },
    el('header', { class: 'day-head' },
      el('h1', { class: 'day-title' }, w.title ?? 'Around you'),
      el('p', { class: 'day-whose' }, w.line ?? 'Everything that happens around you, as it happens. It does not end.')),
    flow, tail));

  const seen = new Set();
  const read = (before) => api(`/api/around/${w.fid}`, { network: state.network, ...(before ? { before } : {}) });
  const fresh = (items) => items.filter((e) => !seen.has(e.key) && seen.add(e.key));

  let before = null, busy = false, ended = false, failed = false;
  async function more() {
    if (busy || ended || failed || !tail.isConnected) return;
    busy = true;
    try {
      for (let i = 0; i < 4; i++) {
        const page = await read(before);
        if (!tail.isConnected) return;
        flow.append(...groups(fresh(page.items)).map((g) => row(g, page.users)));
        before = page.next;
        if (!before) { ended = true; break; }
        if (page.items.length) break;
      }
      if (ended) tail.replaceChildren(el('span', { class: 'day-seal', 'aria-hidden': 'true' }, '✦'), el('span', {}, 'Where it began.'));
    } catch (err) {
      failed = true; // the node did not answer: say so, and wait for a tap
      tail.replaceChildren(el('span', { class: 'muted' }, err.message), ' ',
        el('button', { type: 'button', class: 'link', onclick: () => { failed = false; tail.replaceChildren(el('span', { class: 'ar-inf' }, '∞')); more(); } }, 'Again'));
      return;
    } finally { busy = false; }
    if (!ended && tail.getBoundingClientRect().top < innerHeight + 600) more();
  }

  // New things arrive at the top, on their own.
  const live = setInterval(async () => {
    if (!flow.isConnected) return stop();
    if (document.hidden) return;
    const page = await read(null).catch(() => null);
    const add = page ? fresh(page.items) : [];
    if (!add.length) return;
    const rows = groups(add).map((g) => row(g, page.users));
    for (const r of rows) r.classList.add('ar-new');
    flow.prepend(...rows);
  }, LIVE_MS);
  const watcher = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) more(); }, { rootMargin: '900px 0px' });
  watcher.observe(tail);
  stop = () => { clearInterval(live); watcher.disconnect(); };
  more();
}
