// Fatline: the world. You walk in and it is alive: the Fatliners (hatched, the same base being, Aster first), the eggs
// still being kept warm, and every other of the 777 places, an egg not laid yet. Each one glows by what its coin has
// earned in trading fees, ever (the vault's harvests plus what waits in the fee locker, from fatline.ink/world).
// Tap one to walk into its place. How to bring one to life (the manual) waits at the bottom.
import { $, el, state } from './lib.js';
import { openPlace, inMiniApp, openUrl } from './miniapp.js';
// The same file fatline.ink serves as /manual.js, bundled in here: a node never asks fatline.ink to draw it.
import { mountManual } from '../../site/manual.js';

const WORLD = 'https://fatline.ink/world';
const ART = 'https://fatline.ink/fatliners-art.json';
const titled = (s) => s.charAt(0) + s.slice(1).toLowerCase();
const arweaveId = (u) => String(u ?? '').match(/arweave\.net\/([\w-]{43})/)?.[1];
const pic = (u) => (arweaveId(u) ? `https://fatline.ink/api/art/${arweaveId(u)}` : u);
const usd = (x) => (x >= 100 ? `$${Math.round(x).toLocaleString('en-US')}` : `$${x.toFixed(2)}`);

/** How alive, 0 to 1: what its coin earned, on a log scale ($1 is already a glow, $1,000 is full). No coin: an ember. */
export function aliveness(earned) {
  if (!(earned > 0)) return 0.12;
  return Math.min(1, 0.3 + 0.7 * Math.log10(1 + earned) / 3);
}

function look(node, a) {
  node.style.setProperty('--alive', a.toFixed(3));
  node.style.setProperty('--breath', `${(7 - 4 * a).toFixed(2)}s`);
  return node;
}

function walkIn(tk) {
  const host = `${tk.surname.toLowerCase()}.fatline.ink`;
  if (location.host === host) return () => location.assign('#/');
  return () => openPlace(`https://${host}`);
}

/** A Fatliner: its own art, or the base being every Fatliner shares until its own is made. */
function being(tk, { art, genesis }) {
  const own = art.beings?.[tk.fid]?.image;
  const base = art.beings?.[genesis]?.image;
  const a = aliveness(tk.earned);
  return look(el('button', { type: 'button', class: `wb${own ? '' : ` base stone-${tk.stone}`}`, onclick: walkIn(tk), 'aria-label': titled(tk.surname) },
    el('span', { class: 'wb-aura', 'aria-hidden': 'true' }),
    el('img', { class: 'wb-art', src: pic(own ?? base), alt: '', loading: 'lazy' }),
    el('span', { class: 'wb-name' }, tk.fid === genesis ? `Aster ${titled(tk.surname)}` : titled(tk.surname)),
    tk.earned > 0 ? el('span', { class: 'wb-earned' }, `${usd(tk.earned)} earned`) : null), a);
}

/** An egg being kept warm: its stone. */
function egg(tk, { art }) {
  return look(el('button', { type: 'button', class: 'we', onclick: walkIn(tk), 'aria-label': `${titled(tk.surname)}, an egg` },
    el('span', { class: 'wb-aura', 'aria-hidden': 'true' }),
    el('img', { class: 'we-art', src: pic(art.eggs?.[tk.stone]?.image ?? art.egg?.image), alt: '', loading: 'lazy' }),
    el('span', { class: 'wb-name' }, titled(tk.surname)),
    tk.warmth && !tk.warmth.hatched ? el('span', { class: 'wb-earned' }, `${tk.warmth.warmDays ?? 0} of ${tk.warmth.needed ?? 3} warm days`) : null), aliveness(tk.earned));
}

/** The places nobody has laid yet: a field of eggs, each breathing at its own pace. */
function field(n) {
  const box = el('div', { class: 'wf', role: 'img', 'aria-label': `${n} eggs not laid yet` });
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    const r = ((i * 2654435761) >>> 0) / 4294967296; // the same field every time
    s.style.setProperty('--d', `${(-r * 9).toFixed(2)}s`);
    s.style.setProperty('--t', `${(6 + r * 6).toFixed(2)}s`);
    const q = ((i * 40503 + 7) % 997) / 997, w = ((i * 9301 + 49297) % 233280) / 233280;
    s.style.transform = `translate(${((q - 0.5) * 8).toFixed(1)}px, ${((w - 0.5) * 8).toFixed(1)}px) scale(${(0.7 + q * 0.55).toFixed(2)}) rotate(${((w - 0.5) * 30).toFixed(0)}deg)`;
    if (r > 0.93) s.className = 'spark';
    frag.append(s);
  }
  box.append(frag);
  return box;
}

export async function directoryPage() {
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'ck-loading' }, '…'));
  let world, art;
  try {
    [world, art] = await Promise.all([fetch(WORLD).then((r) => r.json()), fetch(ART).then((r) => r.json()).catch(() => ({}))]);
  } catch (err) { main.replaceChildren(el('p', { class: 'warn' }, `fatline.ink did not answer: ${err.message}`)); return; }
  const genesis = world.genesisFid;
  const alive = (world.tokens ?? []).filter((t) => t.surname && (t.stage === 'egg' || t.stage === 'fatliner'));
  const beings = alive.filter((t) => t.stage === 'fatliner')
    .sort((x, y) => (y.fid === genesis) - (x.fid === genesis) || (y.earned ?? 0) - (x.earned ?? 0) || x.laidAt - y.laidAt);
  const eggs = alive.filter((t) => t.stage === 'egg').sort((x, y) => (y.earned ?? 0) - (x.earned ?? 0) || x.laidAt - y.laidAt);
  const waiting = Math.max(0, (world.places ?? 777) - alive.length);
  const manual = el('div', { class: 'world-manual' });
  main.replaceChildren(el('section', { class: 'world' },
    el('header', { class: 'world-head' },
      el('h1', {}, 'Fatline'),
      el('p', {}, [`${beings.length} ${beings.length === 1 ? 'Fatliner' : 'Fatliners'}`, `${eggs.length} ${eggs.length === 1 ? 'egg' : 'eggs'}`, `${waiting} waiting`].join(' · '))),
    el('div', { class: 'world-beings' }, ...beings.map((tk) => being(tk, { art, genesis }))),
    eggs.length ? el('div', { class: 'world-eggs' }, ...eggs.map((tk) => egg(tk, { art }))) : null,
    field(waiting),
    el('p', { class: 'world-foot' }, 'Each one glows with what its coin has earned.'),
    manual));
  mountManual(manual, { lang: state.lang, dock: false, openUrl: inMiniApp() ? openUrl : null });
}
