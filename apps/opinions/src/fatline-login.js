// Log in with Fatline, in this client: who you are on Farcaster, proven by one signature from your wallet (no seed
// phrase, no gas). This node checks it (POST /api/auth/verify). It only decides what you read here (your people);
// posting still needs this client's key. The same button any app can use: fatline.ink/login.js.
import '../../site/login.js';
import { api, el, store } from './lib.js';
import { ethProvider, noWalletReason, viewer } from './miniapp.js';

export const loggedIn = () => store.get('fatlineLogin', null); // { fid, username, address, how }
export const logOut = () => store.set('fatlineLogin', null);

/** The button. onDone(login) after a good login. */
export function loginButton(onDone) {
  const box = el('div', { class: 'fl-login-box' });
  (async () => {
    const provider = await ethProvider();
    const ctx = await viewer(); // inside Farcaster the app says who you are, so no name to type
    window.FatlineLogin.button(box, {
      node: location.origin, provider: provider ?? { request: async () => { throw new Error(noWalletReason()); } },
      fid: ctx?.fid,
      onLogin: async (who) => {
        let user = who.user;
        if (!user) user = await api('/api/user', { q: String(who.fid) }).catch(() => null);
        const saved = { fid: who.fid, username: user?.username ?? ctx?.username ?? null, address: who.address, how: who.how };
        store.set('fatlineLogin', saved);
        onDone?.(saved);
      },
    });
  })();
  return box;
}
