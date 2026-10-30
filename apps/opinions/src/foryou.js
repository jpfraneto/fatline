// For you: the landing. Not everything in order: a handful of casts worth answering, from the people you follow and
// from the people they are paying attention to, each with why it is here (faces, words, no numbers). The server picks
// them (indexer/src/discover.mjs); this device keeps the last picks so the page opens at once.
// Everything, in order, is still there: #/day.
import { $, api, el, state, store } from './lib.js';
import { loggedIn } from './fatline-login.js';
import { castCard, drive, face, nameOf, sideKeys } from './flow.js';
import { dayFeed } from './day.js';
import { followButton } from './post.js';

const FRESH_MS = 6 * 60_000;

function why(w, users) {
  const people = (fids, more) => [el('span', { class: 'ar-faces' }, ...fids.map((f) => face(f, users))),
    el('a', { href: `#/u/${fids[0]}` }, nameOf(users[fids[0]], fids[0])), fids.length > 1 || more ? ' and others' : ''];
  if (w.kind === 'liked') return el('span', { class: 'fy-why' }, ...people(w.fids, w.more), ' liked this');
  if (w.kind === 'recast') return el('span', { class: 'fy-why' }, ...people(w.fids, w.more), ' recast this');
  if (w.kind === 'near') return el('span', { class: 'fy-why fy-tag' }, 'has been around you');
  if (w.kind === 'new') return el('span', { class: 'fy-why fy-tag' }, 'new to you');
  if (w.kind === 'question') return el('span', { class: 'fy-why fy-tag' }, 'asks');
  return null;
}

function card(item, users) {
  const isNew = item.why.some((w) => w.kind === 'new');
  return castCard(item.cast, users,
    item.why.length ? el('div', { class: 'fy-whys' }, ...item.why.map((w) => why(w, users)), isNew ? followButton(item.cast.fid) : null) : null);
}

async function whose() {
  const me = loggedIn();
  if (me?.fid) return { fid: me.fid, line: 'What your people are saying, and what they are paying attention to.' };
  const place = store.get('place', null) ?? await api('/api/place').catch(() => null);
  const owner = place?.owner ?? (place?.fid ? { fid: place.fid } : null);
  if (owner?.fid) return { fid: owner.fid, line: `Through ${owner.username ? `@${owner.username}` : `FID ${owner.fid}`}'s eyes. Sign in to see yours.` };
  if (state.me?.fid) return { fid: state.me.fid, line: 'What your people are saying, and what they are paying attention to.' };
  return null;
}

let stop = () => {};
export function leaveForYou() { stop(); stop = () => {}; }

export async function forYouPage() {
  stop();
  const main = $('#main');
  const hash = location.hash;
  const w = await whose();
  if (location.hash !== hash) return; // left while asking: the page now open stays
  if (!w) { location.replace('#/fatline'); return; }
  const key = `foryou:${w.fid}`;
  const list = el('div', { class: 'ar-flow' });
  const note = el('div', { class: 'fy-note' });
  const date = new Date().toLocaleDateString(state.lang, { weekday: 'long', day: 'numeric', month: 'long' });
  main.replaceChildren(el('section', { class: 'day foryou' },
    el('header', { class: 'day-head' },
      el('p', { class: 'day-date' }, date),
      el('h1', { class: 'day-title' }, 'For you'),
      el('p', { class: 'day-whose' }, w.line, ' ', el('a', { href: '#/day', class: 'fy-all' }, 'Everything, in order →'))),
    note, list,
    el('footer', { class: 'day-end' }, el('span', { class: 'day-seal', 'aria-hidden': 'true' }, '✦'),
      el('p', {}, 'That is what is worth answering, for now.'), el('p', { class: 'muted' }, el('a', { href: '#/day' }, 'Everything, in order →')))), sideKeys());

  const draw = (v) => list.replaceChildren(...v.items.map((i) => card(i, v.users)));
  const old = store.get(key, null);
  if (old?.items?.length) draw(old);
  const stopDriving = drive(list);
  stop = () => stopDriving();

  if (old && Date.now() - old.at < FRESH_MS) return;
  // The first time, the picks take a while to read: the day, in order, keeps you company meanwhile.
  if (!old?.items?.length) {
    note.replaceChildren(el('p', { class: 'ck-loading fy-wait' }, el('span', { class: 'ar-inf', 'aria-hidden': 'true' }, '∞'), ' Reading what your people are saying…'));
    const day = dayFeed(w.fid, 'Meanwhile, the day in order.');
    day.classList.add('fy-day');
    note.append(day);
  }
  try {
    const v = await api(`/api/discover/${w.fid}`);
    if (!list.isConnected) return;
    const value = { at: v.at ?? Date.now(), items: v.items, users: v.users };
    store.set(key, value);
    const same = old?.items?.map((i) => i.cast.id).join() === v.items.map((i) => i.cast.id).join();
    if (same) return;
    // New picks: in place while nobody is reading yet; otherwise a quiet pill at the top.
    if (!old?.items?.length || (scrollY < 60 && !document.querySelector('.ar-sel'))) { note.replaceChildren(); draw(value); return; }
    note.replaceChildren(el('button', { type: 'button', class: 'fy-pill', onclick: () => { note.replaceChildren(); draw(value); scrollTo({ top: 0, behavior: 'smooth' }); } }, 'New picks ↑'));
  } catch (err) {
    if (!old?.items?.length) note.prepend(el('p', { class: 'muted' }, err.message));
  }
}
