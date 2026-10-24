// Sign in with Farcaster: give this client its own key by approving it in the Farcaster app. A QR code (or a link)
// opens the app, which shows what you approve and adds the key itself (it pays). No recovery phrase, no other wallet.
//
//   1. this client makes a new Ed25519 key (it never leaves this machine)
//   2. Fatline's app account signs a request for it (the genesis server does: POST /signer-request)
//   3. Farcaster's API turns that into a link for the Farcaster app; you approve there
//   4. this client waits until it's done, then saves the key (.fatline/appkey.json, mode 600)
import { randomBytes } from 'node:crypto';
import { NobleEd25519Signer, MessageType } from '@farcaster/core';
import { SCOPES } from './identity.mjs';
import { saveAppKey } from './writer.mjs';

const APIS = ['https://api.farcaster.xyz', 'https://api.warpcast.com'];
const hex = (b) => `0x${Buffer.from(b).toString('hex')}`;

async function api(path, init) {
  let last;
  for (const base of APIS) {
    try {
      const res = await fetch(base + path, { ...init, signal: AbortSignal.timeout(15_000) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return body;
      last = new Error(body?.errors?.[0]?.message ?? `HTTP ${res.status} from ${base}`);
    } catch (err) { last = err; }
  }
  throw last;
}

/** Starts a sign-in. Returns { url (opens the Farcaster app), wait() → the saved key record }. */
export async function startSignIn(config, { signer } = {}) {
  signer ??= process.env.FATLINE_SIGNER_URL ?? config.deployments?.Fatliners?.genesis?.hatchery ?? 'http://46.225.208.199:8791';
  const privateKey = randomBytes(32);
  const publicKey = hex((await new NobleEd25519Signer(privateKey).getSignerKey())._unsafeUnwrap());
  const req = await fetch(`${signer.replace(/\/$/, '')}/signer-request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: publicKey }), signal: AbortSignal.timeout(15_000) })
    .then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`); return b; });
  const out = await api('/v2/signed-key-requests', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: publicKey, requestFid: req.requestFid, signature: req.signature, deadline: req.deadline }) });
  const { token, deeplinkUrl } = out.result?.signedKeyRequest ?? {};
  if (!token || !deeplinkUrl) throw new Error('Farcaster did not return a sign-in link.');
  return {
    url: deeplinkUrl,
    async wait({ timeoutMs = 10 * 60_000, onState = () => {} } = {}) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const s = (await api(`/v2/signed-key-request?token=${encodeURIComponent(token)}`).catch(() => null))?.result?.signedKeyRequest;
        if (s?.state) onState(s.state);
        if (s?.state === 'completed' && s.userFid) {
          const record = { fid: Number(s.userFid), publicKey, privateKey: hex(privateKey), scopes: SCOPES.map((x) => MessageType[x]),
            network: config.defaultNetwork, via: 'farcaster app', addedAt: new Date().toISOString(), state: 'active' };
          saveAppKey(config.dataDir, record);
          return record;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error('No approval in the Farcaster app within 10 minutes. Run it again when you are ready.');
    },
  };
}
