// Who is signed in on this client. One way in, on every Fatline: Sign in with Farcaster (the Farcaster app approves a
// key made in this browser, castbutton.js and visitor.js). Or this place's owner, whose browser holds the server's
// write token. Nothing else: no wallet path, never a phrase.
import { api, state, store } from './lib.js';
import { forgetKey } from './visitor.js';

/** { fid, owner } of whoever can cast here, or null. */
export const loggedIn = () => (state.me?.canWrite && state.me?.fid ? { fid: state.me.fid, owner: !state.me.visitor } : null);

/** Their name and picture, read from this node; kept a day in this browser so the bar draws at once. */
export async function profileOf(fid) {
  const kept = store.get(`profile:${fid}`, null);
  if (kept && Date.now() - kept.at < 24 * 3600_000) return kept;
  try {
    const u = await api('/api/user', { q: String(fid) });
    const p = { fid, username: u.username ?? null, displayName: u.displayName ?? null, pfp: u.pfp ?? null, at: Date.now() };
    store.set(`profile:${fid}`, p);
    return p;
  } catch {
    return kept ?? { fid };
  }
}

/**
 * Log out = delete the key from this browser. A visitor's key exists only here (the server only ever saw its
 * signatures), so this is the whole log out. The owner's write token goes too; Sign in with Farcaster brings them back.
 * The key stays approved on the account until it is removed in the Farcaster app: deleting it here only means this
 * browser can't use it any more.
 */
export function logOut() {
  forgetKey();
  try { localStorage.removeItem('writeToken'); } catch { /* private mode */ }
}
