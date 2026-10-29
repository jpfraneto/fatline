// The pen, at the right end of the bar, on every page. With a key: write and cast. Without one: Sign in with Farcaster,
// the only way in on any Fatline: the Farcaster app approves a key made in this browser (a QR code on a computer, a
// button on a phone). Anyone with a Farcaster account can, on any Fatline (visitor.js); the key can cast, like and
// follow, never move the account. Never a wallet path, never a phrase.
import { el, state, store } from './lib.js';
import { castComposer, loadMe } from './post.js';
import { approved, call, newKey } from './visitor.js';
import { ARCH, PEN, glyph } from './glyphs.js';

const STEPS = {
  starting: 'One moment…',
  waiting: '',
  connected: 'Connected…',
  finding: 'Finding your account…',
  signing: 'Sign in your wallet.',
  submitting: 'Adding your key…',
};
const phone = () => matchMedia('(pointer: coarse)').matches;

/**
 * What a new cast starts with. Someone who keeps a Fatline (this place's owner, or an egg or Fatliner in the world):
 * the vouch, what it is and how anyone runs theirs. Someone who doesn't yet: asking @fatline how (a real mention).
 */
async function openingLine(me) {
  const vouch = `this is the fatline im running to secure the farcaster network\n\nrun yours here:\n\nhttps://fatline.ink/${me.fid}`;
  const ask = 'hey @fatline help me understand how to set one up';
  if (!me.visitor) return vouch;
  try {
    const w = await fetch('https://fatline.ink/world', { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
    const keeps = (w.tokens ?? []).some((t) => (t.fid === me.fid || t.linkedFid === me.fid) && (t.stage === 'egg' || t.stage === 'fatliner'));
    return keeps ? vouch : ask;
  } catch {
    return ask;
  }
}

let session = null; // the sign-in this browser started
async function loginCall(method, path = '/api/login', body) {
  const token = store.get('writeToken', '');
  const url = new URL(path, location.origin);
  if (method === 'GET' && session) url.searchParams.set('session', session);
  const res = await fetch(url, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: method === 'POST' ? JSON.stringify({ ...(body ?? {}), session }) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  if (out.session) session = out.session;
  if (out.token) store.set('writeToken', out.token); // this server's owner signed in: this browser may cast
  return out;
}

export function castButton() {
  const panel = el('div', { class: 'castpanel', hidden: true, role: 'dialog', 'aria-label': 'Cast' });
  let polling = false;
  const close = () => { panel.hidden = true; polling = false; };
  const head = (title) => el('div', { class: 'castpanel-head' }, el('strong', {}, title), el('button', { class: 'ghost', type: 'button', onclick: close, 'aria-label': 'Close' }, '×'));

  const showComposer = async () => {
    panel.replaceChildren(head(`Cast as FID ${state.me.fid}`), castComposer({ onDone: () => setTimeout(close, 1200) }));
    const box = panel.querySelector('textarea');
    box?.focus();
    const opening = await openingLine(state.me);
    // Theirs to edit or replace: only filled while they have not started writing.
    if (box && !box.value && opening) {
      box.value = opening;
      box.dispatchEvent(new Event('input'));
      box.setSelectionRange(box.value.length, box.value.length);
    }
  };

  // Polls the sign-in until it is done or fails.
  let run = 0; // only the newest sign-in is followed
  const follow = async (s, ui) => {
    const mine = ++run;
    polling = true;
    while (polling && mine === run) {
      if (s.step === 'done') { await loadMe(); return state.me?.canWrite ? showComposer() : fail(ui, 'Signed in, but this browser still cannot cast. Try again.'); }
      if (s.step === 'error') return fail(ui, s.error);
      const waiting = s.step === 'waiting';
      if (waiting && s.qr && !phone() && !ui.qr.firstChild) ui.qr.innerHTML = s.qr; // our own server's SVG
      if (waiting && s.uri) { ui.app.href = phone() ? s.uri : s.web || s.uri; ui.app.hidden = false; }
      if (!waiting) { ui.qr.replaceChildren(); ui.app.hidden = true; }
      ui.msg.textContent = waiting ? (phone() ? '' : 'Scan with your phone.') : (STEPS[s.step] ?? s.step);
      await new Promise((r) => setTimeout(r, 1500));
      if (mine !== run) return;
      s = await loginCall('GET');
    }
  };
  const fail = (ui, text) => { ui.msg.textContent = text; ui.msg.classList.add('warn'); ui.retry.hidden = false; };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1. The usual way: the Farcaster app approves a key made in this browser. A QR on a computer, a button on a phone.
  const showLogin = async () => {
    const qr = el('div', { class: 'castpanel-qr' });
    const msg = el('p', { class: 'muted small' }, STEPS.starting);
    const app = el('a', { class: phone() ? 'ck-speak-btn' : 'castpanel-link small', href: '#', hidden: true, target: phone() ? '_self' : '_blank', rel: 'noopener' }, phone() ? 'Open Farcaster' : 'Farcaster on this computer? Open it');
    const retry = el('button', { type: 'button', class: 'quiet', hidden: true, onclick: () => showLogin() }, 'Try again');
    const ui = { msg, qr, app, retry };
    const owner = state.me?.fid ? null : el('button', { type: 'button', class: 'linkish small', onclick: () => showOwnerLogin() }, 'This is my Fatline: give it its key');
    panel.replaceChildren(head('Sign in with Farcaster'), el('p', { class: 'castpanel-why' }, glyph(ARCH, 'fc-badge'), 'Anyone with a Farcaster account. Approve in the Farcaster app: no password, no phrase.'), qr, msg, app, retry, ...(owner ? [owner] : []));
    const mine = ++run;
    polling = true;
    try {
      const key = newKey();
      const r = await call('/api/visitor/qr', { signer: key.publicKey });
      if (mine !== run) return;
      if (!phone()) qr.innerHTML = r.qr; // our own server's SVG
      app.href = phone() ? r.uri : r.web || r.uri;
      app.hidden = false;
      msg.textContent = phone() ? 'The Farcaster app asks you to approve. Then come back here.' : 'Scan with your phone\'s camera. The Farcaster app asks you to approve.';
      while (polling && mine === run) {
        await wait(2000);
        if (!polling || mine !== run) return;
        const s = await call('/api/visitor/qr', null, { token: r.token, signer: key.publicKey });
        if (s.step === 'done') return signedIn(s.fid);
        if (s.step === 'submitting') { qr.replaceChildren(); app.hidden = true; msg.textContent = STEPS.submitting; }
      }
    } catch (err) {
      if (mine === run) fail(ui, err.message);
    }
  };

  // A server with no key of its own yet: its owner gives it one (kept on the server: it lays the egg). Only that account.
  const showOwnerLogin = async () => {
    const qr = el('div', { class: 'castpanel-qr' });
    const msg = el('p', { class: 'muted small' }, STEPS.starting);
    const app = el('a', { class: 'castpanel-link small', href: '#', hidden: true, target: phone() ? '_self' : '_blank', rel: 'noopener' }, phone() ? 'Open Farcaster' : 'Open Farcaster on this computer');
    const retry = el('button', { type: 'button', class: 'quiet', hidden: true, onclick: () => showOwnerLogin() }, 'Try again');
    const ui = { msg, qr, app, retry };
    panel.replaceChildren(head('Your Fatline'), qr, app, msg, retry);
    try { await follow(await loginCall('POST'), ui); } catch (err) { fail(ui, err.message); }
  };

  let onlySignIn = false; // opened from the face in the bar: once signed in, close and show the page as you
  const signedIn = async (fid) => {
    approved(fid);
    await loadMe();
    window.dispatchEvent(new Event('fatline:me'));
    if (onlySignIn) return close();
    return showComposer();
  };

  const open = async ({ signIn = false } = {}) => {
    onlySignIn = signIn;
    panel.hidden = false;
    await loadMe();
    if (state.me?.fid && state.me?.canWrite) return signIn ? close() : showComposer();
    return showLogin();
  };
  opener = open;

  return el('div', { class: 'castbutton-wrap' }, panel, el('button', { class: 'castbutton', type: 'button', onclick: () => (panel.hidden ? open() : close()), 'aria-label': 'Write a cast' }, glyph(PEN, 'pen')));
}

let opener = null;
/** Open the panel from elsewhere (the face in the bar, the You page): sign in, then close. */
export function openCast() { return opener?.({ signIn: true }); }
