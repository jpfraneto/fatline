// Anyone can sign in on any Fatline and cast. Their key lives in their own browser; this server never sees it.
//
//   The key gets approved one of two ways, both free:
//     - the Farcaster app: a QR code (or link) for the browser's public key; the app adds the key (qrStart/qrStatus)
//     - the wallet that owns the account (its custody address): two EIP-712 signatures and the key's own signature
//       over its KEY_ADD, sent to this server's node. No app involved: the way in for people the Farcaster app
//       banned. Snapchain itself has no account bans (only channel bans), so their account still works.
//   Then every cast, reply, like, recast, delete or follow: this server builds the message with the same Writer it
//   uses for its owner, stops at the hash, the browser signs that hash, and the server sends it to its node and
//   reads it back (act → sign).
// Never a recovery phrase: there is no way to give one here.
import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { ok } from 'neverthrow';
import { SignatureScheme } from '@farcaster/core';
import { buildKeyAdd, custodyOfFid, fidOfCustody, waitForKey } from './identity.mjs';
import { keyRequestState, requestKey } from './siwf.mjs';
import { typedDataJson } from './login.mjs';
import { sendMessage } from './writer.mjs';
import { qrSvg } from './qr.mjs';

const HEX32 = /^0x[0-9a-f]{64}$/i;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const bytes = (h) => Uint8Array.from(Buffer.from(String(h).replace(/^0x/, ''), 'hex'));
const hex = (b) => `0x${Buffer.from(b).toString('hex')}`;

/** A signer whose private key is in someone's browser: it hands out each hash and waits for the signature. */
export class BrowserSigner {
  constructor(publicKey) {
    if (!HEX32.test(String(publicKey ?? ''))) throw fail('signer: the browser key\'s public key, 0x and 64 hex characters.');
    this.scheme = SignatureScheme.ED25519;
    this.publicKey = bytes(publicKey);
    this.asked = new Promise((r) => { this.ask = r; });
  }

  async getSignerKey() { return ok(this.publicKey); }

  async signMessageHash(hash) {
    const signature = new Promise((resolve, reject) => { this.give = resolve; this.refuse = reject; });
    this.hash = Uint8Array.from(hash);
    this.ask(this.hash);
    return ok(await signature);
  }

  /** The browser's signature, checked before anything is sent: a wrong one never reaches the node. */
  accept(signature) {
    const sig = bytes(signature);
    if (sig.length !== 64 || !this.hash || !ed25519.verify(sig, this.hash, this.publicKey)) throw fail('That signature is not this key\'s signature of this message.');
    this.give(sig);
  }
}

/**
 * writer(network, node, key): server.mjs's own (the same node choice and fallbacks as for the owner).
 * nodeFor(): this server's node, for keys. config: for the Farcaster app's key request.
 * resolveUser(q): @name or FID → { fid, username, … } from this server's node.
 */
