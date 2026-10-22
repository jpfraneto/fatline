import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Archive } from '../src/archive.mjs';
import { openDb } from '../src/db.mjs';

const h = (n) => `0x${n.toString(16).padStart(40, '0')}`;
const SIGNER = `0x${'ab'.repeat(32)}`;
const cast = (n, extra = {}) => ({ eventType: 'MERGE_MESSAGE', shard: 1, eventId: 1000 + n, dedupKey: h(n), fid: 18350, msgType: 'MESSAGE_TYPE_CAST_ADD', protocolTs: 1_000_000 + n, signer: SIGNER, body: { text: `cast ${n}` }, ...extra });

function setup() {
  const archive = new Archive(openDb(tmpdir(), ':memory:'));
  const fc = archive.source({ network: 'farcaster', nodeUrl: 'http://46.225.208.199:3381', label: 'master' });
  const hs = archive.source({ network: 'hypersnap', nodeUrl: 'https://haatz.quilibrium.com', label: 'haatz' });
  return { archive, fc, hs };
}

test('one message on both networks: one archive item, each network says its own status', () => {
  const { archive, fc, hs } = setup();
  archive.ingest(fc, [cast(1)], { shard: 1, cursor: 1001 });
  // Same event id on the other network: event ids collide across networks, so the reference includes the network.
  archive.ingest(hs, [cast(1)], { shard: 1, cursor: 1001 });
  archive.ingest(hs, [cast(2)], { shard: 1, cursor: 1002 });
  const { items } = archive.read(18350);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].networks, { farcaster: null, hypersnap: 'merged' }, 'not seen on farcaster');
  assert.deepEqual(items[1].networks, { farcaster: 'merged', hypersnap: 'merged' });
  assert.equal(items[1].body.text, 'cast 1');
  assert.equal(items[1].signer, SIGNER);
});

test('ingest is idempotent and the cursor only moves forward, in the same transaction', () => {
  const { archive, fc } = setup();
  assert.equal(archive.cursor(fc, 1), null);
  assert.equal(archive.ingest(fc, [cast(1), cast(2)], { shard: 1, cursor: 1002 }), 2);
  assert.equal(archive.ingest(fc, [cast(1), cast(2)], { shard: 1, cursor: 1002 }), 0);
  archive.ingest(fc, [], { shard: 1, cursor: 900 });
  assert.equal(archive.cursor(fc, 1), 1002);
  archive.ingest(fc, [], { shard: 1, cursor: 5000 }); // empty: just the cursor
  assert.equal(archive.cursor(fc, 1), 5000);
  assert.throws(() => archive.ingest(fc, [cast(3), { eventType: 'NOPE' }], { shard: 1, cursor: 9000 }), /eventType/);
  assert.equal(archive.cursor(fc, 1), 5000, 'a bad batch writes nothing');
  assert.equal(archive.read(18350).items.length, 2);
});

test('prune creates the row with its body even if the merge was never seen; content is never deleted', () => {
  const { archive, fc } = setup();
  archive.ingest(fc, [cast(7, { eventType: 'PRUNE_MESSAGE', eventId: 2000 })], { shard: 1, cursor: 2000 });
  const [item] = archive.read(18350).items;
  assert.equal(item.networks.farcaster, 'pruned');
  assert.equal(item.body.text, 'cast 7');
});

test('displaced messages (from deletedMessages, or a CAST_REMOVE target) keep their content', () => {
  const { archive, fc } = setup();
  archive.ingest(fc, [cast(1), cast(2)], { shard: 1, cursor: 1002 });
  archive.ingest(fc, [{ eventType: 'MERGE_MESSAGE', shard: 1, eventId: 1003, dedupKey: h(50), fid: 18350, msgType: 'MESSAGE_TYPE_CAST_REMOVE', protocolTs: 1_000_050, displaced: [h(1)] }], { shard: 1, cursor: 1003 });
  archive.ingest(fc, [{ eventType: 'MERGE_MESSAGE', shard: 1, eventId: 1004, dedupKey: h(51), fid: 18350, msgType: 'MESSAGE_TYPE_CAST_REMOVE', protocolTs: 1_000_051, target: h(2) }], { shard: 1, cursor: 1004 });
  // A displaced message we never saw, sent whole by the node: it enters the archive with its body.
  archive.ingest(fc, [{ eventType: 'MERGE_MESSAGE', shard: 1, eventId: 1005, dedupKey: h(52), fid: 18350, msgType: 'MESSAGE_TYPE_CAST_REMOVE', protocolTs: 1_000_052,
    displaced: [{ hash: h(3), fid: 18350, msgType: 'MESSAGE_TYPE_CAST_ADD', protocolTs: 1_000_003, body: { text: 'cast 3' } }] }], { shard: 1, cursor: 1005 });
  const items = archive.read(18350).items;
  assert.deepEqual(items.map((i) => [i.body?.text, i.networks.farcaster]), [['cast 3', 'displaced'], ['cast 2', 'displaced'], ['cast 1', 'displaced']]);
  assert.ok(!items.some((i) => i.type === 'MESSAGE_TYPE_CAST_REMOVE'), 'removes are not archive items themselves');
});

