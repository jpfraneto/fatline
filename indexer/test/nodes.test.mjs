import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { openDb } from '../src/db.mjs';
import { classify, NodeMonitor, probe, readInfo } from '../src/nodes.mjs';

const info = (delays, heights = delays.map(() => 100)) => ({
  version: '0.14.2',
  dbStats: { numMessages: 914_000_000 },
  shardInfos: [{ shardId: 0, maxHeight: 1, blockDelay: 0 }, ...delays.map((d, i) => ({ shardId: i + 1, maxHeight: heights[i], blockDelay: d }))],
});
const answered = (at, delays, heights) => ({ at, kind: 'answered', ...readInfo(info(delays, heights)) });

/** A fake node whose answer we change between checks, on a clock we control. */
function rig(nodeOpts = {}) {
  let clock = 1_000_000;
  let reply = () => new Response(JSON.stringify(info([0, 1])), { status: 200 });
  const fetchImpl = async () => reply();
  const db = openDb(tmpdir(), ':memory:');
  const nodes = new NodeMonitor(db, [{ id: 'master', url: 'http://10.0.0.1:3381', apps: ['0xAbC0000000000000000000000000000000000001'], ...nodeOpts }], {
    fetchImpl, now: () => clock, intervalMs: 15_000,
  });
  return { db, nodes, tick: (ms) => { clock += ms; }, set: (fn) => { reply = fn; }, now: () => clock };
}
const refused = () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
const timeout = () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); };

test('healthy: answers, every shard in sync, heights moving', () => {
  const c = classify(answered(1, [0, 3]), {});
  assert.equal(c.state, 'online');
  assert.equal(c.sync, 'synced');
});

test('an HTTP 200 without shard data is not healthy', () => {
  assert.equal(classify({ at: 1, kind: 'answered', ...readInfo({ version: 'x' }) }, {}).state, 'degraded');
  assert.equal(classify({ at: 1, kind: 'answered', ...readInfo({ shardInfos: [{ shardId: 1, maxHeight: 5 }] }) }, {}).state, 'degraded'); // no blockDelay
});

test('indexer lag: a node far behind the network is degraded and says how far', () => {
  const c = classify(answered(1, [0, 90_000]), {});
  assert.equal(c.state, 'degraded');
  assert.equal(c.sync, 'catching up');
  assert.equal(c.blocksBehind, 90_000);
});

test('frozen heights while "in sync" count as stalled after 5 minutes', () => {
  const last = { heights: { 1: 100, 2: 100 }, lastMoveAt: 0 };
  assert.equal(classify(answered(60_000, [0, 0]), last).state, 'online');
  assert.equal(classify(answered(6 * 60_000, [0, 0]), last).sync, 'stalled');
  assert.equal(classify(answered(6 * 60_000, [0, 0], [101, 100]), last).state, 'online');
});

test('offline needs evidence; a short silence is unknown', () => {
  assert.equal(classify({ at: 1, kind: 'refused' }, {}).state, 'offline');
  assert.equal(classify({ at: 1, kind: 'http-error', httpStatus: 502 }, {}).state, 'offline');
  assert.equal(classify({ at: 10, kind: 'timeout' }, { silentSince: 0 }).state, 'unknown');
  assert.equal(classify({ at: 6 * 60_000, kind: 'timeout' }, { silentSince: 0 }).state, 'offline');
});

test('probe turns failures into results and never throws', async () => {
  assert.equal((await probe('http://x', { fetchImpl: refused })).kind, 'refused');
  assert.equal((await probe('http://x', { fetchImpl: timeout })).kind, 'timeout');
  assert.equal((await probe('http://x', { fetchImpl: async () => new Response('no', { status: 500 }) })).kind, 'http-error');
  assert.equal((await probe('http://x', { fetchImpl: async () => new Response('<html>', { status: 200 }) })).kind, 'bad-body');
});

test('untrusted /v1/info: wrong types are dropped, long strings cut', () => {
  const r = readInfo({ version: 'v'.repeat(500), shardInfos: [{ shardId: '1', maxHeight: 'lots', blockDelay: {} }, 'junk', null] });
  assert.equal(r.version.length, 40);
  assert.deepEqual(r.shards, [{ shard: 1, height: null, blockDelay: null, messages: null }]);
});

test('monitor: heartbeats are kept, only changes become events', async () => {
  const r = rig();
  await r.nodes.checkAll();
  r.tick(15_000); await r.nodes.checkAll();
  let s = r.nodes.status('master');
  assert.equal(s.state, 'online');
  assert.equal(s.lastHeartbeatAt, r.now());
  assert.equal(s.version, '0.14.2');
  assert.equal(s.url, 'http://10.0.0.1:3381');
  assert.deepEqual(r.nodes.events(['master']).map((e) => e.kind), ['online']);

  r.set(refused); r.tick(15_000); await r.nodes.checkAll();
  s = r.nodes.status('master');
  assert.equal(s.state, 'offline');
  assert.equal(s.lastHeartbeatAt, r.now() - 15_000, 'the last heartbeat stays the last real answer');

  r.set(() => new Response(JSON.stringify(info([0, 1])), { status: 200 })); r.tick(15_000); await r.nodes.checkAll();
  assert.deepEqual(r.nodes.events(['master']).map((e) => e.kind), ['recovered', 'offline', 'online']);
});

test('catching up, then synced, is recorded as "synced"', async () => {
  const r = rig();
  r.set(() => new Response(JSON.stringify(info([0, 5000])), { status: 200 }));
  await r.nodes.checkAll();
  assert.equal(r.nodes.status('master').sync, 'catching up');
  r.set(() => new Response(JSON.stringify(info([0, 2], [200, 200])), { status: 200 })); r.tick(15_000); await r.nodes.checkAll();
  assert.equal(r.nodes.events(['master'])[0].kind, 'synced');
});

test('stale heartbeat: if the monitor stops, the status turns unknown, never stays online', async () => {
  const r = rig();
  await r.nodes.checkAll();
  assert.equal(r.nodes.status('master').state, 'online');
  r.tick(10 * 60_000);
  const s = r.nodes.status('master');
  assert.equal(s.state, 'unknown');
  assert.equal(s.stale, true);
  assert.equal(s.sync, null);
});

test('no probe yet is unknown', () => {
  const r = rig();
  assert.equal(r.nodes.status('master').state, 'unknown');
});

test('a private probe URL is never shown', async () => {
  const r = rig({ public: false });
  await r.nodes.checkAll();
  assert.equal(r.nodes.status('master').url, null);
});

test('state survives a restart of the server', async () => {
  const r = rig();
  await r.nodes.checkAll();
  const again = new NodeMonitor(r.db, [{ id: 'master', url: 'http://10.0.0.1:3381' }], { fetchImpl: refused, now: r.now });
  assert.equal(again.status('master').lastHeartbeatAt, r.now());
  r.tick(15_000);
  await again.checkAll();
  assert.equal(again.nodes.length, 1);
  assert.equal(again.events(['master'])[0].kind, 'offline');
});
