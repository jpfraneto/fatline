// Around: what happened around you, endlessly. The tab's number is ∞ and never anything else.
//   - What your casts set moving: replies in full, and the faces of who liked and recast. No counts.
//   - Who said your name, and who began following you.
//   - It keeps going back, cast by cast, to the first thing you ever said. Nothing is "read" or "unread".
import { $, api, el, state } from './lib.js';
import { castActions } from './post.js';
import { loggedIn } from './fatline-login.js';

const when = (ms) => new Date(ms).toLocaleString(state.lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const nameOf = (u, fid) => u?.displayName || (u?.username ? `@${u.username}` : `FID ${fid}`);

function face(fid, users) {
  const u = users[fid];
  // The first letter underneath; the picture on top, gone if it does not load.
  const letter = el('span', {}, (u?.username ?? u?.displayName ?? '·').slice(0, 1));
  const pic = u?.pfp ? el('img', { src: u.pfp, alt: '', loading: 'lazy' }) : null;
  pic?.addEventListener('error', () => pic.remove());
  return el('a', { class: 'ar-face', href: `#/u/${fid}`, title: nameOf(u, fid), 'aria-label': nameOf(u, fid) }, letter, pic);
}

function faces(mark, fids, more, users) {
  if (!fids.length) return null;
  return el('div', { class: 'ar-faces' }, el('span', { class: 'ar-mark', 'aria-hidden': 'true' }, mark), ...fids.map((f) => face(f, users)),
    more ? el('span', { class: 'ar-more' }, 'and others') : null);
}

const isImage = (u) => /^https:\/\/(imagedelivery\.net|i\.imgur\.com|.*\.(png|jpe?g|gif|webp)(\?|$))/i.test(u);

/** A cast with pictures or links: the first picture small, or where the link goes. */
function bare(c) {
  const urls = (c.embeds ?? []).filter((e) => typeof e === 'string');
  const pic = urls.find(isImage);
  if (pic) return [el('img', { class: 'ar-pic', src: pic, alt: '', loading: 'lazy' })];
  if (urls[0]) { let h = urls[0]; try { h = new URL(urls[0]).host.replace(/^www\./, ''); } catch {} return [el('p', { class: 'ar-link' }, `↗ ${h}`)]; }
  if ((c.embeds ?? []).length) return [el('p', { class: 'ar-link' }, 'a quoted cast')];
  return [];
}

function said(c, users) {
  const acts = el('div', { class: 'mo-acts', hidden: true }, ...castActions(c));
  const part = el('div', { class: 'ar-said' },
    el('header', { class: 'ar-who' }, face(c.fid, users), el('a', { class: 'mo-name', href: `#/u/${c.fid}` }, nameOf(users[c.fid], c.fid)), el('time', {}, when(c.timestamp))),
    c.text ? el('p', { class: 'ar-text' }, c.text) : null, ...bare(c), acts);
  if (acts.childNodes.length) part.addEventListener('click', (e) => { if (!e.target.closest('a, button, textarea, input, form')) acts.hidden = !acts.hidden; });
  return part;
}

function item(i, users) {
  if (i.kind === 'follow') {
    return el('p', { class: 'ar-line' }, face(i.fid, users), el('span', {}, el('a', { href: `#/u/${i.fid}` }, nameOf(users[i.fid], i.fid)), ' began following you'), el('time', {}, when(i.at)));
  }
  if (i.kind === 'mention') {
    return el('article', { class: 'ar ar-mention' }, el('p', { class: 'ar-kind' }, 'said your name'), said(i.cast, users));
  }
  return el('article', { class: 'ar' },
    el('div', { class: 'ar-yours' }, el('time', {}, `you · ${when(i.cast.timestamp)}`), i.cast.text ? el('p', {}, i.cast.text) : null, ...bare(i.cast)),
    faces('♥', i.likes, i.moreLikes, users),
    faces('↻', i.recasts, i.moreRecasts, users),
    ...i.replies.slice().reverse().map((r) => said(r, users)),
    i.moreReplies ? el('p', { class: 'ar-more' }, 'and more replies') : null);
}

/** Whose surroundings: who signed in here, else this place's runner, else this client's account. */
async function whose() {
  const me = loggedIn();
  if (me?.fid) return { fid: me.fid, line: null };
  const place = await api('/api/place').catch(() => null);
  const owner = place?.owner ?? (place?.fid ? { fid: place.fid } : null);
  if (owner?.fid) return { fid: owner.fid, line: `Around ${owner.username ? `@${owner.username}` : `FID ${owner.fid}`}. Sign in to see yours.` };
  if (state.me?.fid) return { fid: state.me.fid, line: null };
  return null;
}

let watcher = null;

export async function aroundPage() {
  watcher?.disconnect();
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'ck-loading' }, '…'));
  const w = await whose();
  if (!w) { location.replace('#/fatline'); return; }
  const flow = el('div', { class: 'ar-flow' });
  const tail = el('p', { class: 'ar-tail' }, el('span', { class: 'ar-inf', 'aria-hidden': 'true' }, '∞'));
  main.replaceChildren(el('section', { class: 'day around' },
    el('header', { class: 'day-head' },
      el('h1', { class: 'day-title' }, 'Around you'),
      el('p', { class: 'day-whose' }, w.line ?? 'What your casts set moving, and who came near. It does not end.')),
    flow, tail));

  let cursor = null;
  let busy = false;
  let ended = false;
  let failed = false;
  async function more() {
    if (busy || ended || failed || !tail.isConnected) return;
    busy = true;
    try {
      // Quiet stretches come back empty: keep reading until something happened, or history runs out.
      for (let i = 0; i < 6; i++) {
        const page = await api(`/api/around/${w.fid}`, { network: state.network, ...(cursor ? { cursor } : {}) });
        if (!tail.isConnected) return;
        flow.append(...page.items.map((x) => item(x, page.users)));
        cursor = page.next;
        if (!cursor) { ended = true; break; }
        if (page.items.length) break;
      }
      if (ended) tail.replaceChildren(el('span', { class: 'day-seal', 'aria-hidden': 'true' }, '✦'), el('span', {}, 'Your first cast. Everything since came from there.'));
    } catch (err) {
      // The node did not answer: say so, and wait for a tap instead of asking again and again.
      failed = true;
      tail.replaceChildren(el('span', { class: 'muted' }, err.message), ' ',
        el('button', { type: 'button', class: 'link', onclick: () => { failed = false; tail.replaceChildren(el('span', { class: 'ar-inf' }, '∞')); more(); } }, 'Again'));
      return;
    } finally { busy = false; }
    // Still in sight after filling: read on.
    if (!ended && tail.getBoundingClientRect().top < innerHeight + 600) more();
  }
  watcher = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) more(); }, { rootMargin: '900px 0px' });
  watcher.observe(tail);
  more();
}
