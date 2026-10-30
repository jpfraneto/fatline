import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pick, score } from '../src/discover.mjs';

const NOW = Date.UTC(2026, 9, 30, 12);
const cast = (fid, hoursAgo, text, extra = {}) => ({ id: `0x${fid}${hoursAgo}`, fid, text, embeds: [], timestamp: NOW - hoursAgo * 3600_000, ...extra });
const ctx = (o = {}) => ({ follows: new Set([1, 2, 3]), near: new Set(), nowMs: NOW, ...o });

test('for you: what your people liked, questions, and who has been near rise; time and bare links sink', () => {
  const plain = score(cast(1, 1, 'gm'), ctx()).value;
  const asked = score(cast(1, 1, 'what are you building this week, and why does it matter to you?'), ctx());
  assert.ok(asked.value > plain);
  assert.deepEqual(asked.why.map((w) => w.kind), ['question']);
  const liked = score(cast(9, 1, 'gm'), ctx({ reactors: [{ fid: 1, kind: 'like' }, { fid: 2, kind: 'recast' }] }));
  assert.ok(liked.value > plain);
  assert.deepEqual(liked.why.map((w) => w.kind), ['liked', 'recast', 'new'], 'brought by people you follow: someone new');
  assert.ok(score(cast(1, 1, 'gm'), ctx({ near: new Set([1]) })).value > plain);
  assert.ok(score(cast(1, 20, 'gm'), ctx()).value < plain, 'older sinks');
  assert.ok(score(cast(1, 1, 'https://x.example/a'), ctx()).value < plain, 'only a link sinks');
  assert.equal(score(cast(9, 1, 'gm'), ctx()).why.length, 0, 'not followed and nobody brought it: nothing to say');
});

test('for you: best first, two per person at most, never the same person twice in a row', () => {
  const s = (fid, v) => ({ cast: { fid }, score: v });
  const out = pick([s(1, 9), s(1, 8), s(1, 7), s(2, 6), s(3, 1)]);
  assert.deepEqual(out.map((x) => [x.cast.fid, x.score]), [[1, 9], [2, 6], [1, 8], [3, 1]]);
});
