import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { verifyTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chooseOption, readQuote, signPayment } from '../../indexer/src/x402.mjs';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SELLER = '0x8eCbd65228930060363C70854da7D37D57ffC358';
// Anvil's first well-known test key. Never holds real funds.
const payer = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

const requirement = (version) => ({
  scheme: 'exact',
  network: version === 1 ? 'base' : 'eip155:8453',
  [version === 1 ? 'maxAmountRequired' : 'amount']: '14990000',
  asset: USDC,
  payTo: SELLER,
  maxTimeoutSeconds: 600,
  extra: { name: 'USD Coin', version: '2' },
});

/** A seller that answers 402 until it gets a payment it can verify. */
function seller(version) {
  return createServer(async (req, res) => {
    const header = req.headers[version === 1 ? 'x-payment' : 'payment-signature'];
    if (!header) {
      const quote = { x402Version: version, accepts: [requirement(version)], resource: { url: '/rent' } };
      if (version === 2) res.setHeader('payment-required', Buffer.from(JSON.stringify(quote)).toString('base64'));
      res.writeHead(402, { 'content-type': 'application/json' });
      return res.end(version === 1 ? JSON.stringify(quote) : '{}');
    }
    const p = JSON.parse(Buffer.from(header, 'base64').toString());
    const a = p.payload.authorization;
    const valid = await verifyTypedData({
      address: a.from,
      domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC },
      types: { TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
      primaryType: 'TransferWithAuthorization',
      message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) },
      signature: p.payload.signature,
    });
    const ok = valid && p.x402Version === version && a.to === SELLER && a.value === '14990000'
      && (version === 1 ? p.network === 'base' : p.accepted.network === 'eip155:8453');
    res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok, from: a.from }));
  });
}

for (const version of [1, 2]) {
  test(`pays an x402 v${version} seller with one valid EIP-3009 signature`, async () => {
    const server = seller(version).listen(0);
    const url = `http://127.0.0.1:${server.address().port}/rent`;
    try {
      const first = await fetch(url, { method: 'POST' });
      assert.equal(first.status, 402);
      const quote = await readQuote(first);
      assert.equal(quote.version, version);
      const option = chooseOption(quote, [8453]);
      assert.equal(option.amount, 14_990_000n);

      const header = await signPayment({ account: payer, quote, option });
      const paid = await fetch(url, { method: 'POST', headers: { [header.name]: header.value } });
      assert.equal(paid.status, 200);
      assert.deepEqual(await paid.json(), { ok: true, from: payer.address });
    } finally {
      server.close();
    }
  });
}

test('refuses options it cannot pay', async () => {
  const res = new Response(JSON.stringify({ x402Version: 1, accepts: [{ ...requirement(1), network: 'solana' }] }), { status: 402 });
  await assert.rejects(readQuote(res), /Unsupported payment network/);
});
