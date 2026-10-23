// Targeted history for ANY FID, from our own running nodes. Node only.
//
// Order: the local Fatline archive first. If a network's backfill for this FID isn't done, the existing
// indexer adapter (indexer/src/adapters/snapchain.mjs) copies it from that network's ONE pinned node,
// page by page, resumable (fl_backfill keeps the page token). The FID is NOT added to the tail list
// (fl_fids): a preview must not make the indexer follow an account forever.
//
// Pinned sources: per network, the first `own: true` node in fatline.config.json that is not localhost,
// unless --node-farcaster / --node-hypersnap say otherwise. No fallback to hosted nodes. If a network's
// node doesn't answer, the result says so and the history is single-network (explicitly labelled).
//
// The node URL stays here and in the archive's private fl_sources.node_url. It is never written to any
// output file: outputs carry the label only.

import { HISTORY_SCHEMA } from '../history.mjs';
import { readArchive } from './archive.mjs';

export const NETWORK_LABELS = { farcaster: 'Snapchain (Farcaster)', hypersnap: 'Hypersnap' };

const isLocal = (u) => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(u);

/** Our own pinned node per network, from the config. Explicit overrides win. */
export function pinnedSources(config, overrides = {}) {
  const out = {};
  for (const network of ['farcaster', 'hypersnap']) {
    const net = config.networks?.[network];
    if (overrides[network]) { out[network] = { network, nodeUrl: overrides[network], label: `${net?.label ?? network} (explicit node)` }; continue; }
    const node = (net?.nodes ?? []).find((n) => n.own && !isLocal(n.url));
    out[network] = node ? { network, nodeUrl: node.url.replace(/\/$/, ''), label: node.label } : null;
  }
  return out;
}

