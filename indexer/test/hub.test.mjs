import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Network, ethAddresses, normalizeCast, renderMentions, toFc, toMs } from '../src/hub.mjs';

const castMessage = (over = {}) => ({
  hash: '0xabc',
  data: {
    type: 'MESSAGE_TYPE_CAST_ADD', fid: 3, timestamp: 100,
    castAddBody: { text: 'hi  and ', mentions: [2, 5], mentionsPositions: [3, 8], embeds: [{ url: 'https://x' }], parentCastId: null, ...over },
  },
});

test('timestamps round-trip through the Farcaster epoch', () => {
  assert.equal(toMs(0), Date.UTC(2021, 0, 1));
  assert.equal(toFc(toMs(12345)), 12345);
});

test('normalizes a cast the same way for any network', () => {
  const c = normalizeCast(castMessage(), 'hypersnap');
  assert.equal(c.network, 'hypersnap');
  assert.deepEqual(c.embeds, ['https://x']);
  assert.equal(c.parent, null);
  assert.equal(normalizeCast(castMessage({ parentCastId: { fid: 1, hash: '0x1' } }), 'farcaster').parent.hash, '0x1');
});

test('inserts mentions at byte positions, including after multi-byte text', () => {
  const c = normalizeCast(castMessage(), 'farcaster');
  assert.equal(renderMentions(c, new Map([[2, 'v'], [5, 'dwr']])), 'hi @v and @dwr');
  const accented = normalizeCast(castMessage({ text: 'olé  ok', mentions: [2], mentionsPositions: [5] }), 'farcaster');
  assert.equal(renderMentions(accented, new Map()), 'olé @fid:2 ok');
});

test('keeps only Ethereum verifications', () => {
  const v = (address, protocol) => ({ data: { verificationAddAddressBody: { address, protocol } } });
  assert.deepEqual(ethAddresses([
    v('ExAqci8uUVKtqHqFW58fmwgMMY9PATfRGGyv6837j9Lx', 'PROTOCOL_SOLANA'),
    v('0x6Ce09Ed5526DE4aFe4a981AD86d17B2F5c92feA5', 'PROTOCOL_ETHEREUM'),
  ]), ['0x6ce09ed5526de4afe4a981ad86d17b2f5c92fea5']);
});

test('prefers your own node and falls back to the next healthy one, saying which', async () => {
  const info = { shardInfos: [{ shardId: 1, blockDelay: 0 }, { shardId: 2, blockDelay: 3 }], version: 'x' };
  const fetchImpl = async (url) => {
    if (String(url).startsWith('http://own')) throw new Error('connection refused');
    return new Response(JSON.stringify(info));
  };
  const n = new Network('farcaster', { nodes: [{ url: 'http://own', own: true }, { url: 'https://public', own: false }] }, { fetchImpl });
  const node = await n.node();
  assert.equal(node.url, 'https://public');
  assert.deepEqual(n.source(node), { network: 'farcaster', node: 'https://public', own: false });
  assert.equal(n.describe().nodes[0].status.ok, false);
});

test('a node far behind is not used', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ shardInfos: [{ shardId: 1, blockDelay: 50_000 }] }));
  const n = new Network('hypersnap', { nodes: [{ url: 'http://slow', own: true }] }, { fetchImpl });
  await assert.rejects(n.node(), /No reachable/);
});
