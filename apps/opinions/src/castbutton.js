// The Cast button, bottom right, on every page. With an app key: write and cast. Without one: log in with your
// wallet right here (a QR code to scan with the wallet that owns your Farcaster account, one signature), with no
// Farcaster app in between. The key it makes stays on the machine running this client.
import { api, el, state, store } from './lib.js';
import { castComposer, loadMe } from './post.js';

const STEPS = {
  starting: 'Opening a connection…',
  waiting: 'Scan this with your phone: it opens the Farcaster app. Approve there, and this client gets its own key.',
  connected: 'Connected. Looking for your Farcaster account…',
  signing: 'Approve the signature in your wallet. It gives this client a key that can cast, like and follow — never move your account.',
  submitting: 'Approved in the Farcaster app. It is adding your key onchain…',
};

async function loginCall(method) {
  const token = store.get('writeToken', '');
  const res = await fetch(new URL('/api/login', location.origin), {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: method === 'POST' ? '{}' : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out;
}

export function castButton() {
  const panel = el('div', { class: 'castpanel', hidden: true, role: 'dialog', 'aria-label': 'Cast' });
  let polling = false;
  const close = () => { panel.hidden = true; polling = false; };
  const head = (title) => el('div', { class: 'castpanel-head' }, el('strong', {}, title), el('button', { class: 'ghost', type: 'button', onclick: close, 'aria-label': 'Close' }, '×'));

  const showComposer = () => {
    panel.replaceChildren(head(`Cast as FID ${state.me.fid}`), castComposer({ onDone: () => setTimeout(close, 1200) }));
    const box = panel.querySelector('textarea');
    // The vouch: what this Fatline is, and the link that tells anyone how to run theirs. Theirs to edit or replace.
    if (box && !box.value) {
      box.value = `this is the fatline im running to secure the farcaster network\n\nrun yours here:\n\nhttps://fatline.ink/${state.me.fid}`;
      box.dispatchEvent(new Event('input'));
    }
    box?.focus();
  };

  const showLogin = async () => {
    const qr = el('div', { class: 'castpanel-qr' });
    const msg = el('p', { class: 'muted' }, STEPS.starting);
    panel.replaceChildren(head('Sign in with Farcaster'), qr, msg,
      el('p', { class: 'muted small' }, 'No recovery phrase, no other wallet: the Farcaster app shows what you approve and pays for it. The key can cast, like and follow, never move your account.'));
    try {
      let s = await loginCall('POST');
      polling = true;
      while (polling) {
        if (s.step === 'done') { await loadMe(); return showComposer(); }
        if (s.step === 'error') { msg.textContent = s.error; msg.classList.add('warn'); return; }
        if (s.qr && !qr.firstChild) qr.innerHTML = s.qr; // our own server's SVG
        if (s.step !== 'waiting') qr.replaceChildren();
        msg.textContent = STEPS[s.step] ?? s.step;
        await new Promise((r) => setTimeout(r, 1500));
        s = await loginCall('GET');
      }
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('warn');
    }
  };

  const open = async () => {
    panel.hidden = false;
    if (!state.me?.fid) await loadMe();
    if (state.me?.fid && state.me?.canWrite) return showComposer();
    if (state.me?.fid && !state.me?.canWrite) {
      panel.replaceChildren(head('Cast'), el('p', { class: 'muted' }, 'This client runs on a server: add its write token in Settings to cast from here.'));
      return;
    }
    return showLogin();
  };

  return el('div', { class: 'castbutton-wrap' }, panel, el('button', { class: 'castbutton', type: 'button', onclick: () => (panel.hidden ? open() : close()), 'aria-label': 'Cast' }, 'Cast'));
}
