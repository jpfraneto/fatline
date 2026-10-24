// The browser-wallet login: the typed data the page hands to a wallet (eth_signTypedData_v4 JSON) must produce the
// same signature as the Farcaster library's own signer, or the node would refuse the KEY_ADD.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { buildKeyAdd, custodyOfFid, fidOfCustody } from '../src/identity.mjs';
import { typedDataJson } from '../src/login.mjs';

const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

function fakeNode(routes) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const body = routes[u.pathname]?.(u.searchParams);
    if (body === undefined) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return () => { globalThis.fetch = real; };
}

test('wallet login: the JSON a browser wallet signs gives the same signature as the library', async () => {
  const restore = fakeNode({ '/v1/signersByFid': () => ({ signers: [], currentUserNonce: 4 }) });
  try {
    let fromWallet;
    const custody = {
      address: account.address,
      async signTypedData(args) {
        // What the page does: JSON over the wire, then the wallet signs it (viem stands in for the wallet).
        const json = JSON.parse(JSON.stringify(typedDataJson(args)));
        assert.equal(json.types.EIP712Domain.length, 3, 'name, version, chainId');
        assert.equal(json.domain.chainId, 1);
        const { EIP712Domain, ...types } = json.types;
        fromWallet = await account.signTypedData({ domain: json.domain, types, primaryType: json.primaryType, message: json.message });
        const fromLibrary = await account.signTypedData(args);
        assert.equal(fromWallet, fromLibrary);
        return fromWallet;
      },
    };
    const { message, record } = await buildKeyAdd({ node: { url: 'http://node.test' }, fid: 18350, custody, networkName: 'farcaster' });
    assert.ok(fromWallet);
    assert.equal(record.nonce, 5);
    assert.equal(message.data.fid, 18350);
  } finally { restore(); }
});

test('connect: the owner of the claimed FID is asked first (fast), the address lookup only as a fallback', async () => {
  let byAddress = 0;
  const restore = fakeNode({
    '/v1/onChainEventsByFid': () => ({ events: [
      { blockNumber: 1, logIndex: 0, idRegisterEventBody: { eventType: 'Register', to: '0x1111111111111111111111111111111111111111' } },
      { blockNumber: 9, logIndex: 0, idRegisterEventBody: { eventType: 'Transfer', to: account.address.toLowerCase() } },
      { blockNumber: 12, logIndex: 0, idRegisterEventBody: { eventType: 'ChangeRecovery', to: '0x2222222222222222222222222222222222222222' } },
    ] }),
    '/v1/onChainIdRegistryEventByAddress': () => { byAddress++; return undefined; },
  });
  try {
    const node = { url: 'http://node.test' };
    assert.equal(await custodyOfFid(node, 18350), account.address.toLowerCase(), 'the last register or transfer wins; recovery changes do not move the FID');
    assert.equal(await fidOfCustody(node, account.address, 18350), 18350);
    assert.equal(byAddress, 0);
    assert.equal(await fidOfCustody(node, '0x1111111111111111111111111111111111111111', 18350), null);
    assert.equal(byAddress, 1);
  } finally { restore(); }
});

test('wallet login: two signatures from the page, then the key is submitted, confirmed and saved', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Message, MessageType } = await import('@farcaster/core').catch(() => ({}));
  const { WalletLogin } = await import('../src/login.mjs');
  const dataDir = mkdtempSync(join(tmpdir(), 'fl-wallet-'));
  let submitted = null;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const j = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (u.pathname === '/v1/onChainEventsByFid') return j({ events: [] });
    if (u.pathname === '/v1/onChainIdRegistryEventByAddress') return j({ fid: 18350, idRegisterEventBody: { to: account.address.toLowerCase() } });
    if (u.pathname === '/v1/signersByFid') return j({ currentUserNonce: 0, signers: submitted ? [{ key: submitted }] : [] });
    if (u.pathname === '/v1/submitMessage') {
      const m = Message.decode(new Uint8Array(init.body));
      assert.equal(m.data.type, MessageType.KEY_ADD);
      submitted = `0x${Buffer.from(m.data.keyAddBody.key).toString('hex')}`;
      return j({ ok: true });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const login = new WalletLogin({ config: { dataDir, defaultNetwork: 'farcaster' }, networks: { farcaster: { node: async () => ({ url: 'http://node.test', label: 'test node' }) } } });
    let s = await login.walletStart({ address: account.address });
    const kinds = [];
    while (s.step === 'signing') {
      const json = JSON.parse(JSON.stringify(s.typedData));
      kinds.push(json.primaryType);
      const { EIP712Domain, ...types } = json.types;
      s = await login.walletSign({ signature: await account.signTypedData({ domain: json.domain, types, primaryType: json.primaryType, message: json.message }) });
    }
    for (let i = 0; i < 50 && login.status().step !== 'done' && login.state.step !== 'error'; i++) await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(kinds, ['SignedKeyRequest', 'KeyAdd']);
    assert.equal(login.state.step === 'error' ? login.state.error : 'done', 'done');
    const key = JSON.parse(readFileSync(join(dataDir, 'appkey.json'), 'utf8'));
    assert.equal(key.state, 'active');
    assert.equal(key.publicKey, submitted);
  } finally { globalThis.fetch = real; }
});
