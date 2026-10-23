import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { discover, nodeState } from '../dashboard.mjs';

test('dashboard: finds the rented servers and own nodes, once each, never localhost', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dash-'));
  writeFileSync(join(dir, 'hetzner.json'), JSON.stringify({ ipv4: '10.0.0.5', type: 'cax31', location: 'nbg1' }));
  writeFileSync(join(dir, 'hetzner-hypersnap.json'), JSON.stringify({ ipv4: '10.0.0.5' }));
  writeFileSync(join(dir, 'fatline.config.json'), JSON.stringify({ networks: { farcaster: { nodes: [
    { url: 'http://127.0.0.1:3381', own: true }, { url: 'http://10.0.0.9:3381', own: true, label: 'Home box' }, { url: 'https://crackle.example', own: false },
  ] } } }));
  assert.deepEqual(discover({ state: dir, root: dir }).servers, [
    { name: 'Hetzner cax31 nbg1', host: '10.0.0.5' },
    { name: 'Home box', host: '10.0.0.9' },
  ]);
});

test('dashboard: a node is alive, catching up, starting or down', () => {
  assert.equal(nodeState(null).state, 'down');
  assert.equal(nodeState({ shardInfos: [] }).state, 'starting');
  const info = (d) => ({ version: '0.14.3', dbStats: { numMessages: 5 }, shardInfos: [{ shardId: 0, blockDelay: 9999 }, { shardId: 1, blockDelay: 3 }, { shardId: 2, blockDelay: d }] });
  assert.deepEqual(nodeState(info(4)), { state: 'alive', behind: 4, shards: [{ id: 1, behind: 3 }, { id: 2, behind: 4 }], messages: 5, version: '0.14.3' });
  assert.equal(nodeState(info(5000)).state, 'catching up');
});
