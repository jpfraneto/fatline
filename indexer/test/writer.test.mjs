import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  FarcasterNetwork, Message, MessageType, NobleEd25519Signer, ViemLocalEip712Signer,
  getFarcasterTime, makeKeyAdd, makeKeyAddBody,
} from '@farcaster/core';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { SCOPES } from '../src/identity.mjs';
import { Writer, linkEmbeds, withMentions } from '../src/writer.mjs';

const hex = (b) => `0x${Buffer.from(b).toString('hex')}`;

/** A fake Snapchain node: stores submitted messages, and only "includes" them after `delay` reads. */
function fakeNode({ delay = 1, refuse = null } = {}) {
  const store = new Map(); // read-back key -> message hash
  const submitted = [];
  let reads = 0;
  const keyOf = (data) => {
    if (data.castAddBody) return `cast:${data.fid}:${hex(data.hash ?? [])}`;
    return null;
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/v1/submitMessage') {
      if (refuse) return new Response(JSON.stringify({ errCode: 'bad_request.validation_failure', details: refuse }), { status: 400 });
      const m = Message.decode(new Uint8Array(init.body));
      submitted.push(m);
      const d = m.data;
      const t = d.type;
      if (t === MessageType.CAST_ADD) store.set(`cast:${d.fid}:${hex(m.hash)}`, hex(m.hash));
      if (t === MessageType.CAST_REMOVE) store.delete(`cast:${d.fid}:${hex(d.castRemoveBody.targetHash)}`);
      if (t === MessageType.REACTION_ADD) store.set(`reaction:${d.fid}:${d.reactionBody.type}:${hex(d.reactionBody.targetCastId.hash)}`, hex(m.hash));
      if (t === MessageType.REACTION_REMOVE) store.delete(`reaction:${d.fid}:${d.reactionBody.type}:${hex(d.reactionBody.targetCastId.hash)}`);
      if (t === MessageType.LINK_ADD) store.set(`link:${d.fid}:${d.linkBody.targetFid}`, hex(m.hash));
      if (t === MessageType.LINK_REMOVE) store.delete(`link:${d.fid}:${d.linkBody.targetFid}`);
      return new Response(JSON.stringify({ hash: hex(m.hash) }), { status: 200 });
    }
    reads += 1;
    if (reads <= delay) return new Response(JSON.stringify({ error: 'Failed to get cast', error_detail: 'status: NotFound, message: "cast not found"' }), { status: 400 }); // how Snapchain says "not found"
    const p = Object.fromEntries(u.searchParams);
    let key;
    if (u.pathname === '/v1/castById') key = `cast:${p.fid}:${p.hash}`;
    if (u.pathname === '/v1/reactionById') key = `reaction:${p.fid}:${p.reaction_type === 'Recast' ? 2 : 1}:${p.target_hash}`;
    if (u.pathname === '/v1/linkById') key = `link:${p.fid}:${p.target_fid}`;
    const hash = store.get(key);
    return hash ? new Response(JSON.stringify({ data: {}, hash }), { status: 200 }) : new Response(JSON.stringify({ error: 'Failed to get cast', error_detail: 'status: NotFound, message: "cast not found"' }), { status: 400 });
  };
  return { fetchImpl, submitted, network: { node: async () => ({ url: 'http://node.test', own: true }) } };
}

const appKey = () => ({ fid: 18350, privateKey: hex(randomBytes(32)) });

test('a cast is signed, submitted once, and confirmed by reading it back', async () => {
  const node = fakeNode({ delay: 2 });
  const writer = new Writer({ network: node.network, key: appKey(), fetchImpl: node.fetchImpl, pollMs: 1 });
  const result = await writer.cast({ text: 'hello from my own node' });
  assert.equal(result.state, 'confirmed');
  assert.equal(node.submitted.length, 1);
  assert.equal(node.submitted[0].data.castAddBody.text, 'hello from my own node');
  assert.equal(node.submitted[0].data.fid, 18350);
});

test('https links in a cast become embeds, so apps show a preview card', async () => {
  assert.deepEqual(linkEmbeds('read https://fatline.ink/docs. then https://fatline.ink/docs, and https://a.b/c) http://no.pe'), [{ url: 'https://fatline.ink/docs' }, { url: 'https://a.b/c' }]);
  assert.deepEqual(linkEmbeds('no links, fatline.ink/docs'), []);
  const node = fakeNode();
  const writer = new Writer({ network: node.network, key: appKey(), fetchImpl: node.fetchImpl, pollMs: 1 });
  await writer.cast({ text: 'come build it https://fatline.ink/docs' });
  assert.deepEqual(node.submitted[0].data.castAddBody.embeds.map((e) => e.url), ['https://fatline.ink/docs']);
});

test('casts over 320 bytes go out as long casts (up to 1024)', async () => {
  const node = fakeNode();
  const writer = new Writer({ network: node.network, key: appKey(), fetchImpl: node.fetchImpl, pollMs: 1 });
  await writer.cast({ text: 'short' });
  await writer.cast({ text: 'x'.repeat(500) });
  assert.deepEqual(node.submitted.map((m) => m.data.castAddBody.type), [0, 1]);
});

test('replies point at their parent', async () => {
  const node = fakeNode();
  const writer = new Writer({ network: node.network, key: appKey(), fetchImpl: node.fetchImpl, pollMs: 1 });
  const parent = { fid: 3, hash: '0x' + 'ab'.repeat(20) };
  await writer.cast({ text: 'a reply', parent });
  assert.equal(node.submitted[0].data.castAddBody.parentCastId.fid, 3);
  assert.equal(hex(node.submitted[0].data.castAddBody.parentCastId.hash), parent.hash);
});

