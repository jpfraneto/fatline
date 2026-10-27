import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, payPolicy } from '../src/pay-trigger.mjs';

const NODE = '0x37757a1D0E0117EB169dDADBa10C18c796343bAE';
const CARD = '0x7802a6Bec9Fb4b04B779Bd1d8785C2661C1c8C4c';
const now = 1_800_000_000n;
const rate = 50n; // 4.32 USDC a day
const day = rate * 86_400n;
const live = payPolicy({ payee: CARD, payeeVerified: true, mode: 'live', reserveUsdc: 50, maxPerTransferUsdc: 10 });
const base = { amount: day, rate, paidThrough: now + 3_600n, payee: CARD, available: 200_000_000n, self: NODE, nowS: now };

test('pays only when verified, live, under the cap and above the reserve', () => {
  assert.equal(decide({ ...base, policy: live }).pay, true);
});

test('dry run by default, and while the payee is unverified', () => {
  assert.equal(decide({ ...base }).pay, false);
  const d = decide({ ...base, policy: payPolicy({ payee: CARD, mode: 'live' }) });
  assert.equal(d.pay, false); assert.equal(d.dryRun, true); assert.match(d.why, /not verified/);
  assert.equal(decide({ ...base, policy: payPolicy({ payee: CARD, payeeVerified: true }) }).dryRun, true); // mode defaults to dry-run
});

test('never below the reserve, never the whole balance', () => {
  assert.match(decide({ ...base, available: 52_000_000n, policy: live }).why, /reserve/);
  const zeroReserve = payPolicy({ payee: CARD, payeeVerified: true, mode: 'live', reserveUsdc: 0, maxPerTransferUsdc: 10 });
  assert.equal(decide({ ...base, available: day, policy: zeroReserve }).pay, false); // the reserve is at least 1 USDC
});

test('over the per-transfer cap: nothing', () => {
  assert.match(decide({ ...base, amount: day * 30n, policy: live }).why, /cap/);
});

test('the vault paying someone else than the configured payee: nothing', () => {
  assert.match(decide({ ...base, payee: '0x000000000000000000000000000000000000dEaD', policy: live }).why, /config expects/);
});

test('the node never triggers a payment to itself', () => {
  assert.match(decide({ ...base, payee: NODE.toLowerCase(), policy: live }).why, /setKeeper/);
});

test('not due yet: nothing', () => {
  assert.equal(decide({ ...base, amount: rate * 3_600n, paidThrough: now + 29n * 86_400n, policy: live }).pay, false);
  assert.equal(decide({ ...base, amount: 0n, policy: live }).pay, false);
});
