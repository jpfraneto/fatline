import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { readiness, saveWorker } from '../worker.mjs';

const PHRASE = 'test test test test test test test test test test test junk';

test('worker: the same phrase always gives the same wallet; only the key is saved, mode 600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worker-'));
  const info = saveWorker(mnemonicToAccount(PHRASE), { state: dir });
  assert.equal(info.address, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  const key = readFileSync(join(dir, 'worker.key'), 'utf8').trim();
  assert.equal(privateKeyToAccount(key).address, info.address);
  assert.equal(statSync(join(dir, 'worker.key')).mode & 0o777, 0o600);
  const saved = readFileSync(join(dir, 'worker.json'), 'utf8') + key;
  assert.ok(!saved.includes('junk'), 'the phrase is never written');
  assert.ok(!existsSync(join(dir, 'phrase')));
});

test('worker: the path from wallet to coin, and an honest wait for the launch contracts', () => {
  const none = readiness({});
  assert.equal(none.next.id, 'wallet');
  const running = readiness({ wallet: '0xabc', usdc: 5, node: { state: 'alive' }, client: true, factory: null });
  assert.equal(running.next.id, 'coin');
  assert.equal(running.next.waiting, true);
  assert.match(running.next.hint, /not on Base yet/);
  assert.equal(readiness({ wallet: '0xabc', usdc: 0 }).next.id, 'funds');
});
