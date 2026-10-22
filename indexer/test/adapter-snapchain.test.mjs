// The Snapchain/Hypersnap adapter, against real events captured from crackle (Farcaster mainnet,
// 2026-10-22) and the real archive module on an in-memory database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Archive } from '../src/archive.mjs';
import { openDb } from '../src/db.mjs';
import { SnapchainAdapter, blockOf, normalizeEvent, toHex } from '../src/adapters/snapchain.mjs';

const EVENTS = JSON.parse(readFileSync(new URL('./fixtures/snapchain-events.json', import.meta.url)));
const byType = (t, mt) => EVENTS.find((e) => e.type === t && (!mt || e.mergeMessageBody?.message.data.type === mt));
const fidOf = (ev) => (ev.mergeMessageBody ?? ev.pruneMessageBody)?.message.data.fid;

const freshArchive = () => new Archive(openDb('/tmp', ':memory:'));

/** A fake node: answers /v1/info, /v1/events and the *ByFid endpoints from fixed data, and records calls. */
function fakeNode({ events = [], byFid = {}, head = { 1: 0, 2: 0 }, down = false } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url.pathname + url.search);
    if (down) throw new Error('connect ECONNREFUSED');
    const p = url.searchParams;
    const json = (x) => ({ ok: true, status: 200, json: async () => x, text: async () => JSON.stringify(x) });
    if (url.pathname === '/v1/info') return json({ shardInfos: Object.entries(head).map(([s, h]) => ({ shardId: Number(s), maxHeight: h })) });
    if (url.pathname === '/v1/events') {
      const from = Number(p.get('from_event_id'));
      const shard = Number(p.get('shard_index'));
      const size = Number(p.get('page_size'));
      return json({ events: events.filter((e) => e.shardIndex === shard && e.id >= from).sort((a, b) => a.id - b.id).slice(0, size) });
    }
    const pages = byFid[url.pathname]?.[p.get('fid')] ?? [[]];
    const i = Number(p.get('pageToken') ?? 0);
    return json({ messages: pages[i] ?? [], nextPageToken: i + 1 < pages.length ? String(i + 1) : '' });
  };
  return { fetchImpl, calls };
}

test('hashes come out as lowercase hex, including the base64 ones', () => {
  assert.equal(toHex('0xABCDEF'), '0xabcdef');
  const remove = byType('HUB_EVENT_TYPE_MERGE_MESSAGE', 'MESSAGE_TYPE_CAST_REMOVE');
  const raw = remove.mergeMessageBody.message.data.castRemoveBody.targetHash;
  assert.ok(!raw.startsWith('0x'), 'the fixture really is base64');
  assert.match(toHex(raw), /^0x[0-9a-f]{40}$/);
});

test('every real event type normalizes; block markers are skipped', () => {
  assert.equal(normalizeEvent('farcaster', byType('HUB_EVENT_TYPE_BLOCK_CONFIRMED')), null);
  const cast = normalizeEvent('farcaster', byType('HUB_EVENT_TYPE_MERGE_MESSAGE', 'MESSAGE_TYPE_CAST_ADD'));
  assert.equal(cast.eventType, 'MERGE_MESSAGE');
  assert.equal(cast.status, 'merged');
  assert.match(cast.dedupKey, /^0x[0-9a-f]{40}$/);
  assert.match(cast.signer, /^0x[0-9a-f]{64}$/);
  assert.equal(cast.body.kind, 'cast');
  assert.ok(cast.body.parent.hash);
  assert.ok(cast.protocolTs > Date.UTC(2026, 0, 1), 'Farcaster seconds were converted to unix ms');

  const unlike = normalizeEvent('farcaster', byType('HUB_EVENT_TYPE_MERGE_MESSAGE', 'MESSAGE_TYPE_REACTION_REMOVE'));
  assert.equal(unlike.displaced.length, 1, 'the removed like comes from deletedMessages');
  assert.equal(unlike.displaced[0].msgType, 'MESSAGE_TYPE_REACTION_ADD');

  const castRemove = normalizeEvent('farcaster', byType('HUB_EVENT_TYPE_MERGE_MESSAGE', 'MESSAGE_TYPE_CAST_REMOVE'));
  assert.equal(castRemove.displaced.length, 0);
  assert.match(castRemove.target, /^0x[0-9a-f]{40}$/, 'a remove for a cast this node never had keeps its target');

  const prune = normalizeEvent('farcaster', byType('HUB_EVENT_TYPE_PRUNE_MESSAGE'));
  assert.equal(prune.status, 'pruned');
  assert.ok(prune.body, 'a prune carries the whole message, so the archive keeps it');

  const onchain = normalizeEvent('farcaster', byType('HUB_EVENT_TYPE_MERGE_ON_CHAIN_EVENT'));
  assert.match(onchain.dedupKey, /^\d+\|0x[0-9a-f]{64}\|\d+$/);

  const proof = normalizeEvent('farcaster', byType('HUB_EVENT_TYPE_MERGE_USERNAME_PROOF'));
  assert.equal(proof.body.name, 'jessepollak22', 'username proof names are plain text');

  const lend = normalizeEvent('farcaster', byType('HUB_EVENT_TYPE_MERGE_MESSAGE', 'MESSAGE_TYPE_LEND_STORAGE'));
  assert.equal(lend.body.kind, 'other');
  assert.ok(lend.body.lendStorageBody);
});

test('every real event is accepted by the real archive', () => {
  const archive = freshArchive();
  const sourceId = archive.source({ network: 'farcaster', nodeUrl: 'http://node', label: 'test' });
  for (const ev of EVENTS) {
    const e = normalizeEvent('farcaster', ev);
    if (e) archive.ingest(sourceId, [e], { shard: e.shard, cursor: e.eventId });
  }
});

