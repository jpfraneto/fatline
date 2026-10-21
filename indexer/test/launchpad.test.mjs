import assert from 'node:assert/strict';
import { test } from 'node:test';
import { usdcStartTick } from '../src/launch.mjs';
import { appUri, readUri } from '../src/launchpad.mjs';

test('app metadata lives onchain as a data: URI and reads back', () => {
  const meta = { name: 'Opinions', description: 'sin ruido', image: '', experience: { type: 'video', url: 'https://youtu.be/x' } };
  assert.deepEqual(readUri(appUri(meta)), meta);
  assert.deepEqual(readUri('ipfs://abc'), { link: 'ipfs://abc' });
});

test('USDC pool ticks account for 6 vs 18 decimals', () => {
  // Clanker's WETH default (-230400) is ~$27K at ~$2,700 ETH; the same cap paired with USDC sits ~197,300 ticks lower.
  assert.equal(usdcStartTick(27_000), -427600);
  assert.ok(usdcStartTick(25_000) % 200 === 0); // a multiple of the tick spacing
  assert.ok(usdcStartTick(1_000_000) > usdcStartTick(25_000));
});
