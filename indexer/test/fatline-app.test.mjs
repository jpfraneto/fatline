import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useFatlineApp } from '../src/fatline-app.mjs';

const deployments = { fromBlock: 123, Fatliners: { address: '0x3423Dc1fDD8F4b5a5E06D73Ef8D0E93AdC86fC49', genesis: { fid: 18350 } } };
const VOICES = '0x00000000000000000000000000000000000000aA';

test("a client runs on its Fatline's contract (appOf): Aster's client finds Voices", async () => {
  const asked = [];
  const client = { readContract: async (q) => { asked.push(q); return VOICES; } };
  const config = { deployments, voices: { chainId: 8453, address: null } };
  const f = await useFatlineApp(config, { client });
  assert.equal(asked[0].functionName, 'appOf');
  assert.equal(asked[0].args[0], 18350n);
  assert.equal(f.app, VOICES);
  assert.equal(config.voices.address, VOICES);
  assert.equal(config.voices.fromBlock, 123);
});

test('no contract tied yet, or Voices set by hand: the client keeps its own config', async () => {
  const none = { deployments, voices: { address: null } };
  await useFatlineApp(none, { client: { readContract: async () => '0x0000000000000000000000000000000000000000' } });
  assert.equal(none.voices.address, null);
  const mine = { deployments, voices: { chainId: 8453, address: '0x1111111111111111111111111111111111111111' }, fatline: { fid: 3 } };
  const f = await useFatlineApp(mine, { client: { readContract: async () => VOICES } });
  assert.equal(f.fid, 3);
  assert.equal(mine.voices.address, '0x1111111111111111111111111111111111111111');
});