test('backfill pages through every kind, resumes, and never runs twice', async () => {
  const archive = freshArchive();
  const cast = byType('HUB_EVENT_TYPE_MERGE_MESSAGE', 'MESSAGE_TYPE_CAST_ADD').mergeMessageBody.message;
  const fid = String(cast.data.fid);
  const node = fakeNode({ byFid: { '/v1/castsByFid': { [fid]: [[cast], [{ ...cast, hash: '0x' + '1'.repeat(40) }]] } } });
  const adapter = new SnapchainAdapter({ archive, network: 'farcaster', nodeUrl: 'http://node', fetchImpl: node.fetchImpl, log: () => {} });
  assert.equal(await adapter.backfillFid(Number(fid)), 2);
  assert.ok(node.calls.some((c) => c.includes('reactionsByFid') && c.includes('reaction_type=None')), 'likes and recasts both');
  assert.equal(archive.backfillState(adapter.sourceId, Number(fid), 'casts').state, 'done');
  const before = node.calls.length;
  assert.equal(await adapter.backfillFid(Number(fid)), 0);
  assert.equal(node.calls.length, before, 'a finished backfill is not fetched again');
});

test('tail starts at the head, keeps only tracked FIDs, and moves the cursor', async () => {
  const archive = freshArchive();
  const mine = byType('HUB_EVENT_TYPE_MERGE_MESSAGE', 'MESSAGE_TYPE_CAST_ADD');
  const other = byType('HUB_EVENT_TYPE_PRUNE_MESSAGE');
  const shard = mine.shardIndex;
  const block = blockOf(mine.id);
  // A contiguous stream: a block marker for the head block, then our two events in the next block.
  const events = [
    { ...mine, id: (block + 1) * 16384 + 1, shardIndex: shard },
    { ...other, id: (block + 1) * 16384 + 2, shardIndex: shard },
  ];
  const node = fakeNode({ events, head: { [shard]: block + 1, [3 - shard]: 1 } });
  const adapter = new SnapchainAdapter({ archive, network: 'farcaster', nodeUrl: 'http://node', fetchImpl: node.fetchImpl, log: () => {} });
  const fids = [fidOf(mine)];
  const first = await adapter.tailOnce(shard, fids);
  assert.ok(first.started, 'with no cursor it starts at the head instead of replaying 3 days');
  const r = await adapter.tailOnce(shard, fids);
  assert.equal(r.seen, 2);
  assert.equal(r.ingested, fidOf(other) === fids[0] ? 2 : 1);
  assert.equal(r.gap, false);
  assert.equal(archive.cursor(adapter.sourceId, shard), events[1].id);
});

test('a hole in the stream is a gap: every backfill runs again', async () => {
  const archive = freshArchive();
  const mine = byType('HUB_EVENT_TYPE_MERGE_MESSAGE', 'MESSAGE_TYPE_CAST_ADD');
  const shard = mine.shardIndex;
  const node = fakeNode({ events: [{ ...mine, id: 500 * 16384, shardIndex: shard }] });
  const adapter = new SnapchainAdapter({ archive, network: 'farcaster', nodeUrl: 'http://node', fetchImpl: node.fetchImpl, log: () => {} });
  await adapter.start();
  const fid = fidOf(mine);
  archive.track(fid);
  archive.backfill(adapter.sourceId, fid, 'casts', { state: 'done' });
  archive.ingest(adapter.sourceId, [], { shard, cursor: 100 * 16384 }); // we were at block 100; the node starts at 500
  const r = await adapter.tailOnce(shard, [fid]);
  assert.equal(r.gap, true);
  assert.equal(archive.backfillState(adapter.sourceId, fid, 'casts').state, 'running');
});

test('a node that is down is reported as down, never replaced by another node', async () => {
  const archive = freshArchive();
  const node = fakeNode({ down: true });
  const adapter = new SnapchainAdapter({ archive, network: 'farcaster', nodeUrl: 'http://46.225.208.199:3381', label: 'master', fetchImpl: node.fetchImpl, log: () => {} });
  await assert.rejects(adapter.tailOnce(1, [1]), (err) => err.offline && /master \(http:\/\/46\.225\.208\.199:3381\) is not answering/.test(err.message));
  assert.ok(node.calls.every((c) => !c.includes('crackle')));
});

test('one event the archive refuses is skipped and the stream keeps moving', async () => {
  const archive = freshArchive();
  const mine = byType('HUB_EVENT_TYPE_MERGE_MESSAGE', 'MESSAGE_TYPE_CAST_ADD');
  const shard = mine.shardIndex;
  const bad = structuredClone(mine);
  bad.mergeMessageBody.message.signer = '0xnot-a-key';
  const block = blockOf(mine.id);
  const events = [{ ...mine, id: (block + 1) * 16384 + 1 }, { ...bad, id: (block + 1) * 16384 + 2 }];
  const logs = [];
  const adapter = new SnapchainAdapter({ archive, network: 'farcaster', nodeUrl: 'http://node', fetchImpl: fakeNode({ events }).fetchImpl, log: (m) => logs.push(m) });
  await adapter.start();
  archive.ingest(adapter.sourceId, [], { shard, cursor: block * 16384 });
  await adapter.tailOnce(shard, [fidOf(mine)]);
  assert.equal(archive.cursor(adapter.sourceId, shard), events[1].id);
  assert.ok(logs.some((l) => l.includes('skipped event')));
});