export function makeVisitor({ config, writer, nodeFor, resolveUser = null, ttlMs = 5 * 60_000, max = 500, deps = {} }) {
  const d = { requestKey, keyRequestState, fidOfCustody, custodyOfFid, buildKeyAdd, waitForKey, sendMessage, ...deps };
  const pending = new Map(); // id -> { signer, done, at }
  const wallets = new Map(); // wallet sign-ins: session -> { state, wait, next, done }

  const sweep = () => {
    for (const [id, p] of pending) if (Date.now() - p.at > ttlMs) { p.signer?.refuse?.(fail('Too slow: sign again.')); pending.delete(id); }
    for (const [id, w] of wallets) if (Date.now() - w.at > 3 * ttlMs) { w.wait?.reject(fail('Too slow: start again.')); wallets.delete(id); }
    if (pending.size >= max) throw fail('Too many people are signing at once here. Try again in a minute.', 503);
  };

  /** Runs task(signer) until it needs the browser's signature: { id, hash }, or its result if it needed none. */
  async function begin(signer, task, extra = {}) {
    sweep();
    const done = task();
    done.catch(() => {}); // read by sign(); a failure before signing is thrown below
    const first = await Promise.race([signer.asked.then((hash) => ({ hash })), done.then((result) => ({ result }))]);
    if (first.result) return first.result;
    const id = randomBytes(16).toString('hex');
    pending.set(id, { signer, done, at: Date.now() });
    return { ...extra, step: 'keysign', id, hash: hex(first.hash) };
  }

  const ACTIONS = {
    '/api/cast': (w, b) => w.cast({ text: b.text, parent: b.parent }),
    '/api/cast/delete': (w, b) => w.deleteCast({ hash: b.hash }),
    '/api/react': (w, b) => w.react({ kind: b.kind, fid: b.fid, hash: b.hash, remove: Boolean(b.remove) }),
    '/api/follow': (w, b) => w.follow({ fid: b.fid, remove: Boolean(b.remove) }),
  };

  /** A cast (or reply, like, recast, delete, follow) by a visitor: build it, up to the hash their browser signs. */
  async function act(body = {}) {
    const run = ACTIONS[body.path];
    if (!run) throw fail('Not something a visitor can do here.');
    const fid = Number(body.fid);
    if (!Number.isInteger(fid) || fid < 1) throw fail('fid: your Farcaster ID.');
    const signer = new BrowserSigner(body.signer);
    const { w, via, chosen, other, behind } = await writer(body.network, body.node, { fid, signer });
    return begin(signer, async () => {
      const out = await run(w, body);
      if (via) return { ...out, via };
      if (!chosen || !other) return out;
      if (out.refused) return { ...out, via: { node: other.url, own: other.own, label: other.label, because: `${behind} and refused it (${out.refused}), so it went through ${other.label ?? other.url}` } };
      return { ...out, syncing: { node: chosen.url, confirmedOn: other.url, because: `${behind}: it took your message and passed it on; ${other.label ?? other.url} confirms it until yours catches up` } };
    });
  }

  /** The browser's signature for what act() or the wallet asked: sends it, and answers what happened. */
  async function sign({ id, signature } = {}) {
    const p = pending.get(String(id ?? ''));
    if (!p) throw fail('Nothing is waiting for that signature (it may have expired). Try again.', 409);
    pending.delete(id);
    try { p.signer.accept(signature); } catch (err) { p.signer.refuse(err); throw err; } // nothing is sent; sign again from the start
    return p.done;
  }

  // ---- The Farcaster app

  async function qrStart({ signer } = {}) {
    if (!HEX32.test(String(signer ?? ''))) throw fail('signer: the browser key\'s public key.');
    const { token, url } = await d.requestKey(config, signer.toLowerCase());
    const t = /[?&]token=([^&]+)/.exec(url)?.[1] ?? token;
    return { token, uri: url, web: `https://client.warpcast.com/deeplinks/signed-key-request?token=${t}`, qr: qrSvg(url) };
  }

  async function qrStatus({ token, signer } = {}) {
    if (!/^[\w-]{6,200}$/.test(String(token ?? ''))) throw fail('token: from qrStart.');
    const s = await d.keyRequestState(token);
    if (s.state !== 'completed' || !s.fid) return { step: s.state === 'approved' ? 'submitting' : 'waiting' };
    // Approved in the app and onchain: done once this server's node shows the key.
    if (HEX32.test(String(signer ?? '')) && !(await d.waitForKey(await nodeFor(), s.fid, signer, 4_000))) return { step: 'submitting', fid: s.fid };
    return { step: 'done', fid: s.fid };
  }

  // ---- The wallet that owns the account

  /** Which wallet holds this account (@name or FID): people rarely know, so the page says it before asking. */
  async function who({ q } = {}) {
    if (!resolveUser) throw fail('Not available here.', 503);
    const query = String(q ?? '').trim();
    if (!/^@?[a-z0-9][a-z0-9.-]{0,40}$/i.test(query)) throw fail('Your Farcaster name (like @alice) or FID.');
    const user = await resolveUser(query);
    const custody = await d.custodyOfFid(await nodeFor(), user.fid);
    if (!custody) throw fail(`This node does not know who holds FID ${user.fid} yet.`, 404);
    return { fid: user.fid, username: user.username ?? null, displayName: user.displayName ?? null, pfp: user.pfp ?? null, custody };
  }

  async function walletStart({ address, signer, fid: hint, link } = {}) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(address ?? ''))) throw fail('That is not a wallet address.');
    const appSigner = new BrowserSigner(signer);
    const node = await nodeFor();
    const fid = await d.fidOfCustody(node, address, hint);
    if (!fid) throw fail('This wallet does not own a Farcaster account. Use the wallet that owns it, or the Farcaster app.');
    sweep();
    const session = randomBytes(16).toString('hex');
    const w = { at: Date.now(), state: { step: 'signing' } };
    wallets.set(session, w);
    let changed;
    const nextChange = () => new Promise((r) => { changed = r; });
    let first = nextChange();
    let asked = 0;
    const custody = {
      address,
      signTypedData: (args) => new Promise((resolve, reject) => {
        w.wait = { resolve, reject };
        w.state = { step: 'signing', fid, address: address.toLowerCase(), n: ++asked, of: 2, typedData: typedDataJson(args) };
        changed?.();
      }),
    };
    appSigner.asked.then((hash) => {
      const id = randomBytes(16).toString('hex');
      pending.set(id, { signer: appSigner, done: w.done, at: Date.now() });
      w.state = { step: 'keysign', fid, id, hash: hex(hash) };
      changed?.();
    });
    w.done = d.buildKeyAdd({ node, fid, custody, networkName: config.defaultNetwork, appSigner }).then(async ({ message, record }) => {
      w.state = { step: 'submitting', fid };
      await d.sendMessage(node, message);
      if (!(await d.waitForKey(node, fid, record.publicKey))) throw fail(`${node.label ?? node.url} took the key but does not show it yet. Try casting in a minute.`, 504);
      w.state = { step: 'done', fid };
      return w.state;
    });
    w.done.catch((err) => { w.state = { step: 'error', error: String(err.message ?? err).slice(0, 300) }; }).finally(() => changed?.());
    w.next = () => (first = nextChange());
    await first;
    // The phone half: a QR of this place's own page with ?sign=<session>, for the holder wallet's app to open.
    const phoneLink = /^https?:\/\/[a-z0-9.:[\]-]{1,253}\/\?sign=$/i.test(String(link ?? '')) ? `${link}${session}` : null;
    return { session, ...w.state, ...(phoneLink ? { link: phoneLink, qr: qrSvg(phoneLink) } : {}) };
  }

  /** The wallet's signature (n of 2). Answers the next thing to sign: the second one, or the key's own (keysign). */
  async function walletSign({ session, signature } = {}) {
    const w = wallets.get(String(session ?? ''));
    if (!w?.wait) throw fail('No wallet signature was asked for. Start again.', 409);
    const wait = w.wait;
    w.wait = null;
    if (!/^0x[0-9a-fA-F]{130}$/.test(String(signature ?? ''))) { wait.reject(fail('The wallet did not sign. Nothing was added.')); throw fail('The wallet did not return a signature.'); }
    const next = w.next();
    wait.resolve(signature);
    await Promise.race([next, new Promise((r) => setTimeout(r, 10_000))]);
    return w.state;
  }

  /** Where a wallet sign-in stands (after keysign: submitting, then done). */
  function walletStatus({ session } = {}) {
    const w = wallets.get(String(session ?? ''));
    if (!w) throw fail('No such sign-in. Start again.', 404);
    if (w.state.step === 'done' || w.state.step === 'error') wallets.delete(session);
    return w.state;
  }

  return { act, sign, qrStart, qrStatus, who, walletStart, walletSign, walletStatus, pending };
}
