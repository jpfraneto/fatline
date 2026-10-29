import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { openDb } from '../src/db.mjs';
import { endpointId, healthNow, measure, normalizeEndpoint, parseRecord, proofFids, proveHost, readReference, recordText, Registry, RECORDS_URL, STALE_MS } from '../src/registry.mjs';
import { placesFrom } from '../src/server.mjs';

const FC_EPOCH_MS = 1_609_459_200_000;
const NOW = 1_793_300_000_000;
const OLD_FC = Math.floor((NOW - FC_EPOCH_MS) / 1000) - 3600; // an hour old: settled
const HEIGHTS = { 1: 49_956_828, 2: 49_792_068 };
const CAST = { fid: 77, hash: '0xabc0000000000000000000000000000000000001' };

const answer = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const info = (heights, extra = {}) => ({ version: '0.16.0', dbStats: { numMessages: 914_000_000 }, shardInfos: [{ shardId: 0, maxHeight: 1, blockDelay: 999 }, ...Object.entries(heights).map(([shardId, maxHeight]) => ({ shardId: Number(shardId), maxHeight, blockDelay: 0 }))], ...extra });

/**
 * A small internet: url prefix -> { heights, hypersnap, casts (true = holds the reference cast), down, refused, wellKnown }.
 * Anything not listed refuses the connection.
 */
function internet(hosts) {
  return async (url) => {
    const u = new URL(url);
    const origin = `${u.protocol}//${u.host}`;
    const h = hosts[origin];
    if (!h || h.refused) throw Object.assign(new Error('connect ECONNREFUSED'), { cause: { code: 'ECONNREFUSED' } });
    if (h.down) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    if (u.pathname === '/.well-known/fatline') return h.wellKnown != null ? answer(h.wellKnown) : answer('Not Found', 404);
    if (u.pathname === '/v1/info') return h.notNode ? answer('<html>hello</html>') : answer(info(h.heights ?? HEIGHTS));
    if (u.pathname === '/v2/farcaster/user/bulk') return h.hypersnap ? answer({ users: [{ fid: 3, username: 'dwr' }] }) : answer('Not Found', 404);
    if (u.pathname === '/v1/castsByFid') return answer({ messages: [{ hash: CAST.hash, data: { type: 'MESSAGE_TYPE_CAST_ADD', fid: Number(u.searchParams.get('fid')), timestamp: OLD_FC } }] });
    if (u.pathname === '/v1/castById') return h.casts === false ? answer('Not Found', 404) : answer({ hash: u.searchParams.get('hash') });
    return answer('Not Found', 404);
  };
}

const REF = { heights: HEIGHTS, casts: [CAST], from: ['http://127.0.0.1:3381'], at: NOW };

test('an endpoint is a public scheme, host and port, nothing else', () => {
  assert.equal(normalizeEndpoint('https://crackle.farcaster.xyz:3381/'), 'https://crackle.farcaster.xyz:3381');
  assert.equal(normalizeEndpoint('203.0.113.7:3381'), null); // a documentation range: not public
  assert.equal(normalizeEndpoint('46.225.208.199:3381'), 'http://46.225.208.199:3381');
  assert.equal(normalizeEndpoint('https://hub.example.com'), 'https://hub.example.com');
  for (const bad of ['http://127.0.0.1:3381', 'http://localhost:3381', 'http://10.0.0.4:3381', 'http://169.254.169.254', 'https://x.com/path', 'https://u:p@x.com', 'ftp://x.com', 'http://intranet', 'https://x.com/?a=1', 'http://[::1]:3381', '']) {
    assert.equal(normalizeEndpoint(bad), null, bad);
  }
  assert.equal(endpointId('https://crackle.farcaster.xyz:3381'), 'crackle-farcaster-xyz-3381');
  assert.equal(endpointId('https://haatz.quilibrium.com'), 'haatz-quilibrium-com');
});

