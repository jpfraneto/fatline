// The Farline network adapter: reads one node and hands normalized events to the archive.
//
// One adapter = one network + one node. It never falls back to another node: if its node is down,
// it says so and waits. Farcaster (Snapchain) and Hypersnap speak the same /v1 HTTP API, so the same
// code runs twice, as two independent processes with their own cursors.
//
// What it does, per tracked FID (archive.fids()):
//   1. Backfill: everything the node holds now for that FID (casts, reactions, links, user data,
//      verifications), page by page, resumable.
//   2. Tail: /v1/events for shards 1 and 2 from the saved cursor, keeping only the tracked FIDs.
//      If the node no longer has the events after our cursor (it keeps ~3 days), that is a gap:
//      every FID is backfilled again.
//
// The archive interface (indexer/src/archive.mjs, see research/FARLINE-ARCHIVE.md):
//   source({network, nodeUrl, label}) -> sourceId
//   cursor(sourceId, shard) -> eventId | null
//   ingest(sourceId, events, {shard, cursor})
//   fids() -> [fid]
//   backfill(sourceId, fid, kind, {state, pageToken})
//   backfillState(sourceId, fid, kind) -> {state, pageToken} | null
//   markGap(sourceId)   every backfill of this source goes back to running
import { normalizeCast, toMs } from '../hub.mjs';

export const SHARDS = [1, 2];
const SEQ_BITS = 16384; // event id = blockNumber * 16384 + position in the block
export const blockOf = (eventId) => Math.floor(eventId / SEQ_BITS);

export const BACKFILL_KINDS = {
  casts: { path: '/v1/castsByFid' },
  reactions: { path: '/v1/reactionsByFid', params: { reaction_type: 'None' } }, // None = likes and recasts
  links: { path: '/v1/linksByFid' },
  user_data: { path: '/v1/userDataByFid' },
  verifications: { path: '/v1/verificationsByFid' },
};

/** Lowercase 0x-hex. The HTTP API mostly sends hex, but some fields (castRemoveBody.targetHash) are base64. */
export function toHex(value) {
  if (value == null || value === '') return null;
  if (/^0x[0-9a-fA-F]*$/.test(value)) return value.toLowerCase();
  return '0x' + Buffer.from(value, 'base64').toString('hex');
}

/** A small, stable body per message type. Casts use the same shape as the rest of the app (hub.mjs). */
export function messageBody(message, network) {
  const d = message.data ?? {};
  if (d.castAddBody) return normalizeCast(message, network);
  if (d.castRemoveBody) return { kind: 'cast_remove', target: toHex(d.castRemoveBody.targetHash) };
  if (d.reactionBody) {
    const r = d.reactionBody;
    return {
      kind: d.type === 'MESSAGE_TYPE_REACTION_REMOVE' ? 'reaction_remove' : 'reaction',
      reaction: r.type === 'REACTION_TYPE_RECAST' ? 'recast' : 'like',
      target: r.targetCastId ? { fid: r.targetCastId.fid, hash: toHex(r.targetCastId.hash) } : { url: r.targetUrl ?? null },
    };
  }
  if (d.linkBody) {
    return { kind: d.type === 'MESSAGE_TYPE_LINK_REMOVE' ? 'link_remove' : 'link', link: d.linkBody.type, targetFid: d.linkBody.targetFid ?? null };
  }
  if (d.userDataBody) return { kind: 'user_data', field: d.userDataBody.type, value: d.userDataBody.value };
  if (d.verificationAddAddressBody) {
    const v = d.verificationAddAddressBody;
    return { kind: 'verification', protocol: v.protocol, address: v.address };
  }
  if (d.verificationRemoveBody) return { kind: 'verification_remove', protocol: d.verificationRemoveBody.protocol, address: d.verificationRemoveBody.address };
  // Anything else (LEND_STORAGE, FRAME_ACTION, …): keep the type's own body, untouched.
  const key = Object.keys(d).find((k) => k.endsWith('Body'));
  return { kind: 'other', type: d.type ?? null, [key ?? 'body']: key ? d[key] : null };
}

function fromMessage(network, message, extra) {
  const d = message.data ?? {};
  return {
    network,
    dedupKey: toHex(message.hash),
    fid: Number(d.fid),
    msgType: d.type ?? null,
    protocolTs: d.timestamp != null ? toMs(d.timestamp) : null,
    signer: toHex(message.signer),
    body: messageBody(message, network),
    displaced: [],
    target: null,
    ...extra,
  };
}

/**
 * One node event -> one normalized event, or null for events the archive doesn't keep
 * (BLOCK_CONFIRMED, CHANNEL_OWNER_CHANGE_HINT, unknown types).
 */
