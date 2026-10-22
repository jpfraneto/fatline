import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertText, estimate, shouldAlert } from '../budget-alert.mjs';

const H = 3600_000;
const t0 = Date.parse('2026-10-22T00:00:00Z');
const list = [
  { what: 'server', hourly: 0.04, created: '2026-10-21T00:00:00Z' }, // before the balance was set
  { what: 'volume', hourly: 0.1, created: '2026-10-22T10:00:00Z' }, // after
];

test('estimate counts each resource from the later of balance time and its creation', () => {
  const e = estimate({ balanceUsd: 15, asOf: '2026-10-22T00:00:00Z' }, list, t0 + 20 * H);
  // server 20 h * 0.04 = 0.8; volume 10 h * 0.1 = 1.0
  assert.ok(Math.abs(e.spent - 1.8) < 1e-9);
  assert.ok(Math.abs(e.left - 13.2) < 1e-9);
  assert.ok(Math.abs(e.burnPerDay - 3.36) < 1e-9);
  assert.ok(Math.abs(e.runwayHours - 13.2 / 0.14) < 1e-9);
});

test('alerts once per level, then repeats near the end', () => {
  assert.deepEqual(shouldAlert(100, {}), { send: false, level: null });
  assert.equal(shouldAlert(40, {}).send, true);
  assert.equal(shouldAlert(30, { level: 48, at: 0 }, 10 * H).send, false); // same level, far from the end
  assert.equal(shouldAlert(20, { level: 48, at: 0 }).level, 24);
  assert.equal(shouldAlert(20, { level: 48, at: 0 }).send, true);
  assert.equal(shouldAlert(5, { level: 6, at: 0 }, 1 * H).send, false); // repeats every 2 h below 12 h
  assert.equal(shouldAlert(4, { level: 6, at: 0 }, 2 * H).send, true);
  assert.equal(shouldAlert(-1, { level: 0, at: 0 }, 1 * H).send, true); // every hour once it's empty
});

test('the text gets louder as money runs out', () => {
  const mk = (h) => alertText({ runwayHours: h, left: h * 0.2, burnPerDay: 4.8, emptyAt: new Date(t0) }, list);
  assert.match(mk(40), /days left/);
  assert.match(mk(20), /^🚨 /);
  assert.match(mk(5), /^🚨🚨 /);
  assert.match(mk(-1), /GONE/);
});
