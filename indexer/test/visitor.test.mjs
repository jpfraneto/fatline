// Visitors cast with a key that stays in their browser (visitor.mjs). The node is faked; the Writer and the
// message building are the real ones, so what reaches the node is a real Farcaster message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519';
import { Message, MessageType } from '@farcaster/core';
import { makeVisitor } from '../src/visitor.mjs';
import { Writer } from '../src/writer.mjs';

const hex = (b) => `0x${Buffer.from(b).toString('hex')}`;
const bytes = (h) => Uint8Array.from(Buffer.from(h.slice(2), 'hex'));

function browser() {
  const priv = ed25519.utils.randomPrivateKey();
  return { publicKey: hex(ed25519.getPublicKey(priv)), sign: (hash) => hex(ed25519.sign(bytes(hash), priv)) };
}

function fakeNode() {
  const sent = [];
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'POST') {
      const m = Message.decode(new Uint8Array(init.body));
      sent.push(m);
      return new Response('{}', { status: 200 });
    }
    // Read back: the last cast sent is there.
    const last = sent.at(-1);
    return new Response(JSON.stringify({ data: {}, hash: last ? hex(last.hash) : null }), { status: 200 });
  };
  const network = { node: async () => ({ url: 'http://node.test' }) };
  return { sent, writer: async (net, node, key) => ({ w: new Writer({ network, key, fetchImpl, confirmMs: 500, pollMs: 20 }) }) };
}

test('a visitor casts: the server stops at the hash, the browser signs, the node gets their signed cast', async () => {
  const n = fakeNode();
  const v = makeVisitor({ config: {}, writer: n.writer, nodeFor: async () => ({ url: 'http://node.test' }) });
  const me = browser();
  const step = await v.act({ path: '/api/cast', fid: 977233, signer: me.publicKey, text: 'hello from my own key' });
  assert.equal(step.step, 'keysign');
  assert.match(step.hash, /^0x[0-9a-f]{40}$/);
  assert.equal(n.sent.length, 0, 'nothing sent before the browser signs');

  const out = await v.sign({ id: step.id, signature: me.sign(step.hash) });
  assert.equal(out.state, 'confirmed');
  assert.equal(n.sent.length, 1);
  const m = n.sent[0];
  assert.equal(m.data.fid, 977233);
  assert.equal(m.data.type, MessageType.CAST_ADD);
  assert.equal(m.data.castAddBody.text, 'hello from my own key');
  assert.equal(hex(m.signer), me.publicKey);
  assert.equal(hex(m.hash), step.hash);
  assert.ok(ed25519.verify(m.signature, m.hash, m.signer), 'the browser\'s signature, valid for the message');
  assert.equal(v.pending.size, 0);
});

test('a wrong signature never reaches the node; a used or unknown id is refused; only visitor actions', async () => {
  const n = fakeNode();
  const v = makeVisitor({ config: {}, writer: n.writer, nodeFor: async () => ({}) });
  const me = browser();
  const other = browser();
  const step = await v.act({ path: '/api/react', kind: 'like', fid: 5, signer: me.publicKey, hash: '0x' + 'ab'.repeat(20) });
  await assert.rejects(v.sign({ id: step.id, signature: other.sign(step.hash) }), /not this key's signature/);
  assert.equal(n.sent.length, 0);
  await assert.rejects(v.sign({ id: step.id, signature: me.sign(step.hash) }), /Nothing is waiting/);
  await assert.rejects(v.act({ path: '/api/resend', fid: 5, signer: me.publicKey }), /Not something a visitor can do/);
  await assert.rejects(v.act({ path: '/api/cast', fid: 5, signer: '0x12', text: 'x' }), /public key/);
  await assert.rejects(v.act({ path: '/api/cast', fid: 'me', signer: me.publicKey, text: 'x' }), /fid/);
});

test('the wallet that owns the account: two wallet signatures, then the key signs its own KEY_ADD in the browser', async () => {
  const me = browser();
  const submitted = [];
  const deps = {
    fidOfCustody: async (node, address) => (address === '0x' + '11'.repeat(20) ? 4242 : null),
    buildKeyAdd: async ({ fid, custody, appSigner }) => {
      const td = (primaryType) => ({ domain: { name: 'Farcaster', version: '1', chainId: 10n }, types: { [primaryType]: [{ name: 'fid', type: 'uint256' }] }, primaryType, message: { fid: BigInt(fid) } });
      const one = await custody.signTypedData(td('SignedKeyRequest'));
      const two = await custody.signTypedData(td('Add'));
      const hash = new Uint8Array(20).fill(7);
      const sig = (await appSigner.signMessageHash(hash)).value;
      return { message: { one, two, sig }, record: { publicKey: hex((await appSigner.getSignerKey()).value) } };
    },
    sendMessage: async (node, message) => { submitted.push(message); },
    waitForKey: async (node, fid, key) => key === me.publicKey,
  };
  const v = makeVisitor({ config: { defaultNetwork: 'farcaster' }, writer: null, nodeFor: async () => ({ url: 'http://node.test' }), deps });
  await assert.rejects(v.walletStart({ address: '0x' + '22'.repeat(20), signer: me.publicKey }), /does not own a Farcaster account/);

  let s = await v.walletStart({ address: '0x' + '11'.repeat(20), signer: me.publicKey });
  assert.equal(s.step, 'signing'); assert.equal(s.n, 1); assert.equal(s.fid, 4242);
  assert.equal(s.typedData.primaryType, 'SignedKeyRequest');
  const session = s.session;
  s = await v.walletSign({ session, signature: '0x' + 'aa'.repeat(65) });
  assert.equal(s.n, 2); assert.equal(s.typedData.primaryType, 'Add');
  s = await v.walletSign({ session, signature: '0x' + 'bb'.repeat(65) });
  assert.equal(s.step, 'keysign');
  assert.equal(submitted.length, 0);
  const done = await v.sign({ id: s.id, signature: me.sign(s.hash) });
  assert.deepEqual(done, { step: 'done', fid: 4242 });
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].one, '0x' + 'aa'.repeat(65));
  assert.ok(ed25519.verify(submitted[0].sig, new Uint8Array(20).fill(7), bytes(me.publicKey)));
  assert.deepEqual(v.walletStatus({ session }), { step: 'done', fid: 4242 });
});