export function normalizeEvent(network, ev) {
  const base = { shard: ev.shardIndex ?? null, eventId: Number(ev.id), raw: ev };
  switch (ev.type) {
    case 'HUB_EVENT_TYPE_MERGE_MESSAGE': {
      const b = ev.mergeMessageBody;
      const out = fromMessage(network, b.message, { ...base, eventType: 'MERGE_MESSAGE', status: 'merged' });
      // The node lists every message this one replaced (a remove kills its add, a newer profile field
      // replaces the older one). Those become 'displaced'. No guessing needed.
      // The full messages are sent, so the archive keeps their content too.
      out.displaced = (b.deletedMessages ?? []).filter((m) => m?.hash).map((m) => {
        const x = fromMessage(network, m, {});
        return { hash: x.dedupKey, fid: x.fid, msgType: x.msgType, protocolTs: x.protocolTs, signer: x.signer, body: x.body };
      });
      // A cast remove for a cast this node never had: keep its target so the archive can match it later.
      if (b.message.data?.castRemoveBody && out.displaced.length === 0) out.target = toHex(b.message.data.castRemoveBody.targetHash);
      return out;
    }
    case 'HUB_EVENT_TYPE_PRUNE_MESSAGE':
      return fromMessage(network, ev.pruneMessageBody.message, { ...base, eventType: 'PRUNE_MESSAGE', status: 'pruned' });
    case 'HUB_EVENT_TYPE_REVOKE_MESSAGE':
      return fromMessage(network, ev.revokeMessageBody.message, { ...base, eventType: 'REVOKE_MESSAGE', status: 'revoked' });
    case 'HUB_EVENT_TYPE_MERGE_FAILURE': {
      const b = ev.mergeFailureBody ?? {};
      if (!b.message) return null;
      return fromMessage(network, b.message, { ...base, eventType: 'MERGE_FAILURE', status: 'failed', body: { ...messageBody(b.message, network), failure: { code: b.code ?? null, reason: b.reason ?? null } } });
    }
    case 'HUB_EVENT_TYPE_MERGE_ON_CHAIN_EVENT': {
      const e = ev.mergeOnChainEventBody.onChainEvent;
      return {
        ...base, network, eventType: 'MERGE_ON_CHAIN_EVENT', status: 'merged',
        dedupKey: `${e.chainId}|${toHex(e.transactionHash)}|${e.logIndex}`,
        fid: Number(e.fid), msgType: e.type, protocolTs: e.blockTimestamp ? e.blockTimestamp * 1000 : null,
        signer: null, displaced: [], target: null,
        body: { kind: 'onchain', type: e.type, chainId: e.chainId, blockNumber: e.blockNumber, tx: toHex(e.transactionHash), logIndex: e.logIndex },
      };
    }
    case 'HUB_EVENT_TYPE_MERGE_USERNAME_PROOF': {
      const p = ev.mergeUsernameProofBody?.usernameProof;
      if (!p) return null;
      const name = String(p.name ?? ''); // plain text in the HTTP API (e.g. "jessepollak22")
      return {
        ...base, network, eventType: 'MERGE_USERNAME_PROOF', status: 'merged',
        dedupKey: `${name}|${p.fid}|${p.timestamp}`, fid: Number(p.fid), msgType: 'USERNAME_PROOF',
        protocolTs: p.timestamp ? p.timestamp * 1000 : null, signer: null, displaced: [], target: null,
        body: { kind: 'username_proof', name, type: p.type ?? null, owner: toHex(p.owner) },
      };
    }
    default:
      return null;
  }
}

export class SnapchainAdapter {
  /**
   * @param {object} o
   * @param {object} o.archive     the archive module (or a fake in tests)
   * @param {string} o.network     'farcaster' | 'hypersnap'
   * @param {string} o.nodeUrl     the ONE node this adapter reads, e.g. http://46.225.208.199:3381
   * @param {string} [o.label]
   */
  constructor({ archive, network, nodeUrl, label, fetchImpl = fetch, pageSize = 1000, timeoutMs = 20_000, log = console.log }) {
    if (!archive || !network || !nodeUrl) throw new Error('adapter needs archive, network and nodeUrl');
    Object.assign(this, { archive, network, nodeUrl: nodeUrl.replace(/\/$/, ''), label: label ?? `${network} node`, fetch: fetchImpl, pageSize, timeoutMs, log });
    this.sourceId = null;
  }

