import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildServer } from '../src/server.mjs';
import { saveAppKey } from '../src/writer.mjs';

function serve({ withKey = true, token = null } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'write-'));
  if (withKey) saveAppKey(dataDir, { fid: 18350, privateKey: `0x${randomBytes(32).toString('hex')}`, publicKey: '0x00', network: 'farcaster', scopes: [] });
  if (token) writeFileSync(join(dataDir, 'write.token'), token);
  const submitted = [];
  // A node that accepts everything and shows it right away.
  const network = { node: async () => ({ url: 'http://node.test', own: true }) };
  globalThis.__realFetch ??= globalThis.fetch;
  const config = { dataDir, appDir: join(dataDir, 'none'), networks: { farcaster: {} }, defaultNetwork: 'farcaster' };
  const server = buildServer({ config, networks: { farcaster: network }, voices: { status: () => ({}) }, launchpad: { status: () => ({}) } });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done({ server, url: `http://127.0.0.1:${server.address().port}`, submitted })));
}

const post = (url, body, headers = {}) => globalThis.__realFetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('without an app key, posting explains how to get one', async () => {
  const { server, url } = await serve({ withKey: false });
  try {
    const res = await post(`${url}/api/cast`, { text: 'hi' });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /identity/);
  } finally { server.close(); }
});

test('other websites cannot post through this client', async () => {
  const { server, url } = await serve();
  try {
    assert.equal((await post(`${url}/api/cast`, { text: 'hi' }, { origin: 'https://evil.example' })).status, 401);
    assert.equal((await post(`${url}/api/cast`, { text: 'hi' }, { origin: 'null' })).status, 401);
    const plain = await globalThis.__realFetch(`${url}/api/cast`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"text":"hi"}' });
    assert.equal(plain.status, 401);
    assert.equal((await post(`${url}/api/cast`, { text: 'hi' }, { 'x-forwarded-for': '1.2.3.4' })).status, 401, 'behind a proxy, a token is needed');
  } finally { server.close(); }
});

test('behind a proxy, the write token lets the owner post', async () => {
  const { server, url } = await serve({ token: 'secret-token-123' });
  try {
    const wrong = await post(`${url}/api/cast`, { text: '' }, { 'x-forwarded-for': '1.2.3.4', authorization: 'Bearer nope-nope-nope-12' });
    assert.equal(wrong.status, 401);
    const right = await post(`${url}/api/cast`, { text: '' }, { 'x-forwarded-for': '1.2.3.4', authorization: 'Bearer secret-token-123' });
    assert.equal(right.status, 400, 'allowed through, then refused only because the cast is empty');
    const me = await (await globalThis.__realFetch(`${url}/api/me`)).json();
    assert.equal(me.fid, 18350);
    assert.equal(me.canWrite, true);
    assert.equal(me.privateKey, undefined, 'the private key never leaves the server');
  } finally { server.close(); }
});

test("while your node catches up, a cast goes through a node in sync, and the reply says so", async () => {
  const { Network } = await import('../src/hub.mjs');
  const { Message } = await import('@farcaster/core');
  const info = (behind) => ({ shardInfos: [{ shardId: 1, maxHeight: 100, blockDelay: behind }, { shardId: 2, maxHeight: 100, blockDelay: behind }], dbStats: {} });
  const seen = { 'http://own.test': [], 'http://public.test': [] };
  const stored = new Set();
  const fake = async (input, init = {}) => {
    const u = new URL(String(input));
    const base = `${u.protocol}//${u.host}`;
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status });
    if (u.pathname === '/v1/info') return json(info(base === 'http://own.test' ? 5000 : 0));
    if (u.pathname === '/v1/submitMessage') {
      seen[base].push(1);
      const m = Message.decode(new Uint8Array(init.body));
      stored.add(`0x${Buffer.from(m.hash).toString('hex')}`);
      return json({ hash: `0x${Buffer.from(m.hash).toString('hex')}` });
    }
    if (u.pathname === '/v1/castById') return stored.has(u.searchParams.get('hash')) ? json({ data: {}, hash: u.searchParams.get('hash') }) : json({ error: 'nf' }, 400);
    return json({}, 404);
  };
  const realFetch = globalThis.__realFetch ?? globalThis.fetch;
  globalThis.__realFetch = realFetch;
  globalThis.fetch = fake;
  const net = new Network('farcaster', { nodes: [{ url: 'http://own.test', own: true, label: 'Your node' }, { url: 'http://public.test', label: 'crackle' }] }, { fetchImpl: fake });
  const dataDir = mkdtempSync(join(tmpdir(), 'write-'));
  saveAppKey(dataDir, { fid: 18350, privateKey: `0x${randomBytes(32).toString('hex')}`, publicKey: '0x00', network: 'farcaster', scopes: [] });
  const config = { dataDir, appDir: join(dataDir, 'none'), networks: { farcaster: {} }, defaultNetwork: 'farcaster' };
  const server = buildServer({ config, networks: { farcaster: net }, voices: { status: () => ({}) }, launchpad: { status: () => ({}) } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await realFetch(`http://127.0.0.1:${server.address().port}/api/cast`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hello while syncing', node: 'http://own.test' }) });
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.equal(out.state, 'confirmed');
    assert.equal(out.via.node, 'http://public.test');
    assert.match(out.via.because, /5000 blocks behind/);
    assert.equal(seen['http://own.test'].length, 0);
    assert.equal(seen['http://public.test'].length, 1);
  } finally {
    server.close();
    globalThis.fetch = realFetch;
  }
});
