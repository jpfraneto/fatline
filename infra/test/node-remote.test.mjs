import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NETWORKS, pickServer } from '../node-remote.mjs';

const records = (map) => (file) => map[file.split('/').pop()] ?? null;

test('Hypersnap goes to its own server when one is recorded, never onto the main one', () => {
  const read = records({ 'hetzner.json': { ipv4: '1.1.1.1' }, 'hetzner-hypersnap.json': { ipv4: '2.2.2.2' } });
  assert.equal(pickServer('hypersnap', read), '2.2.2.2');
  assert.equal(pickServer('farcaster', read), '1.1.1.1');
});

test('with one rented server, both networks point at it (the node command then guards against a second node)', () => {
  const read = records({ 'hetzner.json': { ipv4: '1.1.1.1' } });
  assert.equal(pickServer('hypersnap', read), '1.1.1.1');
  assert.equal(pickServer('farcaster', records({})), null);
});

test('the two networks use different ports and folders', () => {
  assert.notEqual(NETWORKS.farcaster.port, NETWORKS.hypersnap.port);
  assert.notEqual(NETWORKS.farcaster.dir, NETWORKS.hypersnap.dir);
});

test('a server paid in USDC (fatline compute) is used when there is no Hetzner one', () => {
  assert.equal(pickServer('farcaster', records({ 'compute.json': { ipv4: '3.3.3.3' } })), '3.3.3.3');
  assert.equal(pickServer('farcaster', records({ 'hetzner.json': { ipv4: '1.1.1.1' }, 'compute.json': { ipv4: '3.3.3.3' } })), '1.1.1.1');
});

test('your own server (fatline compute vps) is used when nothing was rented', () => {
  assert.equal(pickServer('farcaster', records({ 'vps.json': { ipv4: '4.4.4.4' } })), '4.4.4.4');
});
