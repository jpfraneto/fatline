// The energy thread. Act on a cast (reply, quote, like, recast) and a thread of light, in the color of the network
// you are on, runs from the button to the right side of the screen, where you write what you have to write.
// On a narrow screen there is no room to the right: the same panel rises from the bottom instead.
import { el, state, t } from './lib.js';
import { castAs, loadMe } from './post.js';
import { openCast } from './castbutton.js';

const MAX_BYTES = 1024;
const WORDS = {
  reply: { title: 'Reply to', send: 'Reply', placeholder: 'Your reply…' },
  quote: { title: 'Quote', send: 'Quote', placeholder: 'Say something about it (or nothing)…' },
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
  return { svg, glow, core, flow, spark, panel, from: null, raf: 0, timer: 0, kind: null };
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

const nameOf = (u, fid) => (u?.username ? `@${u.username}` : u?.displayName ?? `FID ${fid}`);

function target(cast, user) {
  return el('div', { class: 'en-target' },
    el('p', { class: 'en-who' }, user?.pfp ? el('img', { src: user.pfp, alt: '' }) : null, nameOf(user, cast.fid)),
    cast.text ? el('p', { class: 'en-said' }, cast.text) : null);
}

/**
 * Opens the thread for one action on one cast. kind: reply | quote | like | recast.
 * from: the element the thread starts at. done(kind, result): after the node has it.
 * For like and recast, undo: true takes it back.
 */
export async function energy(kind, { from, cast, user, undo = false, done } = {}) {
  spawn(from);
  ui.kind = kind;
  const words = WORDS[kind];
  const close = el('button', { type: 'button', class: 'en-close', 'aria-label': 'Close', title: 'Close (Esc)', onclick: closeEnergy }, '×');
  if (!state.me) await loadMe();
  if (!state.me?.fid || !state.me?.canWrite) {
    ui.panel.replaceChildren(close, el('p', { class: 'en-kind' }, words.title), target(cast, user),
      el('p', {}, 'Sign in to answer, quote, like and recast from here.'),
      el('button', { type: 'button', class: 'en-send', onclick: () => { closeEnergy(); openCast(); } }, 'Sign in with Farcaster'));
    return;
  }
  const status = el('p', { class: 'en-status', role: 'status' });
  const settle = (result) => {
    status.textContent = result.state === 'confirmed' ? `On the node: ${String(result.node ?? '').replace(/^https?:\/\//, '')}` : t('pending');
    status.className = `en-status ${result.state}`;
    ui.svg.classList.add('sent');
  };

  if (kind === 'like' || kind === 'recast') {
    ui.panel.replaceChildren(close, el('p', { class: 'en-kind' }, undo ? words.undo : words.title), target(cast, user), status);
    status.textContent = t('signing');
    try {
      const result = await castAs('/api/react', { kind, fid: cast.fid, hash: cast.id, remove: undo });
      settle(result);
      done?.(kind, result);
      ui.timer = setTimeout(closeEnergy, 2600);
    } catch (err) { status.textContent = err.message; status.className = 'en-status failed'; }
    return;
  }

  const text = el('textarea', { rows: 5, placeholder: words.placeholder, 'aria-label': words.placeholder });
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
        ui.timer = setTimeout(closeEnergy, 1800);
      } catch (err) {
        status.textContent = err.message; status.className = 'en-status failed';
        send.disabled = false; text.disabled = false; text.focus();
      }
    },
  }, text, el('div', { class: 'en-row' }, count, send));
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
    if (e.key === 'Escape') { e.preventDefault(); closeEnergy(); from?.closest('[tabindex]')?.focus(); }
  });
  ui.panel.replaceChildren(close, el('p', { class: 'en-kind' }, words.title, ' ', el('span', {}, nameOf(user, cast.fid))), target(cast, user), form, status,
    el('p', { class: 'en-as' }, `as ${state.me.visitor ? 'you' : `FID ${state.me.fid}`} · ${state.network === 'hypersnap' ? 'Hypersnap' : 'Snapchain'}`));
  requestAnimationFrame(() => text.focus());
}
