import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from '../node-status.mjs';

test('a node being born says what it is doing, in plain words', () => {
  const dl = classify({ running: true, log: '[fatline] Streaming the snapshot\n  shard 1: 100/4000\n  shard 2: 200/4000\n  shard 1: 400/4000' });
  assert.equal(dl.state, 'downloading');
  assert.match(dl.say, /downloading its snapshot: 8% \(shard 1 10%, shard 2 5%\)/);
  assert.equal(classify({ running: true, log: 'shard 1: done\n[fatline] Snapshot unpacked: 540G' }).state, 'unpacking');
  assert.equal(classify({ running: false, log: '[fatline] Starting Snapchain', docker: 'snapchain-snapchain-1 Up 2 minutes' }).state, 'starting');
});

test('a problem says what went wrong, with the last lines for the report', () => {
  const err = classify({ running: false, log: 'x\nFATLINE_ERROR: no data disk. / has 70 GB free' });
  assert.equal(err.state, 'problem');
  assert.match(err.say, /^no data disk/);
  const stopped = classify({ running: false, log: 'shard 1: 100/4000\nA snapshot shard failed. Re-run this script' });
  assert.equal(stopped.state, 'problem');
  assert.match(stopped.say, /setup stopped .*A snapshot shard failed/);
  assert.equal(classify({ running: false, log: '' }).state, 'problem');
});