test('a cast can live under a URL: a node record under fatline.ink/nodes', async () => {
  const node = fakeNode();
  const writer = new Writer({ network: node.network, key: appKey(), fetchImpl: node.fetchImpl, pollMs: 1 });
  await writer.cast({ text: 'fatline node\nnode: https://hub.example.com:3381', parent: { url: 'https://fatline.ink/nodes' } });
  assert.equal(node.submitted[0].data.castAddBody.parentUrl, 'https://fatline.ink/nodes');
  assert.equal(node.submitted[0].data.castAddBody.parentCastId, undefined);
  await assert.rejects(writer.cast({ text: 'x', parent: { url: 'javascript:alert(1)' } }), /parent.url/);
});

test('a quote embeds the cast it quotes, first, and may say nothing else', async () => {
  const node = fakeNode();
  const writer = new Writer({ network: node.network, key: appKey(), fetchImpl: node.fetchImpl, pollMs: 1 });
  const quote = { fid: 3, hash: '0x' + 'ab'.repeat(20) };
  await writer.cast({ text: 'look https://a.example/1 https://b.example/2', quote });
  const body = node.submitted[0].data.castAddBody;
  assert.equal(body.embeds.length, 2);
  assert.equal(body.embeds[0].castId.fid, 3);
  assert.equal(body.embeds[1].url, 'https://a.example/1');
  await writer.cast({ text: '', quote });
  assert.equal(node.submitted[1].data.castAddBody.embeds[0].castId.fid, 3);
  await assert.rejects(writer.cast({ text: '' }), /Write something/);
});

test('like, unlike, follow, unfollow and delete are each confirmed', async () => {
  const node = fakeNode();
  const writer = new Writer({ network: node.network, key: appKey(), fetchImpl: node.fetchImpl, pollMs: 1 });
  const target = { fid: 3, hash: '0x' + 'cd'.repeat(20) };
  assert.equal((await writer.react({ ...target })).state, 'confirmed');
  assert.equal((await writer.react({ ...target, remove: true })).state, 'confirmed');
  assert.equal((await writer.react({ kind: 'recast', ...target })).state, 'confirmed');
  assert.equal((await writer.follow({ fid: 3 })).state, 'confirmed');
  assert.equal((await writer.follow({ fid: 3, remove: true })).state, 'confirmed');
  const cast = await writer.cast({ text: 'soon gone' });
  assert.equal((await writer.deleteCast({ hash: cast.hash })).state, 'confirmed');
});

test('a message the node has not included yet is reported as pending, with the exact bytes to resend', async () => {
  const node = fakeNode({ delay: 1_000_000 });
  const writer = new Writer({ network: node.network, key: appKey(), fetchImpl: node.fetchImpl, pollMs: 1, confirmMs: 30 });
  const result = await writer.cast({ text: 'slow' });
  assert.equal(result.state, 'pending');
  await writer.resend(result.message);
  assert.equal(hex(node.submitted[1].hash), result.hash, 'the resend is the same signed message');
});

test('refusals and oversized casts are explained, not swallowed', async () => {
  const node = fakeNode({ refuse: 'invalid signer' });
  const writer = new Writer({ network: node.network, key: appKey(), fetchImpl: node.fetchImpl, pollMs: 1 });
  await assert.rejects(writer.cast({ text: 'x' }), /invalid signer/);
  await assert.rejects(writer.cast({ text: 'é'.repeat(513) }), /1024 bytes/);
  await assert.rejects(writer.cast({ text: '   ' }), /Write something/);
});

test('a KEY_ADD is signed by the custody address and scoped to social actions only', async () => {
  const custody = privateKeyToAccount(generatePrivateKey());
  const appSigner = new NobleEd25519Signer(randomBytes(32));
  const key = (await appSigner.getSignerKey())._unsafeUnwrap();
  const body = await makeKeyAddBody(
    { fid: 18350n, key, scopes: SCOPES, ttl: 90 * 86400, nonce: 1, deadline: getFarcasterTime()._unsafeUnwrap() + 3600 },
    new ViemLocalEip712Signer(custody),
  );
  assert.ok(body.isOk(), body.isErr() ? body.error.message : '');
  const message = await makeKeyAdd(body.value, { fid: 18350, network: FarcasterNetwork.MAINNET }, appSigner);
  assert.ok(message.isOk());
  assert.ok(!SCOPES.includes(MessageType.KEY_ADD) && !SCOPES.includes(MessageType.KEY_REMOVE));
});

test('@names become mentions where Farcaster keeps them; unknown names, emails and links stay text', async () => {
  const fids = { fatline: 1312263, dwr: 3 };
  const lookup = async (name) => fids[name] ?? null;
  const a = await withMentions('hey @fatline help me understand how to set one up', lookup);
  assert.deepEqual(a, { text: 'hey  help me understand how to set one up', mentions: [1312263], mentionsPositions: [4] });
  const b = await withMentions('@dwr and @nobody, ñ @fatline. me@mail.com https://x.com/@dwr', lookup);
  assert.equal(b.text, ' and @nobody, ñ . me@mail.com https://x.com/@dwr');
  assert.deepEqual(b.mentions, [3, 1312263]);
  assert.deepEqual(b.mentionsPositions, [0, Buffer.byteLength(' and @nobody, ñ ')], 'byte positions, not characters');
});
