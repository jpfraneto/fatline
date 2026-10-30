// Everything, in order: the feed, as this client sees it. Opinionated on purpose.
//   - One day. The last 24 hours of the people someone follows, and then it ends.
//   - Nobody's numbers. No likes, recasts or reply counts: you meet each cast fresh, the way it was written.
//   - Whose eyes: logged in, yours; otherwise this place's runner (each client is a person's window on Farcaster).
//   - Kept on this device and on the node, so it opens at once and refreshes quietly.
import { $, api, el, state, store } from './lib.js';
import { loggedIn } from './fatline-login.js';
import { castCard, drive, sideKeys } from './flow.js';

const DAY_MS = 24 * 3600_000;
const FRESH_MS = 3 * 60_000;
const PAGES = 8;

function cached(fid) { return store.get(`day:${fid}`, null); }
function keep(fid, v) { try { localStorage.setItem(`day:${fid}`, JSON.stringify(v)); } catch { /* full or private: fine */ } }

/** The last day of fid's home, from this node: every page until a cast is older than a day. */
async function fetchDay(fid, onPage = null) {
  const since = Date.now() - DAY_MS;
  const items = [];
  const users = {};
  let before = null;
  for (let i = 0; i < PAGES; i++) {
    const page = await api(`/api/home/${fid}`, { limit: 50, ...(before ? { before } : {}) });
    Object.assign(users, page.users);
    items.push(...page.items);
    onPage?.({ at: Date.now(), items: items.filter((c) => c.timestamp >= since), users, partial: true });
    if (!page.next || page.items.at(-1)?.timestamp < since) break;
    before = page.next;
  }
  const day = items.filter((c) => c.timestamp >= since);
  // A quiet day still shows something: the last few things said.
  return { at: Date.now(), items: day.length ? day : items.slice(0, 12), quiet: !day.length, users };
}

function draw(box, day, whose) {
  const date = new Date().toLocaleDateString(state.lang, { weekday: 'long', day: 'numeric', month: 'long' });
  const voices = new Set(day.items.map((c) => c.fid)).size;
  // The same cards as For you, newest first: reply, recast, quote and like under each one.
  box.replaceChildren(
    el('header', { class: 'day-head' },
      el('p', { class: 'day-date' }, date),
      el('h1', { class: 'day-title' }, day.quiet ? 'A quiet day.' : 'Everything, in order'),
      el('p', { class: 'day-whose' }, whose)),
    el('div', { class: 'ar-flow' }, ...day.items.map((c) => castCard(c, day.users))),
    day.partial ? el('p', { class: 'ck-loading' }, 'Reading more…') : el('footer', { class: 'day-end' },
      el('span', { class: 'day-seal', 'aria-hidden': 'true' }, '✦'),
      el('p', {}, day.quiet ? 'Nothing new in the last day. Those were the last things said.' : `That's the day. ${voices} ${voices === 1 ? 'person' : 'people'} spoke.`),
      el('p', { class: 'muted' }, 'Come back tomorrow.')));
}

/** The day, for fid. whose: the line that says through whose eyes. Returns the element; it fills itself. */
export function dayFeed(fid, whose) {
  const box = el('section', { class: 'day' });
  const old = cached(fid);
  if (old?.items) draw(box, old, whose);
  else box.append(el('p', { class: 'ck-loading' }, 'Reading the day from this node…'));
  if (!old || Date.now() - old.at > FRESH_MS) {
    // Drawn again only when something changed, so whatever you are reading or have chosen stays put.
    const same = (d) => old?.items?.map((c) => c.id).join() === d.items.map((c) => c.id).join();
    fetchDay(fid, old ? null : (d) => { if (d.items.length) draw(box, d, whose); }).then((d) => { keep(fid, d); if (!old || !same(d)) draw(box, d, whose); })
      .catch((err) => { if (!old) box.replaceChildren(el('p', { class: 'muted' }, err.message)); });
  }
  return box;
}

/** Whose day this client shows: who signed in here, else this place's runner, else this client's account. */
export async function whoseDay() {
  const me = loggedIn();
  if (me?.fid) return { fid: me.fid, whose: 'The people you follow, read from this node.' };
  const place = await api('/api/place').catch(() => null);
  const owner = place?.owner ?? (place?.fid ? { fid: place.fid } : null);
  if (owner?.fid) return { fid: owner.fid, whose: `Through ${owner.username ? `@${owner.username}` : `FID ${owner.fid}`}'s eyes: the people they follow. Sign in with Farcaster to see yours.` };
  if (state.me?.fid) return { fid: state.me.fid, whose: 'The people you follow, read from your node.' };
  return null;
}

let stop = () => {};
export function leaveDay() { stop(); stop = () => {}; }

/** #/day: the same page as For you (cards, keys, the right side), with everything from the last day in order. */
export async function dayPage() {
  stop();
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'ck-loading' }, '…'));
  const w = await whoseDay();
  if (!location.hash.startsWith('#/day')) return; // left while asking: the page now open stays
  if (!w) { location.replace('#/fatline'); return; }
  const feed = dayFeed(w.fid, [w.whose, ' ', el('a', { href: '#/', class: 'fy-all' }, '← For you')]);
  feed.classList.add('foryou');
  main.replaceChildren(feed, sideKeys());
  const stopDriving = drive(feed);
  stop = () => stopDriving();
}
