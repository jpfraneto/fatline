import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide } from '../src/pay-trigger.mjs';

const NODE = '0x37757a1D0E0117EB169dDADBa10C18c796343bAE';
const CARD = '0x00000000000000000000000000000000000ca4d0';
const now = 1_800_000_000n;
const rate = 50n; // 4.32 USDC a day

test('the node never triggers a payment to itself', () => {
  const d = decide({ amount: rate * 86_400n * 30n, rate, paidThrough: 0n, payee: NODE.toLowerCase(), self: NODE, nowS: now });
  assert.equal(d.pay, false);
  assert.match(d.why, /setKeeper/);
});

test('pays once a day or more is due', () => {
  assert.equal(decide({ amount: rate * 86_400n, rate, paidThrough: now + 29n * 86_400n, payee: CARD, self: NODE, nowS: now }).pay, true);
  assert.equal(decide({ amount: rate * 3_600n, rate, paidThrough: now + 29n * 86_400n, payee: CARD, self: NODE, nowS: now }).pay, false);
});

test('pays whatever is there when less than a day is left', () => {
  assert.equal(decide({ amount: rate * 60n, rate, paidThrough: now + 3_600n, payee: CARD, self: NODE, nowS: now }).pay, true);
});

test('nothing due, nothing sent', () => {
  assert.equal(decide({ amount: 0n, rate, paidThrough: 0n, payee: CARD, self: NODE, nowS: now }).pay, false);
});
