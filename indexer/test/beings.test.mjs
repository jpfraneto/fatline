// Beings: a hatched Fatliner gets its art drawn once, only with a key, within a daily limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeBeings } from '../src/beings.mjs';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function setup({ key = 'sk-or-test', perDay = 4 } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'beings-'));
  if (key) writeFileSync(join(dataDir, 'openrouter.key'), key);
  const calls = [];
  let fail = false;
  const draw = async (fid, { outRoot, key: k }) => {
    calls.push({ fid, key: k });
    if (fail) throw new Error('the image API said no');
    const p = join(outRoot.replace(/pfp$/, ''), `made-${fid}.png`);
    writeFileSync(p, PNG);
    return { portrait: p, model: 'test/model', promptSha256: 'abc' };
  };
  let clock = 1_000_000;
  const tokens = [
    { fid: 16098, stage: 'fatliner', surname: 'FATLINE' },
    { fid: 13505, stage: 'fatliner', surname: 'THAITUMA' },
    { fid: 20630, stage: 'egg', surname: 'AENON' },
  ];
  const b = makeBeings({ dataDir, tokens: () => tokens, drawn: (fid) => fid === 16098, draw, perDay, now: () => clock, log: () => {} });
  return { b, calls, dataDir, tokens, tick: (ms) => { clock += ms; }, setFail: (v) => { fail = v; } };
}

test('a hatched Fatliner without art is drawn once; Aster (already drawn) and eggs are left alone', async () => {
  const { b, calls, dataDir } = setup();
  assert.equal(await b.run(), 1);
  assert.deepEqual(calls.map((c) => c.fid), [13505]);
  assert.equal(calls[0].key, 'sk-or-test');
  assert.deepEqual(b.list(), { 13505: { image: 'https://fatline.ink/beings/13505.png?v=1000000' } });
  assert.deepEqual(b.png(13505), PNG);
  assert.deepEqual(readFileSync(join(dataDir, 'beings', '13505.png')), PNG);
  assert.equal(await b.run(), 0, 'never redrawn by itself');
  assert.equal(calls.length, 1);
});

test('no key, no drawing (and no money spent)', async () => {
  const { b, calls } = setup({ key: null });
  assert.equal(await b.run(), 0);
  assert.equal(calls.length, 0);
  assert.equal(b.status().key, false);
});

test('a failure waits a day; the daily limit holds', async () => {
  const { b, calls, tokens, tick, setFail } = setup({ perDay: 1 });
  setFail(true);
  assert.equal(await b.run(), 0);
  assert.equal(await b.run(), 0, 'not retried within the day');
  assert.equal(calls.length, 1);
  assert.match(b.status().tries[13505].error, /said no/);
  tick(25 * 3600_000);
  setFail(false);
  tokens.push({ fid: 1, stage: 'fatliner', surname: 'ONE' });
  assert.equal(await b.run(), 1, 'one a day: the second waits');
  assert.equal(calls.length, 2);
});
