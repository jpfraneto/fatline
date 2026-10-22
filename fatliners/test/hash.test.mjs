import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../src/hash.mjs';
import { canonical } from '../src/canonical.mjs';

test('sha256 matches node:crypto on many lengths', () => {
  for (let n = 0; n < 300; n += 7) {
    const s = 'x'.repeat(n) + 'ñ✓' + n;
    assert.equal(sha256Hex(s), '0x' + createHash('sha256').update(s).digest('hex'));
  }
});

test('canonical: key order and float noise never change the bytes', () => {
  assert.equal(canonical({ b: 1, a: [0.1 + 0.2, null] }), canonical({ a: [0.3, null], b: 1 }));
  assert.throws(() => canonical({ x: NaN }));
});
