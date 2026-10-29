// The phone half of signing in without the Farcaster app. The computer shows a QR of this page (?sign=<session>);
// the app of the wallet that holds the account opens it and signs twice. The computer's browser then finishes with
// its own key. This page sends only those two signatures. No transaction, no gas, never a recovery phrase.
import { $, el } from './lib.js';
import { call } from './visitor.js';

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export async function signPage(session) {
  const main = $('#main');
  const say = (...kids) => main.replaceChildren(el('section', { class: 'signpage' }, ...kids));
  let s;
  try { s = await call('/api/visitor/wallet', null, { session }); } catch {
    return say(el('h1', {}, 'This code has expired.'), el('p', { class: 'muted' }, 'Start again on your computer.'));
  }
  if (s.step !== 'signing') return say(el('h1', {}, 'Nothing left to sign.'), el('p', { class: 'muted' }, 'Go back to your computer.'));

  const head = [
    el('h1', {}, 'Approve a Fatline key'),
    el('p', {}, `For FID ${s.fid}, held by this wallet (${short(s.address)}). Two signatures. No transaction, no gas.`),
    el('p', { class: 'muted small' }, 'The key lives in your computer\'s browser. It can cast, like and follow. It can never move your account.'),
  ];
  const eth = window.ethereum;
  if (!eth) {
    // Opened with the camera, in a plain browser: this page has to open inside the wallet's own app.
    const href = location.href;
    return say(...head,
      el('p', { class: 'warn' }, 'Open this page inside the app of that wallet:'),
      el('p', {}, el('a', { href: `https://metamask.app.link/dapp/${href.replace(/^https?:\/\//, '')}` }, 'MetaMask'), ' · ',
        el('a', { href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(href)}` }, 'Coinbase Wallet')),
      el('p', { class: 'muted small' }, 'Another wallet: open its browser and paste this page\'s address.'));
  }
  const msg = el('p', { class: 'muted' });
  const button = el('button', { type: 'button', onclick: async () => {
    button.disabled = true;
    try {
      const [address] = await eth.request({ method: 'eth_requestAccounts' });
      if (address.toLowerCase() !== s.address) {
        msg.textContent = `This wallet is ${short(address)}. The account is held by ${short(s.address)}: open this page in that one.`;
        button.disabled = false;
        return;
      }
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }).catch(() => {});
      while (s.step === 'signing' && s.typedData) {
        msg.textContent = `Signature ${s.n} of ${s.of}…`;
        const signature = await eth.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(s.typedData)] });
        s = await call('/api/visitor/wallet/sign', { session, signature });
      }
      if (s.step === 'error') { msg.textContent = s.error; button.disabled = false; return; }
      say(el('h1', {}, 'Approved.'), el('p', {}, 'Go back to your computer: it finishes there.'));
    } catch (err) {
      msg.textContent = err?.code === 4001 ? 'You declined. Nothing was added.' : (err.message ?? String(err));
      button.disabled = false;
    }
  } }, 'Approve with this wallet');
  say(...head, button, msg);
}