test('a backfill never undoes a prune, revoke or displace; a failed merge never hides a held message', () => {
  const { archive, fc } = setup();
  archive.ingest(fc, [cast(1, { eventType: 'REVOKE_MESSAGE' })], { shard: 1, cursor: 1001 });
  archive.ingest(fc, [cast(1, { eventType: 'BACKFILL', eventId: null, shard: null })]);
  assert.equal(archive.read(18350).items[0].networks.farcaster, 'revoked');
  archive.ingest(fc, [cast(2)], { shard: 1, cursor: 1002 });
  archive.ingest(fc, [cast(2, { eventType: 'MERGE_FAILURE', eventId: 1003 })], { shard: 1, cursor: 1003 });
  assert.equal(archive.read(18350).items[0].networks.farcaster, 'merged');
  archive.ingest(fc, [cast(3, { eventType: 'MERGE_FAILURE', eventId: 1004 })], { shard: 1, cursor: 1004 });
  assert.equal(archive.read(18350).items[0].networks.farcaster, 'failed', 'your post failed on this network');
});

test('backfill rows are separate from node events, keep no cursor, and can be resumed', () => {
  const { archive, fc } = setup();
  archive.track(18350);
  assert.deepEqual(archive.fids(), [18350]);
  assert.equal(archive.backfillState(fc, 18350, 'casts'), null);
  archive.backfill(fc, 18350, 'casts', { state: 'running', pageToken: 'abc=' });
  assert.deepEqual(archive.backfillState(fc, 18350, 'casts'), { state: 'running', pageToken: 'abc=', doneAt: null });
  archive.ingest(fc, [cast(1, { eventType: 'BACKFILL', eventId: null, shard: null })], { shard: null, cursor: null });
  assert.equal(archive.cursor(fc, 1), null);
  archive.backfill(fc, 18350, 'casts', { state: 'done' });
  archive.markGap(fc);
  assert.equal(archive.backfillState(fc, 18350, 'casts').state, 'running');
});

test('onchain and username-proof events dedupe by their own keys', () => {
  const { archive, fc } = setup();
  const onchain = { eventType: 'MERGE_ON_CHAIN_EVENT', shard: 1, eventId: 3000, dedupKey: `10|0x${'cd'.repeat(32)}|81`, fid: 18350, msgType: 'EVENT_TYPE_SIGNER' };
  assert.equal(archive.ingest(fc, [onchain], { shard: 1, cursor: 3000 }), 1);
  assert.equal(archive.ingest(fc, [{ ...onchain, eventType: 'MERGE_USERNAME_PROOF', eventId: 3001, dedupKey: 'anky|18350|1792600000' }], { shard: 1, cursor: 3001 }), 1);
});

test('untrusted input is checked before anything is written', () => {
  const { archive, fc } = setup();
  for (const bad of [
    { ...cast(1), fid: -1 }, { ...cast(1), dedupKey: 'x' }, { ...cast(1), signer: '0x12' }, { ...cast(1), displaced: ['0x123'] },
    { ...cast(1), network: 'hypersnap' }, { ...cast(1), eventId: null }, { ...cast(1), protocolTs: 'yesterday' },
  ]) assert.throws(() => archive.ingest(fc, [bad], { shard: 1, cursor: 1 }), /archive:/, JSON.stringify(bad).slice(0, 80));
  assert.throws(() => archive.source({ network: 'bluesky', nodeUrl: 'http://x' }), /network/);
  assert.equal(JSON.parse(archive.db.prepare('SELECT raw FROM fl_events').get()?.raw ?? 'null'), null);
  archive.ingest(fc, [cast(9, { raw: { blob: 'x'.repeat(100_000) } })], { shard: 1, cursor: 1 });
  assert.equal(JSON.parse(archive.db.prepare('SELECT raw FROM fl_events').get().raw).truncated, true);
});