test('the Farcaster app: a request for the browser\'s key, then done once this node shows it', async () => {
  const me = browser();
  let state = 'pending';
  const deps = {
    requestKey: async (config, key) => { assert.equal(key, me.publicKey); return { token: 'tok_123456', url: 'farcaster://signed-key-request?token=tok_123456' }; },
    keyRequestState: async () => ({ state, fid: state === 'completed' ? 99 : null }),
    waitForKey: async (node, fid, key) => fid === 99 && key === me.publicKey,
  };
  const v = makeVisitor({ config: {}, writer: null, nodeFor: async () => ({}), deps });
  const r = await v.qrStart({ signer: me.publicKey });
  assert.equal(r.token, 'tok_123456');
  assert.match(r.web, /token=tok_123456/);
  assert.match(r.qr, /<svg/);
  assert.deepEqual(await v.qrStatus({ token: r.token, signer: me.publicKey }), { step: 'waiting' });
  state = 'completed';
  assert.deepEqual(await v.qrStatus({ token: r.token, signer: me.publicKey }), { step: 'done', fid: 99 });
  await assert.rejects(v.qrStatus({ token: 'x' }), /token/);
});

test('which wallet holds an account: found from the name, before anyone is asked to sign; the phone gets a QR of this place', async () => {
  const me = browser();
  const deps = {
    custodyOfFid: async (node, fid) => (fid === 16098 ? '0xf2fe4dd9a86ecafe22424bfb6085036bca7835a8' : null),
    fidOfCustody: async (node, address, hint) => (hint === 16098 ? 16098 : null),
    buildKeyAdd: ({ custody }) => custody.signTypedData({ domain: { name: 'Farcaster' }, types: { X: [] }, primaryType: 'X', message: {} }).then(() => new Promise(() => {})),
  };
  const v = makeVisitor({ config: {}, writer: null, nodeFor: async () => ({}), deps,
    resolveUser: async (q) => { if (q.replace('@', '') !== 'jpfraneto') throw new Error('No account named that'); return { fid: 16098, username: 'jpfraneto' }; } });
  assert.deepEqual(await v.who({ q: '@jpfraneto' }), { fid: 16098, username: 'jpfraneto', displayName: null, pfp: null, custody: '0xf2fe4dd9a86ecafe22424bfb6085036bca7835a8' });
  await assert.rejects(v.who({ q: 'not a name!' }), /Farcaster name/);
  await assert.rejects(v.who({ q: 'nobody' }), /No account/);

  const s = await v.walletStart({ address: '0xf2fe4dd9a86ecafe22424bfb6085036bca7835a8', signer: me.publicKey, fid: 16098, link: 'https://fatline.fatline.ink/?sign=' });
  assert.equal(s.address, '0xf2fe4dd9a86ecafe22424bfb6085036bca7835a8');
  assert.equal(s.link, `https://fatline.fatline.ink/?sign=${s.session}`);
  assert.match(s.qr, /<svg/);
  const odd = await v.walletStart({ address: '0xf2fe4dd9a86ecafe22424bfb6085036bca7835a8', signer: me.publicKey, fid: 16098, link: 'javascript:alert(1)//?sign=' });
  assert.equal(odd.qr, undefined, 'only a plain http(s) page of a place');
});
