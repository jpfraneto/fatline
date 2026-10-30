import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontier, makeAround } from '../src/around.mjs';

const ME = 7;
const EPOCH = 1609459200;
const ms = (fc) => (fc + EPOCH) * 1000;
const cast = (fid, ts, extra = {}) => ({ hash: `0x${fid}c${ts}`, data: { type: 'MESSAGE_TYPE_CAST_ADD', fid, timestamp: ts, castAddBody: { text: `t${ts}`, ...extra } } });
const react = (fid, ts, type = 'REACTION_TYPE_LIKE') => ({ data: { type: 'MESSAGE_TYPE_REACTION_ADD', fid, timestamp: ts, reactionBody: { type } } });

// A node, in memory: lists newest first, two to a page, with page tokens like a real node.
function fakeNode() {
  const mine = [100, 90, 80, 70, 60, 50].map((ts) => cast(ME, ts));
  const mentions = [95, 85, 55, 10].map((ts) => cast(20 + ts, ts, { mentions: [ME] }));
  const follows = [99, 61, 5].map((ts) => ({ data: { type: 'MESSAGE_TYPE_LINK_ADD', fid: 300 + ts, timestamp: ts, linkBody: { type: 'follow', targetFid: ME } } }));
  const page = (list, token) => { const at = Number(token ?? 0); const next = at + 2 < list.length ? String(at + 2) : ''; return { messages: list.slice(at, at + 2), nextPageToken: next }; };
  const reactions = { '0x7c100': [react(41, 101), react(ME, 102), react(42, 103, 'REACTION_TYPE_RECAST')], '0x7c50': [react(43, 200)] }; // a like today on an old cast
  return {
    name: 'farcaster',
    get: async (path, p) => {
      if (path === '/v1/castsByFid') return { data: page(mine, p.pageToken) };
      if (path === '/v1/castsByMention') return { data: page(mentions, p.pageToken) };
      if (path === '/v1/linksByTargetFid') return { data: page(follows, p.pageToken) };
      if (path === '/v1/castsByParent') return { data: { messages: p.hash === '0x7c80' ? [cast(11, 81), cast(ME, 82)] : [] } }; // your own reply is not news
      if (path === '/v1/reactionsByCast') return { data: { messages: reactions[p.target_hash] ?? [] } };
      if (path === '/v1/castById') return { data: null };
      throw new Error(`unexpected ${path}`);
    },
  };
}

const apiFor = (network) => ({ network: () => network, renderCasts: async (n, c) => c, usersFor: async (n, fids) => Object.fromEntries(fids.map((f) => [f, { username: `u${f}` }])) });

test('around: everything once, newest first across pages, then the end', async () => {
  const around = makeAround({ api: apiFor(fakeNode()), castsPerStretch: 2 });
  const all = [];
  let before = null;
  for (let i = 0; i < 30; i++) {
    const p = await around('farcaster', ME, { before, limit: 3 });
    all.push(...p.items);
    before = p.next;
    if (!before) break;
  }
  assert.equal(before, null, 'it ends once history runs out');
  assert.deepEqual(all.map((e) => e.at), [...all.map((e) => e.at)].sort((a, b) => b - a), 'newest first, across every page');
  assert.equal(new Set(all.map((e) => e.key)).size, all.length, 'nothing twice');
  const kinds = all.map((e) => `${e.kind}@${(e.at / 1000) - EPOCH}`);
  // The like at 200 is on your oldest cast, read only after the flow had passed that moment: it is not shown (the
  // limit of reading a node without an index of reactions to you). Everything else is, in order.
  assert.deepEqual(kinds, ['recast@103', 'like@101', 'follow@99', 'mention@95', 'mention@85', 'reply@81', 'follow@61', 'mention@55', 'mention@10', 'follow@5']);
  assert.equal(all.find((e) => e.kind === 'reply').yours.id, '0x7c80', 'a reply says which cast of yours');
});

test('around: the top is read again behind the scenes; a page reaches only as far as it is complete', async () => {
  let t = 0;
  const around = makeAround({ api: apiFor(fakeNode()), castsPerStretch: 2, now: () => t });
  const first = await around('farcaster', ME, { limit: 2 });
  assert.equal(first.items.length, 2);
  assert.ok(first.items.every((e, i, a) => !i || a[i - 1].at >= e.at));
  t += 60_000;
  const stale = await around('farcaster', ME, { limit: 2 });
  assert.equal(stale.at, first.at, 'after a minute it still answers at once, from what it read');
  await new Promise((r) => setTimeout(r, 20)); // while the top is read again behind the scenes
  const again = await around('farcaster', ME, { limit: 2 });
  assert.ok(again.at > first.at, 'then the fresh reading takes over');
});

test('frontier: two newest-first runs (one per shard) are complete down to the newer of their ends', () => {
  const m = (ts) => ({ data: { timestamp: ts } });
  assert.equal(frontier([m(90), m(80), m(70), m(60), m(50)]), ms(50));
  assert.equal(frontier([m(90), m(30), m(85), m(75)]), ms(75));
  assert.equal(frontier([]), null);
});

test('around: a bad cursor or account is refused', async () => {
  const around = makeAround({ api: apiFor(fakeNode()) });
  await assert.rejects(around('farcaster', 'x'), /Which account/);
  await assert.rejects(around('farcaster', ME, { before: '%%%' }), /not one this server made/);
});
