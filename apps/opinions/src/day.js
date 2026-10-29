// Today: the feed, as this client sees it. Opinionated on purpose.
//   - One day. The last 24 hours of the people someone follows, and then it ends.
//   - Nobody's numbers. No likes, recasts or reply counts: you meet each cast fresh, the way it was written.
//   - Whose eyes: logged in, yours; otherwise this place's runner (each client is a person's window on Farcaster).
//   - Kept on this device and on the node, so it opens at once and refreshes quietly.
import { $, api, el, state, store } from './lib.js';
import { castActions } from './post.js';
import { loggedIn } from './fatline-login.js';
import { openUrl } from './miniapp.js';

const DAY_MS = 24 * 3600_000;
const FRESH_MS = 3 * 60_000;
const PAGES = 8;

const hhmm = (ms) => new Date(ms).toLocaleTimeString(state.lang, { hour: '2-digit', minute: '2-digit' });
const isImage = (u) => /^https:\/\/(imagedelivery\.net|i\.imgur\.com|.*\.(png|jpe?g|gif|webp)(\?|$))/i.test(u);
const channelOf = (url) => String(url ?? '').match(/\/channel\/([\w-]+)$/)?.[1] ?? null;

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

function name(u, fid) { return u?.displayName || (u?.username ? `@${u.username}` : `FID ${fid}`); }

function embedsOf(item, users) {
  const pics = [], links = [], quotes = [];
  for (const e of item.embeds ?? []) {
    if (typeof e === 'string') (isImage(e) ? pics : links).push(e);
    else if (e?.cast) quotes.push(e.cast);
  }
  const out = [];
  if (pics.length) out.push(el('div', { class: `mo-pics n${Math.min(pics.length, 4)}` }, ...pics.slice(0, 4).map((src) => el('img', { src, loading: 'lazy', alt: '' }))));
  for (const u of links) {
    let host = u; try { const x = new URL(u); host = x.host.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname.replace(/\/$/, '') : ''); } catch {}
    out.push(el('a', { class: 'mo-link', href: u, onclick: (e) => { e.preventDefault(); openUrl(u); } }, '↗ ', host.length > 60 ? `${host.slice(0, 58)}…` : host));
  }
  for (const q of quotes) out.push(el('p', { class: 'mo-quote' }, `Quoting ${users[q.fid]?.username ? `@${users[q.fid].username}` : 'a cast'}`));
  return out;
}

/** One person speaking: their consecutive casts together, each with its time. Tap to reply, if you can post here. */
function moment(group, users) {
  const u = users[group[0].fid];
  const head = el('header', { class: 'mo-head' },
    u?.pfp ? el('img', { class: 'mo-pfp', src: u.pfp, alt: '', loading: 'lazy' }) : el('span', { class: 'mo-pfp' }),
    el('a', { class: 'mo-name', href: `#/u/${group[0].fid}` }, name(u, group[0].fid)),
    u?.username ? el('span', { class: 'mo-user' }, `@${u.username}`) : null);
  const parts = group.slice().reverse().map((c) => {
    const ch = channelOf(c.parentUrl);
    const acts = el('div', { class: 'mo-acts', hidden: true }, ...castActions(c));
    const part = el('div', { class: 'mo-part' },
      el('div', { class: 'mo-when' }, el('time', {}, hhmm(c.timestamp)), ch ? el('span', { class: 'mo-ch' }, `/${ch}`) : null),
      c.text ? el('p', { class: 'mo-text' }, c.text) : null,
      ...embedsOf(c, users), acts);
    if (acts.childNodes.length) part.addEventListener('click', (e) => { if (!e.target.closest('a, button, textarea, input, form')) acts.hidden = !acts.hidden; });
    return part;
  });
  return el('article', { class: 'mo' }, head, ...parts);
}

/** Consecutive casts by the same person within two hours become one moment. Newest first. */
function moments(items) {
  const out = [];
  for (const c of items) {
    const last = out.at(-1);
    if (last && last[0].fid === c.fid && last.at(-1).timestamp - c.timestamp < 2 * 3600_000) last.push(c);
    else out.push([c]);
  }
  return out;
}

function draw(box, day, whose) {
  if (day.partial) {
    box.replaceChildren(el('header', { class: 'day-head' }, el('h1', { class: 'day-title' }, 'Today'), el('p', { class: 'day-whose' }, whose)),
      ...moments(day.items).map((g) => moment(g, day.users)), el('p', { class: 'ck-loading' }, 'Reading more…'));
    return;
  }
  const groups = moments(day.items);
  const voices = new Set(day.items.map((c) => c.fid)).size;
  const date = new Date().toLocaleDateString(state.lang, { weekday: 'long', day: 'numeric', month: 'long' });
  box.replaceChildren(
    el('header', { class: 'day-head' },
      el('p', { class: 'day-date' }, date),
      el('h1', { class: 'day-title' }, day.quiet ? 'A quiet day.' : 'Today'),
      el('p', { class: 'day-whose' }, whose)),
    ...groups.map((g) => moment(g, day.users)),
    el('footer', { class: 'day-end' },
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
    fetchDay(fid, old ? null : (d) => { if (d.items.length) draw(box, d, whose); }).then((d) => { keep(fid, d); if (box.isConnected || !old) draw(box, d, whose); })
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

export async function dayPage() {
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'ck-loading' }, '…'));
  const w = await whoseDay();
  if (!w) { location.replace('#/fatline'); return; }
  main.replaceChildren(dayFeed(w.fid, w.whose));
}
