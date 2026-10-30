import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../src/api.mjs';

test('renderCasts: a quote carries the cast it quotes and its author, read once', async () => {
  let reads = 0;
  const network = { name: 'farcaster',
    get: async (path, params) => {
      if (path === '/v1/castById') {
        reads++;
        if (params.hash === '0xgone') return { data: null };
        return { data: { hash: params.hash, data: { type: 'MESSAGE_TYPE_CAST_ADD', fid: params.fid, timestamp: 100,
          castAddBody: { text: 'the quoted words', embeds: [{ url: 'https://i.imgur.com/x.png' }], mentions: [], mentionsPositions: [] } } } };
      }
      throw new Error(`unexpected ${path}`);
    } };
  const api = new Api({ config: {}, networks: {}, voices: {}, launchpad: null });
  api.user = async (n, fid) => ({ fid, username: `u${fid}`, displayName: `U ${fid}`, pfp: null });
  const cast = (id, embeds) => ({ kind: 'cast', id, fid: 1, text: 'hi', mentions: [], mentionsPositions: [], embeds });
  const out = await api.renderCasts(network, [cast('0xa', ['https://x.y', { cast: { fid: 7, hash: '0xq' } }]), cast('0xb', [{ cast: { fid: 7, hash: '0xq' } }, { cast: { fid: 8, hash: '0xgone' } }])]);
  assert.equal(out[0].embeds[0], 'https://x.y');
  assert.deepEqual(out[0].embeds[1].cast, { fid: 7, hash: '0xq', text: 'the quoted words', embeds: ['https://i.imgur.com/x.png'], timestamp: out[0].embeds[1].cast.timestamp,
    author: { username: 'u7', displayName: 'U 7', pfp: null } });
  assert.equal(out[1].embeds[0].cast.text, 'the quoted words');
  assert.deepEqual(out[1].embeds[1], { cast: { fid: 8, hash: '0xgone' } }); // not on this node: left as it was
  assert.equal(reads, 2); // the same quote twice on a page is read once
  await api.renderCasts(network, [cast('0xc', [{ cast: { fid: 7, hash: '0xq' } }])]);
  assert.equal(reads, 2); // and kept
});
