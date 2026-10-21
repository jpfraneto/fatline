import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { base } from 'viem/chains';
import { Keeper } from '../../indexer/src/keeper.mjs';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// Anvil's first well-known test key. Never holds real funds.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const HOUR = 3_600_000;

/** A daily seller like AgentMetal: POST /extend {days} answers 402, then extends once paid (X-PAYMENT). */
function dailySeller(log) {
  return createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      log.push({ url: req.url, body: JSON.parse(body || '{}'), paid: Boolean(req.headers['x-payment']) });
      if (!req.headers['x-payment']) {
        res.writeHead(402, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ x402Version: 2, accepts: [{ scheme: 'exact', network: 'eip155:8453', asset: USDC, amount: '4200000', payTo: USDC, maxTimeoutSeconds: 120, extra: { name: 'USD Coin', version: '2' } }] }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ expires_at: new Date(Date.now() + 47 * HOUR).toISOString() }));
    });
  });
}

function setup(port, hoursLeft) {
  const root = mkdtempSync(join(tmpdir(), 'keeper-'));
  const dataDir = join(root, '.infinicaster');
  mkdirSync(join(root, 'infra'), { recursive: true });
  mkdirSync(dataDir);
  writeFileSync(join(root, 'infra/providers.json'), JSON.stringify({ providers: { daily: {
    kind: 'daily', paymentHeader: 'X-PAYMENT',
    renew: { method: 'POST', url: `http://127.0.0.1:${port}/v1/servers/{rental_id}/extend`, body: { days: 1 } },
  } } }));
  const expires = new Date(Date.now() + hoursLeft * HOUR).toISOString();
  writeFileSync(join(dataDir, 'compute.secret.json'), JSON.stringify({ provider: 'daily', rental_id: 'srv_1', expires_at: expires }));
  writeFileSync(join(dataDir, 'compute.json'), JSON.stringify({ paidUntil: expires }));
  // The keeper only reads its USDC balance from the chain here.
  const client = { transport: { url: 'http://127.0.0.1:1' }, readContract: async () => 100_000_000n };
  const keeper = new Keeper({ client, chain: base, privateKey: KEY, vault: USDC, root, dataDir, log: () => {} });
  return { keeper, dataDir };
}

test('a daily rental is renewed one day at a time, only when less than ~a day is left', async () => {
  const log = [];
  const server = dailySeller(log).listen(0);
  const { port } = server.address();
  try {
    const plenty = setup(port, 40);
    assert.equal(await plenty.keeper.renewIfNeeded(), null);
    assert.equal(log.length, 0, 'no purchase while more than a day is paid for');

    const soon = setup(port, 20);
    await soon.keeper.renewIfNeeded();
    assert.deepEqual(log.map((r) => [r.url, r.body.days, r.paid]), [
      ['/v1/servers/srv_1/extend', 1, false],
      ['/v1/servers/srv_1/extend', 1, true],
    ]);
    const paidUntil = Date.parse(JSON.parse(readFileSync(join(soon.dataDir, 'compute.json'), 'utf8')).paidUntil);
    assert.ok(paidUntil > Date.now() + 40 * HOUR, 'the new expiry is recorded');
  } finally {
    server.close();
  }
});