test('a record is lines of key: value; a comment is not a record', () => {
  const r = parseRecord('fatline node\nnode: http://46.225.208.199:4381\nclient: https://fatline.fatline.ink\nname: Aster <b>\nusdc: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\ncost: $25 a month\nnode: http://10.0.0.1:3381');
  assert.deepEqual(r.nodes, ['http://46.225.208.199:4381']); // the private one is dropped
  assert.deepEqual(r.clients, ['https://fatline.fatline.ink']);
  assert.equal(r.name, 'Aster b');
  assert.equal(r.costMonthUsd, 25);
  assert.equal(r.usdc, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  assert.equal(parseRecord('love this! running mine soon'), null);
  assert.equal(recordText({ node: 'http://46.225.208.199:4381', clients: ['https://a.example'] }), 'fatline node\nnode: http://46.225.208.199:4381\nclient: https://a.example');
  assert.deepEqual(parseRecord(recordText({ node: 'https://hub.example.com', clients: ['https://a.example.com'], name: 'Hub' })).clients, ['https://a.example.com']);
});

test('a proof names the FID: a file or a TXT record', async () => {
  assert.deepEqual(proofFids('fid: 16098\n'), [16098]);
  assert.deepEqual(proofFids('{"fids":[1,2]}'), [1, 2]);
  assert.deepEqual(proofFids('nothing'), []);
  const net = internet({ 'https://hub.example.com': { wellKnown: 'fid: 42' }, 'http://46.225.208.199': { wellKnown: 'fid=9' } });
  assert.equal((await proveHost('https://hub.example.com:3381', 42, { fetchImpl: net, resolveTxt: async () => [] })).method, 'well-known');
  assert.equal((await proveHost('http://46.225.208.199:3381', 9, { fetchImpl: net })).ok, true);
  const no = await proveHost('https://hub.example.com:3381', 7, { fetchImpl: net, resolveTxt: async () => [] });
  assert.equal(no.ok, false);
  assert.ok(no.tried.some((t) => /names FID 42/.test(t)));
  const dns = await proveHost('https://other.example.com', 7, { fetchImpl: internet({}), resolveTxt: async (name) => (name === '_fatline.other.example.com' ? [['fid=7']] : []) });
  assert.deepEqual([dns.ok, dns.method], [true, 'dns']);
});

test('measuring: synced, behind, invalid, unreachable, and the network is measured, not claimed', async () => {
  const net = internet({
    'http://a.example.com:3381': {},
    'http://h.example.com:4381': { hypersnap: true },
    'http://late.example.com:3381': { heights: { 1: HEIGHTS[1] - 5000, 2: HEIGHTS[2] } },
    'http://empty.example.com:3381': { casts: false },
    'http://web.example.com': { notNode: true },
    'http://gone.example.com:3381': { down: true },
  });
  const now = () => NOW;
  const refs = { snapchain: REF, hypersnap: REF };
  const a = await measure('http://a.example.com:3381', refs, { fetchImpl: net, now });
  assert.deepEqual([a.state, a.network, a.dataCheck, a.behindBlocks], ['synced', 'snapchain', true, 0]);
  assert.equal((await measure('http://h.example.com:4381', refs, { fetchImpl: net, now })).network, 'hypersnap');
  const late = await measure('http://late.example.com:3381', refs, { fetchImpl: net, now });
  assert.deepEqual([late.state, late.behindBlocks], ['behind', 5000]);
  assert.equal((await measure('http://empty.example.com:3381', refs, { fetchImpl: net, now })).state, 'invalid');
  assert.equal((await measure('http://web.example.com', refs, { fetchImpl: net, now })).state, 'invalid');
  assert.equal((await measure('http://gone.example.com:3381', refs, { fetchImpl: net, now })).state, 'unreachable');
  assert.equal((await measure('http://nobody.example.com:3381', refs, { fetchImpl: net, now })).reason, 'the machine answered, but nothing listens on that port');
  // No reference for its network: nothing can be judged.
  assert.equal((await measure('http://h.example.com:4381', { snapchain: REF }, { fetchImpl: net, now })).state, 'unknown');
});

test('the reference: the highest height among this server\'s nodes, and settled casts to ask for', async () => {
  const net = internet({ 'http://127.0.0.1:3381': { heights: { 1: 10, 2: 20 } }, 'https://crackle.farcaster.xyz:3381': { heights: { 1: 12, 2: 19 } } });
  const ref = await readReference(['http://127.0.0.1:3381', 'https://crackle.farcaster.xyz:3381', 'http://down.example:1'], { fetchImpl: net, now: () => NOW });
  assert.deepEqual(ref.heights, { 1: 12, 2: 20 });
  assert.equal(ref.casts.length, 1); // the fake has one cast for every FID
});

test('old measurements are stale, never shown as now', () => {
  const m = { at: NOW - STALE_MS - 1, state: 'synced', reason: 'ok' };
  assert.equal(healthNow(m, { now: NOW }).state, 'stale');
  assert.equal(healthNow(m, { now: NOW }).measured, 'synced');
  assert.equal(healthNow({ ...m, at: NOW - 60_000 }, { now: NOW }).state, 'synced');
  assert.equal(healthNow(null).state, 'unknown');
});

/** A node that holds the records: castsByParent under fatline.ink/nodes. */
const recordsNetwork = (casts) => ({
  name: 'farcaster',
  get: async (path, q) => {
    assert.equal(path, '/v1/castsByParent');
    assert.equal(q.url, RECORDS_URL);
    return { data: { messages: casts.map((c, i) => ({ hash: `0x${String(i + 1).padStart(40, '0')}`, data: { type: 'MESSAGE_TYPE_CAST_ADD', fid: c.fid, timestamp: OLD_FC + i, castAddBody: { text: c.text, parentUrl: RECORDS_URL } } })) } };
  },
});

function registry({ casts = [], places = [], hosts = {}, ...rest } = {}) {
  let now = NOW;
  const net = internet({ 'http://127.0.0.1:3381': {}, 'http://127.0.0.1:4381': { hypersnap: true }, ...hosts });
  const r = new Registry({
    db: openDb(tmpdir(), ':memory:'), networks: { farcaster: recordsNetwork(casts) },
    references: { snapchain: ['http://127.0.0.1:3381'], hypersnap: ['http://127.0.0.1:4381'] },
    places: async () => places, users: async (fid) => ({ username: `user${fid}`, pfp: null }),
    fetchImpl: net, refFetch: net, prove: (url, fid) => proveHost(url, fid, { fetchImpl: net, resolveTxt: async () => [] }), now: () => now, random: () => 0.5, ...rest,
  });
  r.tick = (ms) => { now += ms; };
  return r;
}

test('a round: places by their eggs, records by their proofs, a claim on someone else\'s node is not listed', async () => {
  const r = registry({
    places: [{ fid: 16098, tokenFid: 16098, surname: 'FATLINE', stage: 'fatliner', node: 'http://46.225.208.199:3381', client: 'https://fatline.fatline.ink', coin: '0xc0', vault: '0xa0', earned: 7.43 }],
    casts: [
      { fid: 16098, text: 'fatline node\nnode: http://46.225.208.199:4381' }, // same host as the egg: covered
      { fid: 500, text: 'fatline node\nnode: https://hub.example.com:3381\nclient: https://app.example.com\nname: Example\ncost: 30' },
      { fid: 666, text: 'fatline node\nnode: http://46.225.208.199:3381' }, // someone else's node
      { fid: 667, text: 'node: https://nope.example.com:3381' }, // no proof
      { fid: 1, text: 'nice' },
    ],
    hosts: {
      'http://46.225.208.199:3381': {}, 'http://46.225.208.199:4381': { hypersnap: true },
      'https://hub.example.com:3381': {}, 'https://hub.example.com': { wellKnown: 'fid: 500' }, 'https://app.example.com': { wellKnown: '{"fid":500}' },
      'https://nope.example.com:3381': {},
    },
  });
  await r.round();
  const all = r.list(new URLSearchParams('include=unproven'));
  assert.deepEqual(all.nodes.map((n) => n.id).sort(), ['46-225-208-199-3381', '46-225-208-199-4381', 'hub-example-com-3381']);
  const aster = all.nodes.find((n) => n.id === '46-225-208-199-3381');
  assert.equal(aster.operator.fid, 16098);
  assert.equal(aster.proof.method, 'egg');
  assert.equal(aster.fatliner.surname, 'FATLINE');
  assert.equal(aster.funding.earnedUsdc, 7.43);
  assert.equal(aster.health.state, 'synced');
  assert.equal(all.nodes.find((n) => n.id === '46-225-208-199-4381').network, 'hypersnap');
  const hub = all.nodes.find((n) => n.id === 'hub-example-com-3381');
  assert.deepEqual([hub.name, hub.operator.username, hub.proof.method, hub.funding.costMonthUsd], ['Example', 'user500', 'well-known', 30]);
  assert.deepEqual(hub.clients.map((c) => c.url), ['https://app.example.com']);
  assert.deepEqual(all.clients.map((c) => c.url).sort(), ['https://app.example.com', 'https://fatline.fatline.ink']);
  assert.deepEqual(all.unproven.map((u) => [u.fid, u.why]).sort(), [[666, 'listed under another account'], [667, 'no proof at its host yet']]);
  assert.equal(r.list().unproven, undefined); // only when asked

  // Filters a developer uses.
  assert.deepEqual(r.list(new URLSearchParams('network=hypersnap')).nodes.map((n) => n.id), ['46-225-208-199-4381']);
  assert.equal(r.list(new URLSearchParams('healthy=true')).nodes.length, 3);
  assert.throws(() => r.list(new URLSearchParams('network=bitcoin')), /snapchain or hypersnap/);
  const one = r.get('hub-example-com-3381');
  assert.equal(one.kind, 'node');
  assert.equal(one.history.length, 1);
  assert.equal(r.get('app-example-com').kind, 'client');
  assert.throws(() => r.get('nothing-here'), /Nothing with that id/);

  // Two hours and a half later with no round: stale, not synced.
  r.tick(STALE_MS + 1);
  assert.equal(r.get('hub-example-com-3381').health.state, 'stale');
  assert.equal(r.list(new URLSearchParams('healthy=true')).nodes.length, 0);
});

test('a node that goes down shows unreachable on the next round; its cast deleted, it leaves', async () => {
  const hosts = { 'https://hub.example.com:3381': {}, 'https://hub.example.com': { wellKnown: 'fid: 500' } };
  const casts = [{ fid: 500, text: 'node: https://hub.example.com:3381' }];
  const r = registry({ casts, hosts });
  await r.round();
  assert.equal(r.get('hub-example-com-3381').health.state, 'synced');
  hosts['https://hub.example.com:3381'].down = true;
  r.tick(3600_000);
  await r.round();
  const h = r.get('hub-example-com-3381');
  assert.equal(h.health.state, 'unreachable');
  assert.equal(h.health.lastSyncedAt, NOW);
  assert.deepEqual(h.history.map((x) => x.state), ['unreachable', 'synced']);
  casts.length = 0;
  r.tick(3600_000);
  await r.round();
  assert.equal(r.list().nodes.length, 0);
});

test('the join page check: measures, looks for the proof, writes the record; one look per address a minute', async () => {
  let looks = 0;
  const base = internet({ 'http://46.225.208.199:3381': {}, 'http://46.225.208.199': { wellKnown: 'fid: 42' }, 'http://127.0.0.1:3381': {} });
  const r = registry({ fetchImpl: async (u, o) => { if (u.endsWith('/v1/info')) looks++; return base(u, o); } });
  r.fetchImpl = async (u, o) => { if (u.endsWith('/v1/info')) looks++; return base(u, o); };
  r.prove = (url, fid) => proveHost(url, fid, { fetchImpl: base });
  r.refFetch = base;
  const c = await r.check({ url: '46.225.208.199:3381', fid: '42' });
  assert.equal(c.node.health.state, 'synced');
  assert.equal(c.node.health.network, 'snapchain');
  assert.equal(c.node.proof.ok, true);
  assert.equal(c.record, 'fatline node\nnode: http://46.225.208.199:3381');
  assert.equal(c.proofFile, 'fid: 42');
  assert.equal(c.wellKnown, 'http://46.225.208.199/.well-known/fatline');
  assert.equal(c.dns, null); // an IP has no DNS name to hold a TXT record
  const n = looks;
  await r.check({ url: 'http://46.225.208.199:3381', fid: 42 });
  assert.equal(looks, n); // the same answer, from a minute's memory
  await assert.rejects(r.check({ url: 'http://192.168.1.10:3381' }), /not a public address/);
  await assert.rejects(r.check({}), /url/);
});

test('places come from the first hatchery that answers: its world, each egg\'s node, each name', async () => {
  const fetchImpl = async (url) => {
    const p = new URL(url).pathname;
    if (p === '/world') return answer({ tokens: [{ fid: 16098, linkedFid: 16098, stage: 'fatliner', surname: 'FATLINE', coin: '0xc0', vault: '0xa0', earned: 7 }, { fid: 9, stage: 'none' }] });
    if (p === '/names') return answer({ names: [{ label: 'fatline', fid: 16098 }] });
    if (p === '/eggs/16098') return answer({ node: 'http://46.225.208.199:3381', network: 'farcaster' });
    return answer({}, 404);
  };
  const places = await placesFrom(async () => [{ url: 'http://down.example:8791' }, { url: 'http://46.225.208.199:8791' }], {
    fetchImpl: async (url, o) => (url.startsWith('http://down') ? answer({}, 500) : fetchImpl(url, o)),
  })();
  assert.deepEqual(places, [{ fid: 16098, tokenFid: 16098, surname: 'FATLINE', stage: 'fatliner', node: 'http://46.225.208.199:3381', network: 'farcaster', client: 'https://fatline.fatline.ink', coin: '0xc0', vault: '0xa0', earned: 7, being: null }]);
});

test('a flood of records can\'t stall a round: an account\'s latest 4 count, and proof lookups are capped', async () => {
  const casts = [];
  for (let i = 0; i < 30; i++) casts.push({ fid: 900, text: `node: https://n${i}.example.com:3381` });
  for (let i = 0; i < 80; i++) casts.push({ fid: 1000 + i, text: `node: https://m${i}.example.com:3381` });
  let asked = 0;
  const r = registry({ casts, prove: async () => { asked++; return { ok: false, tried: [] }; } });
  await r.round();
  assert.equal(asked, 60);
  const flood = r.list(new URLSearchParams('include=unproven')).unproven.filter((u) => u.fid === 900);
  assert.deepEqual(flood.map((u) => u.url), ['https://n26.example.com:3381', 'https://n27.example.com:3381', 'https://n28.example.com:3381', 'https://n29.example.com:3381']);
});
