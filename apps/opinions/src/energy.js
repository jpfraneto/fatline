// The energy thread. Act on a cast (reply, quote, like, recast) and a thread of light, in the color of the network
// you are on, runs from the button to the right side of the screen, where you write what you have to write.
// On a narrow screen there is no room to the right: the same panel rises from the bottom instead.
import { el, state, t } from './lib.js';
import { castAs, loadMe } from './post.js';
import { openCast } from './castbutton.js';
import { profileOf } from './fatline-login.js';

const MAX_BYTES = 1024;
const WORDS = {
  reply: { title: 'Reply to', send: 'Reply', placeholder: 'Your reply…' },
  quote: { title: 'Quote', send: 'Quote', placeholder: 'Add your words (or nothing)…' },
  like: { title: 'Liked', undo: 'Unliked' },
  recast: { title: 'Recast', undo: 'Recast removed' },
};

let ui = null;

function build() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'en-thread');
  svg.setAttribute('aria-hidden', 'true');
  const glow = document.createElementNS(NS, 'path'); glow.setAttribute('class', 'en-glow');
  const core = document.createElementNS(NS, 'path'); core.setAttribute('class', 'en-core');
  const flow = document.createElementNS(NS, 'path'); flow.setAttribute('class', 'en-flow');
  const spark = document.createElementNS(NS, 'circle'); spark.setAttribute('class', 'en-spark'); spark.setAttribute('r', '4');
  svg.append(glow, core, flow, spark);
  const panel = el('aside', { class: 'en-panel', 'aria-live': 'polite' });
  document.body.append(svg, panel);
  return { svg, glow, core, flow, spark, panel, from: null, raf: 0, timer: 0, kind: null, turn: 0 };
}

const wide = () => matchMedia('(min-width: 1180px)').matches;

/** The thread, from the button that started it to the panel, drawn again every frame while it is open. */
function draw() {
  const { svg, glow, core, flow, spark, panel, from } = ui;
  if (!from?.isConnected || !wide()) { svg.classList.remove('on'); ui.raf = requestAnimationFrame(draw); return; }
  // It leaves from the edge of the card the button sits on, level with the button: it never crosses what was said.
  const a = from.getBoundingClientRect();
  const edge = (from.closest('[data-key], article') ?? from).getBoundingClientRect().right;
  const b = panel.getBoundingClientRect();
  const sx = edge + 2, sy = Math.min(Math.max(a.top + a.height / 2, 8), innerHeight - 8);
  const tx = b.left - 2, ty = b.top + 46;
  const dx = Math.max(60, (tx - sx) * 0.55);
  const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
  for (const p of [glow, core, flow]) p.setAttribute('d', d);
  spark.setAttribute('cx', tx); spark.setAttribute('cy', ty);
  svg.classList.add('on');
  ui.raf = requestAnimationFrame(draw);
}

export function closeEnergy() {
  if (!ui) return;
  cancelAnimationFrame(ui.raf); clearTimeout(ui.timer);
  ui.svg.classList.remove('on', 'spawn', 'sent');
  ui.panel.classList.remove('open');
  ui.from?.classList.remove('en-from');
  ui.from = null; ui.kind = null;
  document.body.classList.remove('en-open');
}

export const energyOpen = () => Boolean(ui?.kind);

function spawn(from) {
  ui ??= build();
  cancelAnimationFrame(ui.raf); clearTimeout(ui.timer);
  ui.from?.classList.remove('en-from');
  ui.from = from;
  from?.classList.add('en-from');
  ui.svg.classList.remove('sent', 'spawn');
  void ui.svg.getBoundingClientRect(); // restart the drawing-on
  ui.svg.classList.add('spawn');
  ui.panel.classList.add('open');
  document.body.classList.add('en-open');
  ui.raf = requestAnimationFrame(draw);
}

const isImage = (u) => /^https:\/\/(imagedelivery\.net|i\.imgur\.com|.*\.(png|jpe?g|gif|webp)(\?|$))/i.test(u);
const nameOf = (u, fid) => (u?.username ? `@${u.username}` : u?.displayName ?? `FID ${fid}`);

