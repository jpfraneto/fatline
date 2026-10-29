// The Cast button, bottom right, on every page. With a key: write and cast. Without one: sign in, with the
// Farcaster app (a QR code on a computer, a button on a phone) or with the wallet that owns your account (the way
// in for anyone the Farcaster app banned: the protocol has no account bans). Anyone can, on any Fatline: the key is
// made and kept in this browser (visitor.js); it can cast, like and follow, never move the account. Never a phrase.
import { el, state, store } from './lib.js';
import { castComposer, loadMe } from './post.js';
import { approved, call, newKey, signHash } from './visitor.js';

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

  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1. The usual way: the Farcaster app approves a key made in this browser. A QR on a computer, a button on a phone.
  const showLogin = async () => {
    const qr = el('div', { class: 'castpanel-qr' });
    const msg = el('p', { class: 'muted small' }, STEPS.starting);
    const app = el('a', { class: phone() ? 'ck-speak-btn' : 'castpanel-link small', href: '#', hidden: true, target: phone() ? '_self' : '_blank', rel: 'noopener' }, phone() ? 'Open Farcaster' : 'Farcaster on this computer? Open it');
    const retry = el('button', { type: 'button', class: 'quiet', hidden: true, onclick: () => showLogin() }, 'Try again');
    const ui = { msg, qr, app, retry };
    const noApp = el('button', { type: 'button', class: 'linkish small', onclick: () => showNoApp() }, 'No Farcaster app?');
    const owner = state.me?.fid ? null : el('button', { type: 'button', class: 'linkish small', onclick: () => showOwnerLogin() }, 'This is my Fatline: give it its key');
    panel.replaceChildren(head('Sign in with Farcaster'), qr, msg, app, retry, noApp, ...(owner ? [owner] : []));
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

  // 2. No Farcaster app (or banned from it): the wallet that holds the account approves. People rarely know which
  //    wallet that is, so the page finds it from their name first, then shows a QR for that wallet's app.
  const showNoApp = () => {
    run++; polling = false;
    const input = el('input', { type: 'text', placeholder: '@yourname or FID', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    const out = el('div', { class: 'castpanel-out' });
    const form = el('form', { class: 'castpanel-find', onsubmit: (e) => { e.preventDefault(); find(input.value); } }, input, el('button', { type: 'submit' }, 'Find'));
    panel.replaceChildren(head('Without the Farcaster app'),
      el('p', { class: 'small' }, 'Your account is held by a wallet. It approves this browser once. No transaction, no gas.'),
      form, out,
      el('button', { type: 'button', class: 'linkish small', onclick: () => showLogin() }, 'Back to the Farcaster app'));
    input.focus();

    const find = async (q) => {
      const mine = ++run;
      polling = true;
      const msg = el('p', { class: 'muted small' }, 'Looking…');
      const retry = el('button', { type: 'button', class: 'quiet', hidden: true, onclick: () => find(q) }, 'Try again');
      const ui = { msg, retry, qr: el('div'), app: el('a') };
      out.replaceChildren(msg, retry);
      try {
        const who = await call('/api/visitor/who', null, { q });
        const key = newKey();
        const s = await call('/api/visitor/wallet', { address: who.custody, signer: key.publicKey, fid: who.fid, link: `${location.origin}/?sign=` });
        if (mine !== run) return;
        const qr = el('div', { class: 'castpanel-qr' });
        qr.innerHTML = s.qr ?? ''; // our own server's SVG
        const here = window.ethereum
          ? el('button', { type: 'button', class: 'quiet', onclick: () => approveHere(s.session, who.custody, msg) }, 'Or approve with this browser\'s wallet')
          : null;
        out.replaceChildren(
          el('p', { class: 'small' }, el('b', {}, who.username ? `@${who.username}` : `FID ${who.fid}`), ' is held by the wallet ', el('code', {}, short(who.custody)), '.'),
          ...(phone() ? [el('a', { class: 'ck-speak-btn', href: s.link }, 'Open in that wallet\'s app')] : [qr, el('p', { class: 'small' }, 'Scan this with that wallet\'s app, then approve there.')]),
          ...(here ? [here] : []),
          msg,
          el('p', { class: 'muted small' }, 'Made your account in the Farcaster app? Then that wallet is inside the app: go back and scan the first code.'),
          retry);
        msg.textContent = '';
        // The wallet signs (on the phone, or here); then this browser's key signs its own KEY_ADD and it is done.
        while (polling && mine === run) {
          await wait(1500);
          if (!polling || mine !== run) return;
          const st = await call('/api/visitor/wallet', null, { session: s.session });
          if (st.step === 'signing') { msg.textContent = st.n > 1 ? `Signature ${st.n} of ${st.of}…` : ''; continue; }
          if (st.step === 'keysign') {
            qr.replaceChildren();
            msg.textContent = STEPS.submitting;
            const done = await call('/api/visitor/sign', { id: st.id, signature: signHash(st.hash) });
            return done.step === 'done' ? signedIn(done.fid) : fail(ui, done.error ?? 'Something went wrong. Nothing was added.');
          }
          if (st.step === 'done') return signedIn(st.fid);
          if (st.step === 'error') return fail(ui, st.error);
        }
      } catch (err) {
        if (mine === run) fail(ui, err.message);
      }
    };
  };

  // The wallet in this browser, if it is the one that holds the account. Only signs: the loop above finishes.
  const approveHere = async (session, custody, msg) => {
    const eth = window.ethereum;
    try {
      const [address] = await eth.request({ method: 'eth_requestAccounts' });
      if (address.toLowerCase() !== custody.toLowerCase()) { msg.textContent = `This browser's wallet is ${short(address)}, not ${short(custody)}. Use the QR with that wallet's app.`; return; }
      let s = await call('/api/visitor/wallet', null, { session });
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }).catch(() => {});
      while (s.step === 'signing' && s.typedData) {
        msg.textContent = `Sign in your wallet (${s.n} of ${s.of}). No transaction, no gas.`;
        const signature = await eth.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(s.typedData)] });
        s = await call('/api/visitor/wallet/sign', { session, signature });
      }
    } catch (err) {
      msg.textContent = err?.code === 4001 ? 'You declined. Nothing was added.' : (err.message ?? String(err));
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

  const signedIn = async (fid) => {
    approved(fid);
    await loadMe();
    return showComposer();
  };

  const open = async () => {
    panel.hidden = false;
    await loadMe();
    if (state.me?.fid && state.me?.canWrite) return showComposer();
    return showLogin();
  };

  return el('div', { class: 'castbutton-wrap' }, panel, el('button', { class: 'castbutton', type: 'button', onclick: () => (panel.hidden ? open() : close()), 'aria-label': 'Cast' }, 'Cast'));
}
