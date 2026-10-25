// The Cast button, bottom right, on every page. With a key: write and cast. Without one: sign in, with the
// Farcaster app (a QR code on a computer, a button on a phone) or with the wallet that owns your account.
// Either way this client gets its own key for your account: it can cast, like and follow, never move the account.
import { el, state, store } from './lib.js';
import { castComposer, loadMe } from './post.js';

const STEPS = {
  starting: 'One moment…',
  waiting: '',
  connected: 'Connected…',
  finding: 'Finding your account…',
  signing: 'Sign in your wallet.',
  submitting: 'Adding your key…',
};
const phone = () => matchMedia('(pointer: coarse)').matches;

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

  const showComposer = () => {
    panel.replaceChildren(head(`Cast as FID ${state.me.fid}`), castComposer({ onDone: () => setTimeout(close, 1200) }));
    const box = panel.querySelector('textarea');
    // The vouch: what this Fatline is, and how anyone runs theirs. Theirs to edit or replace.
    if (box && !box.value) {
      box.value = `this is the fatline im running to secure the farcaster network\n\nrun yours here:\n\nhttps://fatline.ink/${state.me.fid}`;
      box.dispatchEvent(new Event('input'));
    }
    box?.focus();
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

  const withWallet = async (ui) => {
    run++;
    ui.qr.replaceChildren(); ui.app.hidden = true; ui.retry.hidden = true; ui.msg.classList.remove('warn');
    const eth = window.ethereum;
    if (!eth) {
      if (!phone()) return fail(ui, 'No wallet in this browser.');
      // On a phone: open this page inside the wallet's own browser.
      const here = `${location.host}${location.pathname}`;
      ui.msg.classList.remove('warn');
      ui.msg.replaceChildren('Open this page in your wallet: ',
        el('a', { href: `https://metamask.app.link/dapp/${here}` }, 'MetaMask'), ' · ',
        el('a', { href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(location.href)}` }, 'Coinbase Wallet'));
      return;
    }
    try {
      ui.msg.textContent = 'Connect your wallet…';
      const [address] = await eth.request({ method: 'eth_requestAccounts' });
      ui.msg.textContent = STEPS.finding;
      let s = await loginCall('POST', '/api/login/wallet', { address });
      if (s.typedData) await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }).catch(() => {});
      // Two signatures: the key request, then the key. No transaction, no gas.
      while (s.step === 'signing' && s.typedData) {
        ui.msg.textContent = `Sign in your wallet (${s.n} of ${s.of}). No transaction, no gas.`;
        const signature = await eth.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(s.typedData)] })
          .catch(async (err) => { await loginCall('POST', '/api/login/wallet/sign', { signature: null }).catch(() => {}); throw err; });
        s = await loginCall('POST', '/api/login/wallet/sign', { signature });
      }
      return follow(s, ui);
    } catch (err) {
      fail(ui, err?.code === 4001 ? 'You declined. Nothing was added.' : (err.message ?? String(err)));
    }
  };

  const showLogin = async () => {
    const qr = el('div', { class: 'castpanel-qr' });
    const msg = el('p', { class: 'muted small' }, STEPS.starting);
    const app = el('a', { class: 'ck-speak-btn', href: '#', hidden: true, target: phone() ? '_self' : '_blank', rel: 'noopener' }, phone() ? 'Open Farcaster' : 'Open Farcaster on this computer');
    if (!phone()) app.className = 'castpanel-link small';
    const retry = el('button', { type: 'button', class: 'quiet', hidden: true, onclick: () => showLogin() }, 'Try again');
    const ui = { msg, qr, app, retry };
    const wallet = el('button', { type: 'button', class: 'quiet', onclick: () => withWallet(ui) }, 'Use my wallet instead');
    panel.replaceChildren(head('Sign in'), qr, app, msg, retry, wallet);
    try {
      await follow(await loginCall('POST'), ui);
    } catch (err) {
      fail(ui, err.message);
    }
  };

  const open = async () => {
    panel.hidden = false;
    await loadMe();
    if (state.me?.fid && state.me?.canWrite) return showComposer();
    return showLogin();
  };

  return el('div', { class: 'castbutton-wrap' }, panel, el('button', { class: 'castbutton', type: 'button', onclick: () => (panel.hidden ? open() : close()), 'aria-label': 'Cast' }, 'Cast'));
}