  async get(path, params = {}) {
    const url = new URL(this.nodeUrl + path);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
    let res;
    try {
      res = await this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw Object.assign(new Error(`${this.label} (${this.nodeUrl}) is not answering: ${err.message}`), { offline: true });
    }
    if (!res.ok) throw new Error(`${this.label}: ${path} -> HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async start() {
    this.sourceId ??= await this.archive.source({ network: this.network, nodeUrl: this.nodeUrl, label: this.label });
    return this.sourceId;
  }

  /** Copies everything the node holds now for one FID. Resumes from the saved page token. Returns messages ingested. */
  async backfillFid(fid) {
    await this.start();
    let total = 0;
    for (const [kind, { path, params }] of Object.entries(BACKFILL_KINDS)) {
      const saved = await this.archive.backfillState(this.sourceId, fid, kind);
      if (saved?.state === 'done') continue;
      let pageToken = saved?.pageToken ?? null;
      await this.archive.backfill(this.sourceId, fid, kind, { state: 'running', pageToken });
      try {
        for (;;) {
          const page = await this.get(path, { fid, ...params, page_size: this.pageSize, pageToken: pageToken ?? undefined });
          const events = (page.messages ?? []).map((m) => fromMessage(this.network, m, {
            shard: null, eventId: null, eventType: 'BACKFILL', status: 'merged', raw: m,
          }));
          if (events.length) await this.archive.ingest(this.sourceId, events, { shard: null, cursor: null });
          total += events.length;
          pageToken = page.nextPageToken || null;
          await this.archive.backfill(this.sourceId, fid, kind, { state: pageToken ? 'running' : 'done', pageToken });
          if (!pageToken) break;
        }
      } catch (err) {
        await this.archive.backfill(this.sourceId, fid, kind, { state: 'failed', pageToken });
        throw err;
      }
    }
    return total;
  }

  /** Where the node's head is now, per shard, as an event id. */
  async headEventId(shard) {
    const info = await this.get('/v1/info');
    const s = (info.shardInfos ?? []).find((x) => x.shardId === shard);
    if (!s) throw new Error(`${this.label} has no shard ${shard}`);
    return Number(s.maxHeight) * SEQ_BITS;
  }

  /**
   * Reads one page of one shard's events after the cursor. Returns {ingested, seen, caughtUp, gap}.
   * With no saved cursor it starts at the node's head (history comes from the backfill instead).
   */
  async tailOnce(shard, fids) {
    await this.start();
    let cursor = await this.archive.cursor(this.sourceId, shard);
    if (cursor == null) {
      cursor = (await this.headEventId(shard)) - 1;
      await this.archive.ingest(this.sourceId, [], { shard, cursor });
      return { ingested: 0, seen: 0, caughtUp: true, gap: false, started: true };
    }
    const page = await this.get('/v1/events', { from_event_id: cursor + 1, shard_index: shard, page_size: this.pageSize });
    const events = page.events ?? [];
    if (!events.length) return { ingested: 0, seen: 0, caughtUp: true, gap: false };

    // Every block has a BLOCK_CONFIRMED event, so the stream is contiguous by block. If the first block we get
    // is past the one after our cursor, the node has already dropped events we never saw.
    const gap = blockOf(events[0].id) > blockOf(cursor) + 1;
    if (gap) {
      this.log(`${this.label}: shard ${shard} skipped from block ${blockOf(cursor)} to ${blockOf(events[0].id)}. Backfilling every FID again.`);
      await this.archive.markGap(this.sourceId);
    }
    const wanted = new Set(fids.map(Number));
    const keep = events.map((ev) => normalizeEvent(this.network, ev)).filter((e) => e && wanted.has(e.fid));
    const last = Number(events.at(-1).id);
    try {
      await this.archive.ingest(this.sourceId, keep, { shard, cursor: last });
    } catch (err) {
      if (err.status !== 400) throw err;
      // One event the archive refuses must not stall the stream forever: keep the good ones, log the bad one.
      for (const e of keep) {
        try { await this.archive.ingest(this.sourceId, [e], { shard, cursor: null }); } catch (one) {
          if (one.status !== 400) throw one;
          this.log(`${this.label}: skipped event ${e.eventId} (${e.eventType}): ${one.message}`);
        }
      }
      await this.archive.ingest(this.sourceId, [], { shard, cursor: last });
    }
    return { ingested: keep.length, seen: events.length, caughtUp: events.length < this.pageSize, gap };
  }

  /** One full round: backfill whatever isn't done, then read every shard until caught up. */
  async round() {
    const fids = (await this.archive.fids()).map(Number);
    let backfilled = 0;
    for (const fid of fids) backfilled += await this.backfillFid(fid);
    let ingested = 0;
    for (const shard of SHARDS) {
      for (let i = 0; i < 1000; i++) {
        const r = await this.tailOnce(shard, fids);
        ingested += r.ingested;
        if (r.gap) for (const fid of fids) backfilled += await this.backfillFid(fid);
        if (r.caughtUp) break;
      }
    }
    return { fids: fids.length, backfilled, ingested };
  }

  /** Runs forever. A node that stops answering is reported, never replaced by another node. */
  async run({ intervalMs = 2000, signal } = {}) {
    let wasOffline = false;
    while (!signal?.aborted) {
      try {
        const r = await this.round();
        if (wasOffline) this.log(`${this.label} is answering again.`);
        wasOffline = false;
        if (r.backfilled || r.ingested) this.log(`${this.label}: +${r.backfilled} backfilled, +${r.ingested} new events for ${r.fids} FID(s).`);
      } catch (err) {
        if (!wasOffline || !err.offline) this.log(err.message);
        wasOffline = Boolean(err.offline);
      }
      await new Promise((r) => setTimeout(r, wasOffline ? Math.max(intervalMs, 15_000) : intervalMs));
    }
  }
}
