import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAround } from '../src/around.mjs';

const ME = 7;
const cast = (fid, ts, extra = {}) => ({ hash: `0x${fid}c${ts}`, data: { type: 'MESSAGE_TYPE_CAST_ADD', fid, timestamp: ts, castAddBody: { text: `t${ts}`, ...extra } } });

// A node, in memory: lists come newest first, two to a page, with page tokens like a real node.
function fakeNode() {
  const mine = [100, 90, 80, 70, 60, 50, 40].map((ts) => cast(ME, ts));
  const mentions = [95, 85, 84, 55, 45, 30, 10].map((ts) => cast(20 + ts, ts, { mentions: [ME] }));
  const follows = [99, 61, 59, 5].map((ts) => ({ hash: `0xf${ts}`, data: { type: 'MESSAGE_TYPE_LINK_ADD', fid: 300 + ts, timestamp: ts, linkBody: { type: 'follow', targetFid: ME } } }));
  const page = (list, token) => { const at = Number(token ?? 0); const next = at + 2 < list.length ? String(at + 2) : ''; return { messages: list.slice(at, at + 2), nextPageToken: next }; };
  const reads = [];
  return {
    reads,
    name: 'farcaster',
    source: (n) => ({ node: n.url }),
    get: async (path, p) => {
      reads.push(path);
      const node = { url: 'http://node' };
      if (path === '/v1/castsByFid') return { data: page(mine, p.pageToken), node };
      if (path === '/v1/castsByMention') return { data: page(mentions, p.pageToken), node };
      if (path === '/v1/linksByTargetFid') return { data: page(follows, p.pageToken), node };
      if (path === '/v1/castsByParent') return { data: { messages: p.hash === '0x7c80' ? [cast(11, 81), cast(ME, 82)] : [] } }; // my own reply is not news
      if (path === '/v1/reactionsByCast') {
        const r = (fid, type) => ({ data: { type: 'MESSAGE_TYPE_REACTION_ADD', fid, timestamp: 101, reactionBody: { type } } });
        return { data: { messages: p.target_hash === '0x7c100' ? [...Array.from({ length: 9 }, (_, i) => r(40 + i, 'REACTION_TYPE_LIKE')), r(ME, 'REACTION_TYPE_LIKE'), r(50, 'REACTION_TYPE_RECAST')] : [] } };
      }
      throw new Error(`unexpected ${path}`);
    },
  };
}

test('around: every mention and follow once, in the stretch of your casts it belongs to, then the end', async () => {
  const network = fakeNode();
  const api = { network: () => network, renderCasts: async (n, c) => c, usersFor: async (n, fids) => Object.fromEntries(fids.map((f) => [f, { username: `u${f}` }])) };
  const around = makeAround({ api, castsPerPage: 2 });
  const pages = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const p = await around('farcaster', ME, { cursor });
    pages.push(p);
    cursor = p.next;
    if (!cursor) break;
  }
  assert.equal(cursor, null, 'it ends once history runs out');
  const all = pages.flatMap((p) => p.items);
  const fc = (i) => (i.cast?.timestamp ?? i.at);
  for (const p of pages) assert.deepEqual(p.items.map(fc), [...p.items.map(fc)].sort((a, b) => b - a), 'newest first in each page');
  const mentionTs = all.filter((i) => i.kind === 'mention').map((i) => i.cast.fid - 20);
  assert.deepEqual(mentionTs, [95, 85, 84, 55, 45, 30, 10]);
  assert.deepEqual(all.filter((i) => i.kind === 'follow').map((i) => i.fid - 300), [99, 61, 59, 5]);

  // Only casts that set something moving; faces capped, the rest "and others"; your own like and reply left out.
  const echoes = all.filter((i) => i.kind === 'echo');
  assert.deepEqual(echoes.map((e) => e.cast.id), ['0x7c100', '0x7c80']);
  assert.equal(echoes[0].likes.length, 7); assert.equal(echoes[0].moreLikes, true); assert.ok(!echoes[0].likes.includes(ME));
  assert.deepEqual(echoes[0].recasts, [50]);
  assert.deepEqual(echoes[1].replies.map((r) => r.fid), [11]);
  assert.equal(pages[0].source.node, 'http://node');
});

test('around: a bad cursor or account is refused', async () => {
  const around = makeAround({ api: { network: () => fakeNode() } });
  await assert.rejects(around('farcaster', 'x'), /Which account/);
  await assert.rejects(around('farcaster', ME, { cursor: '%%%' }), /not one this server made/);
});
