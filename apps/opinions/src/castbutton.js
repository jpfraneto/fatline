// The Cast button, bottom right, on every page. With an app key: write and cast. Without one, two ways to give this
// client its own key (it can cast, like and follow, never move your account; the key stays on this machine):
//   - the Farcaster app: a QR code to scan with your phone, or the same link to open on this device;
//   - a browser wallet that owns your account (its custody address): one signature, no transaction, no gas.
import { api, el, state, store } from './lib.js';
import { castComposer, loadMe } from './post.js';

const STEPS = {
  starting: 'Asking Farcaster for a sign-in link…',
  waiting: 'Scan this with your phone: it opens the Farcaster app. Approve there, and this client gets its own key.',
  connected: 'Connected. Looking for your Farcaster account…',
  finding: 'Asking your node which Farcaster account this wallet owns (up to a minute)…',
  signing: 'Approve the signature in your wallet. It gives this client a key that can cast, like and follow — never move your account. No transaction, no gas.',
  submitting: 'Approved. Adding your key to the network…',
};

// Errors from Farcaster's sign-in, in words a person can act on.
function friendly(text) {
  const t = String(text ?? '');
  if (/timeout|timed out|aborted/i.test(t)) return 'Farcaster took too long to answer. Try again (it usually works the second time), or sign with a browser wallet below.';
  if (/unavailable/i.test(t)) return 'Farcaster\'s sign-in service says it is unavailable right now. Wait a minute and try again, or sign with a browser wallet below.';
  return t;
}

async function loginCall(method, path = '/api/login', body) {
  const token = store.get('writeToken', '');
  const res = await fetch(new URL(path, location.origin), {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
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

  // Polls the login until it is done or fails; the message line says where it is.
  let run = 0; // only the newest login is followed
  const follow = async (s, { msg, qr, link, retry }) => {
    const mine = ++run;
    polling = true;
    while (polling && mine === run) {
      if (s.step === 'done') { await loadMe(); return showComposer(); }
      if (s.step === 'error') { msg.textContent = friendly(s.error); msg.classList.add('warn'); retry.hidden = false; return; }
      if (s.qr && !qr.firstChild) qr.innerHTML = s.qr; // our own server's SVG
      if (s.uri && link) { link.hidden = false; link.querySelector('a').href = s.uri; link.dataset.web = s.web ?? ''; }
      if (s.step !== 'waiting') { qr.replaceChildren(); if (link) link.hidden = true; }
      msg.textContent = STEPS[s.step] ?? s.step;
      await new Promise((r) => setTimeout(r, 1500));
      if (mine !== run) return;
      s = await loginCall('GET');
    }
  };

  const withWallet = async (ui) => {
    const { msg, qr, link, retry } = ui;
    run++;
    qr.replaceChildren(); link.hidden = true; retry.hidden = true; msg.classList.remove('warn');
    const eth = window.ethereum;
    if (!eth) { msg.textContent = 'No browser wallet here. Install one (MetaMask, Rabby, Coinbase Wallet…) with the account that owns your FID, or use the QR code.'; msg.classList.add('warn'); retry.hidden = false; return; }
    try {
      msg.textContent = 'Connect your wallet…';
      const [address] = await eth.request({ method: 'eth_requestAccounts' });
      msg.textContent = STEPS.finding;
      let s = await loginCall('POST', '/api/login/wallet', { address });
      if (s.typedData) {
        msg.textContent = `FID ${s.fid} (asked ${s.node}). Your wallet will ask to use Ethereum for these signatures (Farcaster's key format says so); nothing is sent onchain.`;
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }).catch(() => {});
      }
      // Two signatures: the key request, then the key itself. Each is shown in the wallet.
      while (s.step === 'signing' && s.typedData) {
        msg.textContent = `${STEPS.signing} (${s.n} of ${s.of})`;
        const signature = await eth.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(s.typedData)] })
          .catch(async (err) => { await loginCall('POST', '/api/login/wallet/sign', { signature: null }).catch(() => {}); throw err; });
        s = await loginCall('POST', '/api/login/wallet/sign', { signature });
      }
      return follow(s, ui);
    } catch (err) {
      msg.textContent = err?.code === 4001 ? 'You declined in the wallet. Nothing was added.' : (err.message ?? String(err));
      msg.classList.add('warn');
      retry.hidden = false;
    }
  };

  const showLogin = async () => {
    const qr = el('div', { class: 'castpanel-qr' });
    const msg = el('p', { class: 'muted' }, STEPS.starting);
    const copy = el('button', { type: 'button', class: 'link' }, 'Copy the link');
    const link = el('p', { class: 'small castpanel-link', hidden: true },
      el('a', { href: '#', target: '_blank', rel: 'noopener' }, 'Open the Farcaster app on this device'), ' · ', copy);
    copy.addEventListener('click', async () => { await navigator.clipboard?.writeText(link.dataset.web || link.querySelector('a').href).catch(() => {}); copy.textContent = 'Copied: paste it on your phone'; });
    const retry = el('button', { type: 'button', class: 'quiet', hidden: true, onclick: () => showLogin() }, 'Try again');
    const ui = { msg, qr, link, retry };
    const wallet = el('button', { type: 'button', class: 'quiet', onclick: () => withWallet(ui) }, 'Use a browser wallet instead');
    panel.replaceChildren(head('Sign in with Farcaster'),
      el('p', { class: 'small' }, 'This gives this client a key for your own account. It does not create a new account. The key can cast, like and follow, never move your account.'),
      qr, link, msg, retry,
      el('div', { class: 'castpanel-alt' }, wallet,
        el('p', { class: 'muted small' }, 'Only if a wallet in this browser owns your Farcaster account (its custody address). Two signatures, no transaction, no gas.')),
      el('details', { class: 'muted small' }, el('summary', {}, 'Other ways'),
        el('p', {}, 'In a terminal on the machine this client runs on: fatline identity (the same QR code). Last resort: fatline identity --phrase, with your recovery phrase typed into a hidden prompt there, used once and never saved. Never paste it into a chat.')));
    try {
      await follow(await loginCall('POST'), ui);
    } catch (err) {
      msg.textContent = friendly(err.message);
      msg.classList.add('warn');
      retry.hidden = false;
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
