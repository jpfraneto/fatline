import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncProblem } from '../disk-guard.mjs';

// shard 0 is the block shard: left out, as everywhere in Fatline.
const info = (h, d) => ({ shardInfos: [{ shardId: 0, maxHeight: 5, blockDelay: 330_000 }, ...h.map((x, i) => ({ shardId: i + 1, maxHeight: x, blockDelay: d[i] }))] });
const prev = (h, worst) => ({ heights: Object.fromEntries(h.map((x, i) => [i + 1, x])), worst });

test('a node that does not answer is a problem', () => {
  assert.equal(syncProblem(null, undefined), 'not answering');
  assert.equal(syncProblem({ shardInfos: [{ shardId: 0, maxHeight: 1 }] }, undefined), 'not answering');
});

test('a healthy node is fine, on the first reading and after; a lagging shard 0 is ignored', () => {
  assert.equal(syncProblem(info([10, 20], [1, 2]), undefined), null);
  assert.equal(syncProblem(info([11, 21], [1, 2]), prev([10, 20], 2)), null);
});

test('a shard that stopped moving is a problem (Hypersnap, 2026-10-24..28)', () => {
  assert.match(syncProblem(info([20, 99], [378_000, 368_000]), prev([20, 30], 378_000)), /shard 1 has not moved/);
});

test('far behind but closing the gap is catching up, not a problem; a growing gap is', () => {
  assert.equal(syncProblem(info([600, 700], [4000, 3000]), prev([20, 30], 9000)), null);
  assert.match(syncProblem(info([600, 700], [9500, 3000]), prev([20, 30], 9000)), /9,500 blocks behind and not catching up/);
});
