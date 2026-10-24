import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { browserAccount, checkedAccount, typedDataJson } from '../payer.mjs';
import { signPayment } from '../../indexer/src/x402.mjs';

const quote = { version: 2, resource: null };
const option = {
  scheme: 'exact', network: 'eip155:8453', chainId: 8453, amount: 4200000n, asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  payTo: '0x1111111111111111111111111111111111111111', maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' }, raw: {},
};

test('typed data for a wallet: EIP712Domain first, numbers as strings', () => {
  const json = JSON.parse(typedDataJson({
    domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: option.asset },
    types: { T: [{ name: 'value', type: 'uint256' }] }, primaryType: 'T', message: { value: 4200000n },
  }));
  assert.deepEqual(json.types.EIP712Domain.map((x) => x.name), ['name', 'version', 'chainId', 'verifyingContract']);
  assert.equal(json.message.value, '4200000');
  assert.equal(json.primaryType, 'T');
});

test('a remote wallet signs an x402 payment, and a signature from another address is refused', async () => {
  const me = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const good = checkedAccount(me.address, (args) => me.signTypedData(args));
  const header = await signPayment({ account: good, quote, option });
  assert.equal(header.name, 'PAYMENT-SIGNATURE');
  const bad = checkedAccount(me.address, (args) => other.signTypedData(args));
  await assert.rejects(signPayment({ account: bad, quote, option }), /not from the connected address/);
});

test('browser wallet: the local page connects, gets each payment, and its signature comes back', async () => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  let url;
  const pending = browserAccount({ open: false, say: (t) => { const m = t.match(/http:\/\/127\.0\.0\.1:\d+\/#\S+/); if (m) url = m[0]; } });
  while (!url) await new Promise((r) => setTimeout(r, 10));
  const [origin, token] = url.split('/#');
  const post = (p, b) => fetch(origin + p, { method: 'POST', headers: { 'x-fatline': token }, body: JSON.stringify(b) }).then((r) => r.json());
  assert.equal((await fetch(origin + '/next', { method: 'POST', body: '{}' })).status, 403, 'needs the page token');
  await post('/address', { address: wallet.address });
  const account = await pending;
  assert.equal(account.address, wallet.address);

  // What the page does: poll, sign with the wallet, send the signature back.
  const page = (async () => {
    for (;;) {
      const j = await post('/next', {});
      if (j.wait) { await new Promise((r) => setTimeout(r, 20)); continue; }
      const t = JSON.parse(j.typedData);
      const { EIP712Domain, ...types } = t.types;
      const signature = await wallet.signTypedData({ domain: t.domain, types, primaryType: t.primaryType, message: t.message });
      return post('/signed', { id: j.id, signature });
    }
  })();
  const header = await signPayment({ account, quote, option });
  await page;
  assert.equal(header.name, 'PAYMENT-SIGNATURE');
  await account.close();
});
