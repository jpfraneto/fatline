import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Network } from '../src/hub.mjs';

test("while none of your nodes is in sync, reads go through a public node, labelled not yours", async () => {
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    if (u.host === '5.161.202.175:3381') throw new Error('fetch failed'); // still downloading its snapshot
    return new Response(JSON.stringify({ version: '0.15.0', shardInfos: [{ shardId: 1, maxHeight: 10, blockDelay: 1 }], dbStats: {} }));
  };
  const net = new Network('farcaster', { nodes: [{ url: 'http://5.161.202.175:3381', own: true }] }, { fetchImpl });
  const node = await net.node();
  assert.equal(node.url, 'http://46.225.208.199:3381');
  assert.equal(node.own, false);
  assert.match(node.label, /not yours, while yours catches up/);
});
