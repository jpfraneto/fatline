import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judge } from '../vps.mjs';

test('a big enough server passes; a small one says exactly what is missing', () => {
  const ok = judge('mem_kb=16303000\ncpus=8\narch=aarch64\nos=Ubuntu 24.04\nfree_kb=734003200\nmount=/mnt/data\n');
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.mount, '/mnt/data');
  const small = judge('mem_kb=4000000\ncpus=2\narch=x86_64\nos=Debian\nfree_kb=80000000\nmount=/\n');
  assert.equal(small.problems.length, 3);
  assert.match(small.problems[1], /76 GB free on \//);
});
