// Your key on this Fatline: made and kept in this browser, never sent anywhere. Once your account approves it (the
// Farcaster app, or the wallet that owns your account), it signs what you cast here. The server builds each message,
// this signs its hash, the server sends it to its node (indexer/src/visitor.mjs). It can cast, like and follow;
// it can never move your account. No recovery phrase, ever.
import { ed25519 } from '@noble/curves/ed25519';
import { store } from './lib.js';

const KEY = 'visitorKey';
const toHex = (b) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h) => Uint8Array.from(String(h).slice(2).match(/../g) ?? [], (x) => parseInt(x, 16));

/** The approved key ({ fid, publicKey, privateKey }), or null. */
export function visitorKey() {
  const k = store.get(KEY, null);
  return k?.fid && k?.privateKey ? k : null;
}

/** The key being approved: the one already here, or a new one. */
export function newKey() {
  const k = store.get(KEY, null);
  if (k?.privateKey) return k;
  const privateKey = ed25519.utils.randomPrivateKey();
  const made = { fid: null, publicKey: toHex(ed25519.getPublicKey(privateKey)), privateKey: toHex(privateKey) };
  store.set(KEY, made);
  return made;
}

export function approved(fid) { store.set(KEY, { ...newKey(), fid: Number(fid) }); }

export function forgetKey() { try { localStorage.removeItem(KEY); } catch { /* private mode */ } }

export function signHash(hash) { return toHex(ed25519.sign(fromHex(hash), fromHex(newKey().privateKey))); }

export async function call(path, body, query) {
  const url = new URL(path, location.origin);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out;
}

/** A cast, reply, like, recast, delete or follow, as you: the server builds it, this browser signs it. */
export async function visitorSend(path, body) {
  const k = visitorKey();
  if (!k) throw new Error('Sign in first.');
  let out = await call('/api/visitor/act', { ...body, path, fid: k.fid, signer: k.publicKey });
  if (out.step === 'keysign') out = await call('/api/visitor/sign', { id: out.id, signature: signHash(out.hash) });
  return out;
}
