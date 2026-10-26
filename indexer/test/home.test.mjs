import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHome } from '../src/home.mjs';

test('home: the casts of the people a FID follows (and its own), newest first, paged, read once', async () => {
  let linkReads = 0, castReads = 0;
  const network = { name: 'farcaster', current: null,
    get: async (path, params) => {
      linkReads++;
      return { data: { messages: [2, 3, 2].map((t) => ({ data: { type: 'MESSAGE_TYPE_LINK_ADD', linkBody: { targetFid: t } } })) } };
    } };
  const api = {
    casts: async (n, { fid }) => { castReads++; return { casts: [1, 2, 3].map((k) => ({ kind: 'cast', fid, timestamp: fid * 100 + k })) }; },
    withApps: async (n, c) => c, renderCasts: async (n, c) => c, usersFor: async (n, fids) => Object.fromEntries(fids.map((f) => [f, { username: `u${f}` }])),
  };
  const home = makeHome({ api, network });
  const p = await home(1, { limit: 4 });
  assert.equal(p.follows, 2); // 2 and 3, once each
  assert.deepEqual(p.items.map((i) => i.timestamp), [303, 302, 301, 203]);
  const q = await home(1, { limit: 4, before: p.next });
  assert.deepEqual(q.items.map((i) => i.timestamp), [202, 201, 103, 102]);
  assert.equal(linkReads, 1); assert.equal(castReads, 3); // the second page came from the kept timeline
  await assert.rejects(home('x'), /Which account/);
});