async function getJson(url, timeoutMs = 15_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Is the node up, and does it know this FID? Returns { status, registeredAt, info }. */
export async function probe(source, fid) {
  try {
    const info = await getJson(`${source.nodeUrl}/v1/info`);
    const ev = await getJson(`${source.nodeUrl}/v1/onChainEventsByFid?fid=${fid}&event_type=EVENT_TYPE_ID_REGISTER`);
    const reg = (ev.events ?? []).map((e) => Number(e.blockTimestamp) * 1000).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null;
    const shards = (info.shardInfos ?? []).map((s) => ({ shard: s.shardId, maxHeight: Number(s.maxHeight), blockDelay: Number(s.blockDelay ?? NaN) }));
    return { status: reg == null ? 'account-not-found' : 'ok', registeredAt: reg, shards };
  } catch (err) {
    return { status: 'unavailable', error: String(err.message ?? err).slice(0, 160) };
  }
}

/**
 * Backfill (if needed) and read one FID. Returns { history, sources, coverage, state }.
 * state: 'ok' | 'account-not-found' | 'unavailable' | 'known-no-messages' | 'untracked'
 *   untracked: offline mode and the archive never backfilled this FID.
 */
export async function historyFromNodes(fid, { config, dbPath, snapshotAt = Date.now(), offline = false, overrides = {}, networks = ['farcaster', 'hypersnap'], log = () => {} }) {
  const { Archive } = await import('../../../indexer/src/archive.mjs');
  const { openDb } = await import('../../../indexer/src/db.mjs');
  const { SnapchainAdapter, BACKFILL_KINDS } = await import('../../../indexer/src/adapters/snapchain.mjs');
  const pinned = pinnedSources(config, overrides);
  const db = openDb(config.dataDir);
  const archive = new Archive(db);
  const coverage = { snapshotAt, networks: {} };
  const regs = [];
  try {
    // Both networks in parallel (bounded: one adapter each, one page at a time).
    await Promise.all(networks.map(async (network) => {
      const src = pinned[network];
      const cov = coverage.networks[network] = { label: src?.label ?? null, read: false };
      if (!src) { cov.status = 'no-pinned-node'; return; }
      const adapter = new SnapchainAdapter({ archive, network, nodeUrl: src.nodeUrl, label: src.label, log, timeoutMs: 60_000 });
      const sourceId = await adapter.start();
      const done = () => archive.backfillState(sourceId, fid).filter((k) => k.state === 'done');
      if (offline) {
        // Only a complete backfill counts: a half-copied history would read as inactivity.
        const n = done().length, all = Object.keys(BACKFILL_KINDS).length;
        cov.status = n === all ? 'archive-only' : n ? 'partial-backfill' : 'untracked';
        cov.read = n === all;
      } else {
        const p = await probe(src, fid);
        cov.status = p.status;
        // Node down, but the archive already holds a finished backfill for this FID: use it, labelled.
        if (p.status === 'unavailable' && done().length === Object.keys(BACKFILL_KINDS).length) {
          cov.status = 'archive-only';
          cov.read = true;
          cov.nodeError = p.error;
        }
        cov.shards = p.shards;
        if (p.error) cov.error = p.error;
        if (p.registeredAt != null) regs.push(p.registeredAt);
        if (p.status === 'ok') {
          // Resumable: each retry continues from the saved page token. Bounded: 3 tries, then this
          // network is reported unavailable and the result is explicitly single-network.
          const t0 = Date.now();
          let added = 0;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try { added += await adapter.backfillFid(fid); cov.read = true; break; } catch (err) {
              cov.error = String(err.message ?? err).slice(0, 160);
              log(`${src.label}: backfill of FID ${fid} failed (try ${attempt}/3): ${cov.error}`);
            }
          }
          if (!cov.read) cov.status = 'unavailable';
          else delete cov.error;
          cov.backfilledNow = added;
          cov.backfillMs = Date.now() - t0;
        }
      }
      const states = archive.backfillState(sourceId, fid);
      cov.backfill = Object.fromEntries(states.map((k) => [k.kind, { state: k.state, doneAt: k.doneAt }]));
      // Watermark: the newest backfill completion. A backfill reads what the node holds at that moment.
      cov.watermark = Math.max(0, ...states.map((k) => k.doneAt ?? 0)) || null;
    }));
  } finally {
    db.close();
  }

  // The registration time comes from a node. Remember it beside the archive, so an --offline run builds
  // the same history (and so the same commitment, seed and name) as the online run that read it.
  const { readFileSync, writeFileSync, existsSync } = process.getBuiltinModule('node:fs');
  const regFile = `${config.dataDir}/fatliners-registrations.json`;
  const known = existsSync(regFile) ? JSON.parse(readFileSync(regFile, 'utf8')) : {};
  if (regs.length) {
    known[fid] = { idRegisterAt: Math.min(...regs), readAt: Date.now() };
    writeFileSync(regFile, JSON.stringify(known, null, 1) + '\n');
  } else if (known[fid]) {
    regs.push(known[fid].idRegisterAt);
    coverage.registrationFrom = 'cache (read earlier from our node)';
  }

  const { history, sources } = await readArchive(dbPath, fid, { snapshotAt });
  // Keep only networks we actually read for this snapshot (one pinned source each).
  const readNets = new Set(Object.entries(coverage.networks).filter(([, c]) => c.read).map(([n]) => n));
  history.messages = history.messages.filter((m) => m.networks.some((n) => readNets.has(n)))
    .map((m) => ({ ...m, networks: m.networks.filter((n) => readNets.has(n)) }));
  // Age: onchain ID_REGISTER on OP mainnet. FIDs from before the 2023 migration show the migration date,
  // so take the earlier of that and the oldest message we hold. Either way it may be a lower bound.
  const oldest = history.messages.reduce((m, x) => Math.min(m, x.ts), Infinity);
  const onchain = regs.length ? Math.min(...regs) : null;
  history.registeredAt = onchain == null ? null : Math.min(onchain, Number.isFinite(oldest) ? oldest : onchain);
  coverage.registration = { onchainIdRegister: onchain, used: history.registeredAt, note: 'ID_REGISTER on OP mainnet; FIDs older than the Nov 2023 migration show the migration date, so age is a lower bound' };
  for (const [n, c] of Object.entries(coverage.networks)) {
    const ms = history.messages.filter((m) => m.networks.includes(n));
    c.messages = ms.length;
    c.oldest = ms.length ? Math.min(...ms.map((m) => m.ts)) : null;
    c.newest = ms.length ? Math.max(...ms.map((m) => m.ts)) : null;
  }

  const stats = Object.values(coverage.networks).map((c) => c.status);
  let state = 'ok';
  if (!readNets.size) state = stats.includes('account-not-found') ? 'account-not-found' : stats.includes('untracked') ? 'untracked' : 'unavailable';
  else if (!history.messages.length) state = 'known-no-messages';
  return { history: { ...history, schema: HISTORY_SCHEMA }, sources: sources.map((s) => ({ network: s.network, label: s.label })), coverage, state };
}