test('a revoke burst of 5,000 messages lands in one transaction', () => {
  const { archive, fc } = setup();
  const n = 5000;
  archive.ingest(fc, Array.from({ length: n }, (_, i) => cast(i + 1, { eventId: i + 1 })), { shard: 1, cursor: n });
  const started = Date.now();
  archive.ingest(fc, Array.from({ length: n }, (_, i) => cast(i + 1, { eventType: 'REVOKE_MESSAGE', eventId: n + i + 1 })), { shard: 1, cursor: 2 * n });
  assert.ok(Date.now() - started < 5000);
  assert.equal(archive.db.prepare("SELECT COUNT(*) AS c FROM fl_messages WHERE status = 'revoked'").get().c, n);
});

test('reading: pages by time, filters by type, never shows node URLs', () => {
  const { archive, fc } = setup();
  archive.ingest(fc, Array.from({ length: 5 }, (_, i) => cast(i + 1)), { shard: 1, cursor: 1005 });
  archive.ingest(fc, [{ eventType: 'MERGE_MESSAGE', shard: 1, eventId: 1006, dedupKey: h(99), fid: 18350, msgType: 'MESSAGE_TYPE_REACTION_ADD', protocolTs: 1_000_099 }], { shard: 1, cursor: 1006 });
  const page = archive.read(18350, { limit: 2 });
  assert.deepEqual(page.items.map((i) => i.body.text), ['cast 5', 'cast 4']);
  assert.deepEqual(archive.read(18350, { limit: 2, before: page.more }).items.map((i) => i.body.text), ['cast 3', 'cast 2']);
  assert.equal(archive.read(18350, { types: ['reaction'] }).items.length, 1);
  assert.throws(() => archive.read(18350, { types: ['nope'] }), /types/);
  assert.ok(!JSON.stringify(page).includes('46.225'), 'adapter node URLs stay server-side');
  assert.equal(page.sources[0].network, 'farcaster');
});

test('paging never skips messages that share a timestamp', () => {
  const { archive, fc } = setup();
  archive.ingest(fc, Array.from({ length: 7 }, (_, i) => cast(i + 1, { protocolTs: 5_000 })), { shard: 1, cursor: 1007 });
  const seen = [];
  let before = null;
  do {
    const page = archive.read(18350, { limit: 3, before });
    seen.push(...page.items.map((i) => i.key));
    before = page.more;
  } while (before);
  assert.equal(new Set(seen).size, 7);
});

test('re-registering a source updates its public label, keeps its id', () => {
  const { archive, fc } = setup();
  const again = archive.source({ network: 'farcaster', nodeUrl: 'http://46.225.208.199:3381', label: 'Farcaster (own node)' });
  assert.equal(again, fc);
  assert.equal(archive.sources()[0].label, 'Farcaster (own node)');
});

test('two processes share one file: a second Archive on the same database sees the same state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'archive-'));
  const a = new Archive(openDb(dir));
  const b = new Archive(openDb(dir));
  const fc = a.source({ network: 'farcaster', nodeUrl: 'http://n:3381', label: 'n' });
  a.ingest(fc, [cast(1)], { shard: 1, cursor: 1001 });
  assert.equal(b.cursor(fc, 1), 1001);
  assert.equal(b.read(18350).items.length, 1);
});

test('HTTP: /api/archive/:fid reads the archive; bad FIDs are refused', async () => {
  const { buildServer } = await import('../src/server.mjs');
  const { archive, fc } = setup();
  archive.track(18350);
  archive.ingest(fc, [cast(1)], { shard: 1, cursor: 1001 });
  const dataDir = mkdtempSync(join(tmpdir(), 'arch-http-'));
  const server = buildServer({ config: { appDir: '/nonexistent', dataDir }, networks: {}, voices: { status: () => ({}) }, launchpad: { status: () => ({}) }, archive });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const body = await (await fetch(`${base}/api/archive/18350`)).json();
    assert.equal(body.items[0].body.text, 'cast 1');
    assert.equal(body.tracked, true);
    assert.equal((await fetch(`${base}/api/archive`)).status, 404, 'no app key here: no own FID');
    assert.equal((await fetch(`${base}/api/archive/abc`)).status, 404);
    assert.equal((await (await fetch(`${base}/api/archive/1`)).json()).tracked, false);
  } finally { server.close(); }
});
