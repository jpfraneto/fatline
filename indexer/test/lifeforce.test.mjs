import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LifeForce } from '../src/lifeforce.mjs';

test('the life force is what flows through your node: messages and blocks per second, and how fast it catches up', async () => {
  let t = 0, messages = 1000, height = 500, behind = 120;
  const fetchImpl = async () => new Response(JSON.stringify({ dbStats: { numMessages: messages }, shardInfos: [{ shardId: 0, maxHeight: 9, blockDelay: 999 }, { shardId: 1, maxHeight: height, blockDelay: behind }] }));
  const lf = new LifeForce({ nodes: [{ url: 'http://own.test', own: true, label: 'Your node' }] }, { fetchImpl, now: () => t });
  await lf.sample();
  t = 10_000; messages += 500; height += 30; behind -= 20;
  await lf.sample();
  const s = lf.status();
  assert.equal(s.alive, true);
  assert.equal(s.own, true);
  assert.equal(s.messagesPerSecond, 50);
  assert.equal(s.blocksPerSecond, 3);
  assert.equal(s.behindSeconds, 100); // shard 0 is not counted
  assert.equal(s.catchUpRate, 2);
  assert.deepEqual(s.pulse, [0, 500]);
});
