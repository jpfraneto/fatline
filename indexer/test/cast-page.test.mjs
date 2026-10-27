import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCastPath, readCast } from '../src/cast-page.mjs';

const H = (n) => '0x' + String(n).repeat(40).slice(0, 40);
const cast = (fid, hash, body) => ({ hash, data: { type: 'MESSAGE_TYPE_CAST_ADD', fid, timestamp: 100, castAddBody: { text: '', mentions: [], mentionsPositions: [], embeds: [], ...body } } });
const user = (name) => ({ messages: [{ data: { userDataBody: { type: 'USER_DATA_TYPE_USERNAME', value: name } } }] });

// A fake node: two accounts, a cast that mentions and quotes, and 150 older casts to page through.
function fakeNode() {
  const target = cast(16098, '0xabcdef12' + '0'.repeat(32), { text: 'hi  look', mentions: [3], mentionsPositions: [3], embeds: [{ url: 'https://fatline.ink/v.mp4' }, { castId: { fid: 3, hash: H(3) } }] });
  const older = Array.from({ length: 150 }, (_, i) => cast(16098, H(5).slice(0, 30) + String(i).padStart(12, '0'), { text: `old ${i}` }));
  const all = [...older.slice(0, 120), target, ...older.slice(120)];
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url.pathname + url.search);
    const q = Object.fromEntries(url.searchParams);
    const json = (b, status = 200) => ({ ok: status < 300, status, json: async () => b });
    switch (url.pathname) {
      case '/v1/userNameProofByName': return q.name === 'jpfraneto' ? json({ fid: 16098 }) : json({ errCode: 'not_found' }, 404);
      case '/v1/userDataByFid': return json(user({ 16098: 'jpfraneto', 3: 'dwr' }[q.fid] ?? null));
      case '/v1/castById': {
        const m = all.find((c) => c.hash === q.hash && c.data.fid === Number(q.fid)) ?? (q.hash === H(3) ? cast(3, H(3), { text: 'quoted' }) : null);
        return m ? json(m) : json({}, 404);
      }
      case '/v1/castsByFid': {
        const start = Number(q.pageToken ?? 0);
        return json({ messages: all.slice(start, start + 100), nextPageToken: start + 100 < all.length ? String(start + 100) : '' });
      }
      case '/v1/info': return json({ version: '0.15.0', dbStats: { numMessages: 914 } });
    }
    return json({}, 404);
  };
  return { fetchImpl, calls, target };
}

test('parseCastPath accepts usernames, FIDs and full or short hashes, nothing else', () => {
  assert.deepEqual(parseCastPath('@JPFraneto', '0xABCDEF12'), { name: 'jpfraneto', hash: '0xabcdef12' });
  assert.equal(parseCastPath('16098', H(1)).hash, H(1));
  assert.throws(() => parseCastPath('a/b', '0xabcdef12'), /who/);
  assert.throws(() => parseCastPath('jp', '0xabc'), /hash/);
  assert.throws(() => parseCastPath('jp', 'abcdef12'), /hash/);
});

test('reads a cast by username and full hash: mentions written in, quotes, the node named', async () => {
  const { fetchImpl, target } = fakeNode();
  const r = await readCast({ node: 'http://node:3381/', label: 'test node', fetchImpl }, 'jpfraneto', target.hash);
  assert.equal(r.cast.text, 'hi @dwr look');
  assert.equal(r.author.username, 'jpfraneto');
  assert.equal(r.cast.embeds[0], 'https://fatline.ink/v.mp4');
  assert.equal(r.quotes.length, 1);
  assert.equal(r.quotes[0].text, 'quoted');
  assert.equal(r.quotes[0].author.username, 'dwr');
  assert.equal(r.source.label, 'test node');
  assert.equal(r.source.version, '0.15.0');
});

test('a short hash (as in farcaster.xyz links) is found in the author\'s recent casts, across pages', async () => {
  const { fetchImpl, calls, target } = fakeNode();
  const r = await readCast({ node: 'http://node:3381', fetchImpl }, '16098', '0xabcdef12');
  assert.equal(r.cast.id, target.hash);
  assert.equal(calls.filter((c) => c.startsWith('/v1/castsByFid')).length, 2);
  assert.ok(!calls.some((c) => c.startsWith('/v1/userNameProofByName')), 'an FID needs no name lookup');
});

test('unknown names and casts are 404s; a node that does not answer is a 503', async () => {
  const { fetchImpl } = fakeNode();
  await assert.rejects(readCast({ node: 'http://n', fetchImpl }, 'nobody', '0xabcdef12'), (e) => e.status === 404 && /No account/.test(e.message));
  await assert.rejects(readCast({ node: 'http://n', fetchImpl }, 'jpfraneto', '0x99999999'), (e) => e.status === 404 && /No cast/.test(e.message));
  const down = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(readCast({ node: 'http://n', label: 'down node', fetchImpl: down }, '16098', '0xabcdef12'), (e) => e.status === 503 && /down node/.test(e.message));
});
