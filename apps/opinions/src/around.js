// Around: everything that happened around you, newest first, as it happens. The tab's number is ∞, never anything else.
//   - Replies and mentions in full, with reply, recast, quote and like under them; likes, recasts and follows as one
//     line each (likes on the same cast, back to back, share a line). No counts.
//   - New things arrive at the top on their own. Scrolling down goes back in time, without end.
//   - Opens at once from what this device saw last, then reads what is new.
//   - #/around/<fid or name> shows anyone's: it is all public, on every node.
import { $, api, el, state, store } from './lib.js';
import { followButton } from './post.js';
import { newPill } from './fresh.js';
import { loggedIn } from './fatline-login.js';
import { castBar, castBody, drive, face, isImage, nameOf, sideKeys, when } from './flow.js';

const LIVE_MS = 45_000;
const VERB = { like: 'liked', recast: 'recast', follow: 'began following you', reply: 'replied', mention: 'said your name' };

/** One line of your cast: what this is about. */
function yours(y) {
  if (!y) return null;
  const pic = (y.embeds ?? []).find((e) => typeof e === 'string' && isImage(e));
  return el('p', { class: 'ar-yours' }, pic ? el('img', { src: pic, alt: '', loading: 'lazy' }) : null, y.text || (pic ? '' : 'your cast'));
}

/** Above a reply: which cast of yours it answers, one line, the way a thread reads (not a quote, which sits below). */
function replyTo(y) {
  if (!y) return null;
  const pic = (y.embeds ?? []).find((e) => typeof e === 'string' && isImage(e));
  return el('p', { class: 'ar-to' }, el('span', { class: 'ar-to-mark', 'aria-hidden': 'true' }, '↩'), 'to your cast ',
    pic && !y.text ? el('img', { src: pic, alt: '', loading: 'lazy' }) : el('span', { class: 'ar-to-said' }, y.text ? `“${y.text.replace(/\s+/g, ' ')}”` : ''));
}

function row(g, users) {
  const [first] = g;
  if (first.kind === 'reply' || first.kind === 'mention') {
    return el('article', { class: `ar ar-${first.kind} ar-item`, 'data-key': first.key, tabindex: '-1' },
      el('header', { class: 'ar-who' }, face(first.fid, users),
        el('span', {}, el('a', { href: `#/u/${first.fid}` }, nameOf(users[first.fid], first.fid)), ` ${VERB[first.kind]}`), when(first.at)),
      first.kind === 'reply' ? replyTo(first.yours) : null, ...castBody(first.cast), castBar(first.cast, users[first.fid]));
  }
  const who = g.map((e) => e.fid);
  const names = who.length === 1 ? el('a', { href: `#/u/${first.fid}` }, nameOf(users[first.fid], first.fid))
    : el('span', {}, el('a', { href: `#/u/${first.fid}` }, nameOf(users[first.fid], first.fid)), ' and others');
  return el('div', { class: `ar-line ar-${first.kind} ar-item`, 'data-key': first.key, tabindex: '-1' },
    el('span', { class: 'ar-faces' }, ...who.slice(0, 5).map((f) => face(f, users))),
    el('div', { class: 'ar-what' }, el('p', {}, names, ` ${VERB[first.kind]}`), yours(first.yours),
      first.kind === 'follow' ? followButton(first.fid) : null),
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
  const place = store.get('place', null) ?? await api('/api/place').catch(() => null);
  const owner = place?.owner ?? (place?.fid ? { fid: place.fid } : null);
  if (owner?.fid) return { fid: owner.fid, line: `Around ${owner.username ? `@${owner.username}` : `FID ${owner.fid}`}. Sign in to see yours.` };
  if (state.me?.fid) return { fid: state.me.fid, line: null };
  return null;
}

let stop = () => {};

/** Leaving the page: its keys, its layout, its thread and its live reading all stop. */
export function leaveAround() { stop(); stop = () => {}; }

export async function aroundPage(q = null) {
  stop();
  const main = $('#main');
  const w = await whose(q);
  if (!w) { location.replace('#/fatline'); return; }
  const flow = el('div', { class: 'ar-flow' });
  const tail = el('p', { class: 'ar-tail' }, el('span', { class: 'ar-inf', 'aria-hidden': 'true' }, '∞'));
  main.replaceChildren(el('section', { class: 'day around' },
    el('header', { class: 'day-head' },
      el('h1', { class: 'day-title' }, w.title ?? 'Around you'),
      el('p', { class: 'day-whose' }, w.line ?? 'Everything that happens around you, as it happens. It does not end.')),
    flow, tail), sideKeys());

  const seen = new Set();
  const waiting = [];
  const pill = newPill(main.querySelector('.around'));
  const cacheKey = `around:${state.network}:${w.fid}`;
  const read = (before) => api(`/api/around/${w.fid}`, { network: state.network, ...(before ? { before } : {}) });
  const fresh = (items) => items.filter((e) => !seen.has(e.key) && seen.add(e.key));

  // What this device saw last, at once. The first reading then only adds what is new on top.
  const last = store.get(cacheKey, null);
  if (last?.items?.length) flow.append(...groups(fresh(last.items)).map((g) => row(g, last.users)));

  let before = last?.next ?? null, busy = false, ended = false, failed = false;
  async function more() {
    if (busy || ended || failed || !tail.isConnected) return;
    busy = true;
    try {
      for (let i = 0; i < 4; i++) {
        const page = await read(before);
        if (!tail.isConnected) return;
        if (!before) store.set(cacheKey, { items: page.items, users: page.users, next: page.next });
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
  async function top() {
    if (!flow.isConnected || document.hidden) return;
    const page = await read(null).catch(() => null);
    if (!page) return;
    store.set(cacheKey, { items: page.items, users: page.users, next: page.next });
    const add = fresh(page.items);
    if (!add.length) return;
    const rows = groups(add).map((g) => row(g, page.users));
    for (const r of rows) r.classList.add('ar-new');
    // Never under your eyes: newer ones wait with the others behind the pill.
    waiting.unshift(...rows);
    pill.offer(waiting.length, () => flow.prepend(...waiting.splice(0)));
  }
  const live = setInterval(top, LIVE_MS);
  const watcher = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) more(); }, { rootMargin: '900px 0px' });
  watcher.observe(tail);
  const stopDriving = drive(flow, { more });
  stop = () => { clearInterval(live); watcher.disconnect(); stopDriving(); };
  if (last?.items?.length) top(); else more();
}