/** The cast acted on. as: 'target' (like, recast: a bar beside it), 'parent' (reply: a thread line down to what you
 * write) or 'embed' (quote: a card inside what you write, the way it will look once sent). */
function target(cast, user, as = 'target') {
  const pic = (cast.embeds ?? []).find((e) => typeof e === 'string' && isImage(e));
  return el('div', { class: `en-target en-${as}` },
    el('p', { class: 'en-who' }, user?.pfp ? el('img', { src: user.pfp, alt: '' }) : el('span', { class: 'en-dot' }), nameOf(user, cast.fid)),
    cast.text ? el('p', { class: 'en-said' }, cast.text) : null,
    as === 'embed' && pic ? el('img', { class: 'en-pic', src: pic, alt: '', loading: 'lazy' }) : null);
}

/** Your face, beside what you write in a reply: the thread runs from their face to yours. */
function myFace() {
  const box = el('span', { class: 'en-me', 'aria-hidden': 'true' });
  profileOf(state.me.fid).then((p) => { if (p.pfp) box.append(el('img', { src: p.pfp, alt: '' })); });
  return box;
}

// Bubbles: one per like or recast. A spark leaves the button and flies to the corner, a bubble opens there with a
// current running around its edge while the node takes it, it lights up when the node has it, and then it pops.
let shelf = null;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function flySpark(from, to) {
  if (!from?.isConnected || still()) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const dot = el('i', { class: 'bb-spark', 'aria-hidden': 'true' });
  document.body.append(dot);
  const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2, x1 = b.left + 22, y1 = b.top + b.height / 2;
  const mid = { x: (x0 + x1) / 2 + (y1 - y0) * 0.15, y: Math.min(y0, y1) - 60 }; // an arc, not a straight line
  dot.animate([
    { transform: `translate(${x0}px, ${y0}px) scale(1)`, opacity: 1 },
    { transform: `translate(${mid.x}px, ${mid.y}px) scale(1.3)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${x1}px, ${y1}px) scale(.4)`, opacity: 0.2 },
  ], { duration: 520, easing: 'cubic-bezier(.3, .1, .3, 1)' }).finished.then(() => dot.remove(), () => dot.remove());
}

function bubble(kind, { from, cast, user, undo, done }) {
  shelf ??= document.body.appendChild(el('div', { class: 'bb-shelf', 'aria-live': 'polite' }));
  const words = WORDS[kind];
  const status = el('span', { class: 'bb-status' }, t('signing'));
  const b = el('div', { class: `bb bb-${kind} bb-busy`, role: 'status' },
    el('span', { class: 'bb-icon', 'aria-hidden': 'true' }, kind === 'like' ? '♥' : '↻'),
    el('span', { class: 'bb-words' }, el('b', {}, undo ? words.undo : words.title), ` ${nameOf(user, cast.fid)}`, status));
  const pop = () => { b.classList.add('bb-pop'); setTimeout(() => b.remove(), 420); };
  b.addEventListener('click', pop);
  shelf.append(b);
  flySpark(from, b);
  from?.classList.add('en-zap');
  setTimeout(() => from?.classList.remove('en-zap'), 600);
  castAs('/api/react', { kind, fid: cast.fid, hash: cast.id, remove: undo }).then((result) => {
    b.classList.remove('bb-busy');
    b.classList.add(result.state === 'confirmed' ? 'bb-done' : 'bb-pending');
    status.textContent = result.state === 'confirmed' ? `on ${String(result.node ?? 'the node').replace(/^https?:\/\//, '')}` : t('pending');
    done?.(kind, result);
    setTimeout(pop, 1900);
  }, (err) => {
    b.classList.remove('bb-busy');
    b.classList.add('bb-failed');
    status.textContent = err.message;
    setTimeout(pop, 6000);
  });
}

/**
 * Opens the thread for one action on one cast. kind: reply | quote | like | recast.
 * from: the element the thread starts at. done(kind, result): after the node has it.
 * For like and recast, undo: true takes it back.
 */
