// Posting: casts, replies, likes, recasts and follows, signed by this client's own app key.
//
// The app key is an Ed25519 key registered for the person's FID (see infra/identity.mjs). Every
// message is signed here, submitted to the node the person chose, then read back from that same
// node until it is there. Reads and writes go to one node, so there is no hidden fallback.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CastType, FarcasterNetwork, Message, NobleEd25519Signer, ReactionType,
  makeCastAdd, makeCastRemove, makeLinkAdd, makeLinkRemove, makeReactionAdd, makeReactionRemove,
} from '@farcaster/core';

export const CAST_MAX_BYTES = 320;
export const LONG_CAST_MAX_BYTES = 1024; // a LONG_CAST: 321 to 1024 bytes

/** Links in a cast become embeds (what Farcaster apps turn into preview cards): https only, at most 2, each ≤256 bytes. */
export function linkEmbeds(text) {
  const urls = (String(text).match(/https:\/\/[^\s<>"]+/g) ?? []).map((u) => u.replace(/[.,;:!?)\]]+$/, ''));
  return [...new Set(urls)].filter((u) => Buffer.byteLength(u) <= 256).slice(0, 2).map((url) => ({ url }));
}
/**
 * @names in a cast become mentions, as Farcaster stores them: the @name leaves the text, its FID and the byte position
 * where it stood are kept (apps put the name back when they show it). lookup(name) -> FID, or null: a name nobody
 * holds stays plain text. At most 10, as the protocol allows.
 */
export async function withMentions(text, lookup) {
  const re = /(^|[^\w@/.])@([a-z0-9][a-z0-9-]{0,15}(?:\.eth)?)(?![\w-]|\.\w)/gi;
  let out = '';
  let last = 0;
  const mentions = [];
  const mentionsPositions = [];
  for (const m of String(text).matchAll(re)) {
    const at = m.index + m[1].length;
    const name = m[2].toLowerCase();
    const fid = mentions.length < 10 ? await lookup(name).catch(() => null) : null;
    out += text.slice(last, at);
    if (fid) { mentions.push(Number(fid)); mentionsPositions.push(Buffer.byteLength(out)); } else out += `@${m[2]}`;
    last = at + 1 + m[2].length;
  }
  return { text: out + text.slice(last), mentions, mentionsPositions };
}

const hex = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;
const bytes = (h) => Buffer.from(String(h).replace(/^0x/, ''), 'hex');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const unwrap = (result, what) => {
  if (result.isErr()) throw fail(`${what}: ${result.error.message}`);
  return result.value;
};

/** The app key file: { fid, privateKey, publicKey, scopes, network, addedAt }. Mode 600, never committed. */
export const appKeyPath = (dataDir) => join(dataDir, 'appkey.json');

export function loadAppKey(dataDir) {
  const file = appKeyPath(dataDir);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function saveAppKey(dataDir, key) {
  const file = appKeyPath(dataDir);
  writeFileSync(file, JSON.stringify(key, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** POSTs a signed message to a node. `path` is /v1/submitMessage or /v1/validateMessage. */
export async function sendMessage(node, message, path = '/v1/submitMessage', fetchImpl = fetch) {
  const res = await fetchImpl(`${node.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: Buffer.from(Message.encode(message).finish()),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    const reason = body.error_detail ?? body.details ?? body.message ?? body.errCode ?? text;
    throw fail(`${node.url} refused the message (HTTP ${res.status}): ${reason}`, res.status === 401 ? 401 : 422);
  }
  return body;
}

export class Writer {
  /**
   * @param network  a Network from hub.mjs (the reader's chosen network and node)
   * @param key      the app key record
   */
  constructor({ network, key, fetchImpl = fetch, confirmMs = 20_000, pollMs = 1_000, confirmVia = null, fallback = null }) {
    this.network = network;
    // While your node catches up: confirm on a node in sync (yours can't show it yet), and if yours refuses the
    // message, send it through that node instead.
    this.confirmVia = confirmVia;
    this.fallback = fallback;
    this.key = key;
    this.fid = Number(key.fid);
    // The key file's own key, or any signer (a visitor's browser signs each message's hash: visitor.mjs).
    this.signer = key.signer ?? new NobleEd25519Signer(bytes(key.privateKey));
    this.fetch = fetchImpl;
    this.confirmMs = confirmMs;
    this.pollMs = pollMs;
  }

  get options() {
    return { fid: this.fid, network: FarcasterNetwork.MAINNET };
  }

  // Each action builds a message, and says how to read it back (or, for removals, how to see it gone).

  async cast({ text, parent } = {}) {
    text = String(text ?? '').trim();
    if (!text) throw fail('Write something first.');
    const size = Buffer.byteLength(text);
    if (size > LONG_CAST_MAX_BYTES) throw fail(`A cast holds ${LONG_CAST_MAX_BYTES} bytes; this is ${size}. Longer opinions go in Voices.`);
    const type = size > CAST_MAX_BYTES ? CastType.LONG_CAST : CastType.CAST;
    // @names the node knows become real mentions (the person is notified), not just text.
    const named = await withMentions(text, async (name) => (await this.network.get('/v1/userNameProofByName', { name }))?.data?.fid ?? null);
    const body = { ...named, embeds: linkEmbeds(text), embedsDeprecated: [], type };
    if (parent) body.parentCastId = { fid: Number(parent.fid), hash: bytes(parent.hash) };
    const message = unwrap(await makeCastAdd(body, this.options, this.signer), 'Could not build the cast');
    return this.#publish('cast', message, (hash) => ['/v1/castById', { fid: this.fid, hash }], true);
  }

  async deleteCast({ hash }) {
    const message = unwrap(await makeCastRemove({ targetHash: bytes(hash) }, this.options, this.signer), 'Could not build the delete');
    return this.#publish('delete', message, () => ['/v1/castById', { fid: this.fid, hash }], false);
  }

  async react({ kind = 'like', fid, hash, remove = false }) {
    const type = kind === 'recast' ? ReactionType.RECAST : ReactionType.LIKE;
    const body = { type, targetCastId: { fid: Number(fid), hash: bytes(hash) } };
    const make = remove ? makeReactionRemove : makeReactionAdd;
    const message = unwrap(await make(body, this.options, this.signer), `Could not build the ${kind}`);
    const read = () => ['/v1/reactionById', { fid: this.fid, reaction_type: kind === 'recast' ? 'Recast' : 'Like', target_fid: fid, target_hash: hash }];
    return this.#publish(remove ? `un${kind}` : kind, message, read, !remove);
  }

  async follow({ fid, remove = false }) {
    const body = { type: 'follow', targetFid: Number(fid) };
    const make = remove ? makeLinkRemove : makeLinkAdd;
    const message = unwrap(await make(body, this.options, this.signer), 'Could not build the follow');
    const read = () => ['/v1/linkById', { fid: this.fid, target_fid: fid, link_type: 'follow' }];
    return this.#publish(remove ? 'unfollow' : 'follow', message, read, !remove);
  }

  /** Submits once, then reads back until the node shows it (or stops showing it, for removals). */
  async #publish(action, message, readBack, shouldExist) {
    const hash = hex(message.hash);
    let node = await this.network.node();
    let refused = null;
    try {
      await sendMessage(node, message, '/v1/submitMessage', this.fetch);
    } catch (err) {
      if (!this.fallback) throw err;
      refused = String(err.message ?? err).slice(0, 200);
      node = await this.fallback.node();
      await sendMessage(node, message, '/v1/submitMessage', this.fetch);
    }
    const reader = this.confirmVia ? await this.confirmVia.node() : node;
    const extra = { ...(refused ? { refused } : {}), ...(reader.url !== node.url ? { confirmedOn: reader.url } : {}) };
    const [path, params] = readBack(hash);
    const deadline = Date.now() + this.confirmMs;
    while (Date.now() < deadline) {
      const found = await this.#exists(reader, path, params, shouldExist ? hash : null);
      if (found === shouldExist) return { action, hash, state: 'confirmed', node: node.url, ...extra };
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
    // Accepted by the node but not yet in a block. The same signed message can be resent safely.
    return { action, hash, state: 'pending', node: node.url, ...extra, message: Buffer.from(Message.encode(message).finish()).toString('base64') };
  }

  async #exists(node, path, params, hash) {
    const url = new URL(node.url + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await this.fetch(url, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (!res) return null;
    if (res.status === 404) return false;
    const body = await res.json().catch(() => null);
    // Snapchain says "not found" with HTTP 400 and NotFound in the error detail, not 404.
    if (res.status === 400 && /NotFound/.test(body?.error_detail ?? '')) return false;
    if (!res.ok) return null;
    if (!body?.data) return false;
    return hash ? body.hash === hash : true;
  }

  /** Re-sends a pending message exactly as it was signed. Signing again would make a second, different message. */
  async resend(base64) {
    const message = Message.decode(Buffer.from(base64, 'base64'));
    const node = await this.network.node();
    await sendMessage(node, message, '/v1/submitMessage', this.fetch);
    return { hash: hex(message.hash), state: 'submitted', node: node.url };
  }
}
