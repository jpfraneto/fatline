// What Around and For you share: faces, the action row under a cast, and driving a flow from the keyboard.
import { el, state, timeAgo } from './lib.js';
import { closeEnergy, energy, energyOpen } from './energy.js';
import { setPageKeys } from './keys.js';

export const nameOf = (u, fid) => u?.displayName || (u?.username ? `@${u.username}` : `FID ${fid}`);
export const isImage = (u) => /^https:\/\/(imagedelivery\.net|i\.imgur\.com|.*\.(png|jpe?g|gif|webp)(\?|$))/i.test(u);
export const when = (ms) => el('time', { datetime: new Date(ms).toISOString(), title: new Date(ms).toLocaleString(state.lang) }, timeAgo(ms));

export function face(fid, users) {
  const u = users[fid];
  // The first letter underneath; the picture on top, gone if it does not load.
  const pic = u?.pfp ? el('img', { src: u.pfp, alt: '', loading: 'lazy' }) : null;
  pic?.addEventListener('error', () => pic.remove());
  return el('a', { class: 'ar-face', href: `#/u/${fid}`, title: nameOf(u, fid), 'aria-label': nameOf(u, fid) },
    el('span', {}, (u?.username ?? u?.displayName ?? '·').slice(0, 1)), pic);
}

/** What a cast says: its text and its first picture. */
export function castBody(c) {
  const pics = (c.embeds ?? []).filter((e) => typeof e === 'string' && isImage(e));
  return [c.text ? el('p', { class: 'ar-text' }, c.text) : null, pics[0] ? el('img', { class: 'ar-pic', src: pics[0], alt: '', loading: 'lazy' }) : null];
}

const channelOf = (url) => String(url ?? '').match(/\/channel\/([\w-]+)$/)?.[1] ?? null;

/** One cast, as For you and the day show it: who, when, what they said, then extra (why it is here), then the bar. */
export function castCard(c, users, ...extra) {
  const u = users[c.fid];
  const ch = channelOf(c.parentUrl);
  return el('article', { class: 'ar fy ar-item', 'data-key': c.id, 'data-at': c.timestamp, tabindex: '-1' },
    el('header', { class: 'ar-who' }, face(c.fid, users),
      el('span', {}, el('a', { href: `#/u/${c.fid}` }, nameOf(u, c.fid)), u?.username && u?.displayName ? el('span', { class: 'fy-user' }, ` @${u.username}`) : null,
        ch ? el('span', { class: 'fy-ch' }, ` /${ch}`) : null),
      when(c.timestamp)),
    ...castBody(c), ...extra, castBar(c, u));
}

const ICON = { reply: '↩', recast: '↻', quote: '❝', like: '♥' };
const LABEL = { reply: 'Reply', recast: 'Recast', quote: 'Quote', like: 'Like' };
const KEY = { reply: 'R', recast: '⇧R', quote: 'Q', like: 'L' };

/** Reply, recast, quote, like: always in sight under the cast. Each one opens the energy thread from its button. */
export function castBar(cast, user) {
  const on = { like: false, recast: false };
  const buttons = {};
  for (const kind of ['reply', 'recast', 'quote', 'like']) {
    buttons[kind] = el('button', { type: 'button', class: `ar-act ar-act-${kind}`, 'data-act': kind, title: `${LABEL[kind]} (${KEY[kind]})`, 'aria-pressed': kind in on ? 'false' : null,
      onclick: (e) => {
        e.stopPropagation();
        const undo = kind in on && on[kind];
        energy(kind, { from: buttons[kind], cast, user, undo, done: () => {
          if (!(kind in on)) return buttons[kind].classList.add('done');
          on[kind] = !undo; buttons[kind].setAttribute('aria-pressed', String(on[kind]));
        } });
      } }, el('span', { class: 'ar-icon', 'aria-hidden': 'true' }, ICON[kind]), el('span', { class: 'ar-label' }, LABEL[kind]));
  }
  return el('div', { class: 'ar-bar' }, ...Object.values(buttons));
}

export const HELP = [['j k', 'Down, up'], ['r', 'Reply'], ['q', 'Quote'], ['l', 'Like'], ['⇧R', 'Recast'], ['f', 'Follow'], ['p', 'Their profile'], ['g', 'Back to the top'],
  ['⌘↵', 'Send'], ['Esc', 'Close']];

/** The right side on a desktop, before anything is opened there: the keys that drive the page. */
export function sideKeys(help = HELP) {
  return el('aside', { class: 'ar-side', 'aria-hidden': 'true' },
    el('p', { class: 'en-kind' }, 'Keys'),
    el('dl', {}, ...help.flatMap(([k, what]) => [el('dt', {}, ...k.split(' ').map((x) => el('kbd', {}, x))), el('dd', {}, what)])));
}

/**
 * The page becomes a cockpit: a wide layout on a desktop, j / k to move through `flow`'s .ar-item children, and keys to
 * act on the chosen one. more(): read further (called near the end). Returns stop().
 */
export function drive(flow, { more = () => {}, help = HELP } = {}) {
  document.body.classList.add('ar-cockpit');
  let sel = null;
  const items = () => [...flow.querySelectorAll('.ar-item')];
  const choose = (n) => {
    sel?.classList.remove('ar-sel');
    sel = n;
    if (!n) return;
    n.classList.add('ar-sel');
    n.focus({ preventScroll: true });
    const r = n.getBoundingClientRect();
    if (r.top < 90 || r.bottom > innerHeight - 110) n.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const step = (d) => {
    const all = items();
    if (!all.length) return;
    const i = sel ? all.indexOf(sel) : -1;
    choose(all[Math.max(0, Math.min(all.length - 1, i < 0 ? 0 : i + d))]);
    if (all.indexOf(sel) >= all.length - 3) more();
  };
  const act = (kind) => () => {
    const b = (sel ?? items()[0])?.querySelector(`[data-act="${kind}"]`);
    if (b) { if (!sel) choose(b.closest('.ar-item')); b.click(); }
  };
  flow.addEventListener('click', (e) => { const n = e.target.closest('.ar-item'); if (n && n !== sel) choose(n); });
  setPageKeys({
    help,
    keys: {
      j: () => step(1), ArrowDown: () => step(1), k: () => step(-1), ArrowUp: () => step(-1),
      r: act('reply'), Enter: act('reply'), R: act('recast'), q: act('quote'), l: act('like'),
      f: () => sel?.querySelector('.follow button')?.click(),
      p: () => { const a = sel?.querySelector('.ar-who a, .ar-what a'); if (a) location.hash = a.getAttribute('href'); },
      g: () => { scrollTo({ top: 0, behavior: 'smooth' }); choose(items()[0] ?? null); },
      Escape: () => { if (energyOpen()) closeEnergy(); else choose(null); },
    },
  });
  return () => { closeEnergy(); setPageKeys(null); document.body.classList.remove('ar-cockpit'); };
}