export async function energy(kind, { from, cast, user, undo = false, done } = {}) {
  if (!state.me) await loadMe();
  const signedIn = state.me?.fid && state.me?.canWrite;
  // A like or a recast is its own bubble: it never touches what you are writing.
  if (signedIn && (kind === 'like' || kind === 'recast')) return bubble(kind, { from, cast, user, undo, done });
  spawn(from);
  ui.kind = kind;
  const turn = ++ui.turn; // a send that finishes after another panel opened must leave that one alone
  const words = WORDS[kind];
  const close = el('button', { type: 'button', class: 'en-close', 'aria-label': 'Close', title: 'Close (Esc)', onclick: closeEnergy }, '×');
  if (!signedIn) {
    ui.panel.replaceChildren(close, el('p', { class: 'en-kind' }, words.title), target(cast, user),
      el('p', {}, 'Sign in to answer, quote, like and recast from here.'),
      el('button', { type: 'button', class: 'en-send', onclick: () => { closeEnergy(); openCast(); } }, 'Sign in with Farcaster'));
    return;
  }
  const status = el('p', { class: 'en-status', role: 'status' });
  const settle = (result) => {
    status.textContent = result.state === 'confirmed' ? `On the node: ${String(result.node ?? '').replace(/^https?:\/\//, '')}` : t('pending');
    status.className = `en-status ${result.state}`;
    if (ui.turn === turn) ui.svg.classList.add('sent');
  };

  const text = el('textarea', { rows: kind === 'quote' ? 3 : 5, placeholder: words.placeholder, 'aria-label': words.placeholder });
  const count = el('span', { class: 'en-count' }, '');
  const send = el('button', { type: 'submit', class: 'en-send' }, words.send, el('kbd', {}, navigator.platform?.startsWith('Mac') ? '⌘↵' : 'Ctrl ↵'));
  const size = () => new TextEncoder().encode(text.value.trim()).length;
  const fit = () => { text.style.height = 'auto'; text.style.height = `${Math.min(text.scrollHeight, innerHeight * 0.45)}px`; };
  text.addEventListener('input', () => { const n = size(); count.textContent = n > 280 ? `${n} / ${MAX_BYTES}` : ''; count.classList.toggle('over', n > MAX_BYTES); fit(); });
  const form = el('form', {
    class: 'en-form',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!size() && kind === 'reply') return;
      if (size() > MAX_BYTES) { status.textContent = `A cast holds ${MAX_BYTES} bytes.`; return; }
      send.disabled = true; text.disabled = true;
      status.textContent = t('signing'); status.className = 'en-status';
      try {
        const body = kind === 'reply' ? { text: text.value, parent: { fid: cast.fid, hash: cast.id } } : { text: text.value, quote: { fid: cast.fid, hash: cast.id } };
        const result = await castAs('/api/cast', body);
        settle(result);
        done?.(kind, result);
        if (ui.turn === turn) ui.timer = setTimeout(closeEnergy, 1800);
      } catch (err) {
        status.textContent = err.message; status.className = 'en-status failed';
        send.disabled = false; text.disabled = false; text.focus();
      }
    },
  }, kind === 'quote'
    // A quote: what you write on top, their cast inside it, one card, as it will be seen.
    ? el('div', { class: 'en-draft' }, text, target(cast, user, 'embed'))
    // A reply: below their cast, joined to it by the thread.
    : el('div', { class: 'en-answer' }, myFace(), text),
  el('div', { class: 'en-row' }, count, send));
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
    if (e.key === 'Escape') { e.preventDefault(); closeEnergy(); from?.closest('[tabindex]')?.focus(); }
  });
  ui.panel.replaceChildren(close, el('p', { class: 'en-kind' }, words.title, kind === 'reply' ? [' ', el('span', {}, nameOf(user, cast.fid))] : null),
    ...(kind === 'reply' ? [target(cast, user, 'parent')] : []), form, status,
    el('p', { class: 'en-as' }, `as ${state.me.visitor ? 'you' : `FID ${state.me.fid}`} · ${state.network === 'hypersnap' ? 'Hypersnap' : 'Snapchain'}`));
  requestAnimationFrame(() => text.focus());
}
