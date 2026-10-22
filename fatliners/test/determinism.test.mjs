import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/index.mjs';
import { allProfiles, ARCHETYPES, history } from '../src/sources/synthetic.mjs';
import { sha256Hex } from '../src/hash.mjs';

test('same history → byte-identical SVG, icon and Atlas', () => {
  for (const p of allProfiles()) {
    const a = generate(history(p)), b = generate(history(p));
    assert.equal(a.svg, b.svg);
    assert.equal(a.icon, b.icon);
    assert.deepEqual(a.atlas, b.atlas);
  }
});

test('message order and duplicates do not matter; networks merge by hash', () => {
  const h = history(ARCHETYPES[3]);
  const shuffled = { ...h, messages: [...h.messages].reverse().concat(h.messages.slice(0, 5)) };
  assert.equal(generate(h).svg, generate(shuffled).svg);
  const both = { ...h, messages: h.messages.map((m, i) => ({ ...m, networks: i % 2 ? ['hypersnap'] : ['farcaster'] })) };
  const dup = { ...both, messages: both.messages.concat(both.messages.slice(0, 10).map((m) => ({ ...m, networks: ['hypersnap', 'farcaster'] }))) };
  const r = generate(dup);
  const both10 = r.history.messages.filter((m) => m.networks.length === 2).length;
  assert.equal(both10, 10, 'a message seen on both networks keeps both in its provenance');
  assert.ok(r.atlas.snapshot.networks.farcaster && r.atlas.snapshot.networks.hypersnap);
});

test('the commitment binds the exact message set and snapshot time', () => {
  const h = history(ARCHETYPES[2]);
  const base = generate(h).commitment;
  assert.notEqual(generate({ ...h, messages: h.messages.slice(1) }).commitment, base);
  assert.notEqual(generate({ ...h, snapshotAt: h.snapshotAt + 1 }).commitment, base);
  assert.equal(generate({ ...h, messages: h.messages.filter((m) => m.ts <= h.snapshotAt) }).commitment, base);
});

test('messages after snapshotAt are ignored (a permanent face is frozen at its snapshot)', () => {
  const h = history(ARCHETYPES[4]);
  const later = { ...h, messages: [...h.messages, { hash: '0x' + 'a'.repeat(40), networks: ['farcaster'], kind: 'cast', ts: h.snapshotAt + 1000 }] };
  assert.equal(generate(later).svg, generate(h).svg);
});

// Golden hashes: if a rule or the renderer changes, these fail on purpose. Bump DNA_VERSION or
// RENDERER_VERSION (minted beings must keep their face), then update the hashes.
const GOLDEN = {
  'syn-returner': '0xf87efc4f7e9fb6fc22ac34cee638a6dcea9cf60670e07e9ef3c7caf25514a90f',
  'syn-unwritten': '0x0a004c903b0aaf207127bdbdea32f35310a80f1cae9dd5784421b284e5933417',
  'syn-wanderer': '0x8eae48f938e6d4ecc076380636e685c8c44b21455edc9555337e74e5c4dc8ac3',
};
test('golden renders (renderer/1, dna/1)', (t) => {
  for (const id of Object.keys(GOLDEN)) {
    const got = sha256Hex(generate(history(ARCHETYPES.find((p) => p.id === id))).svg);
    if (GOLDEN[id] === null) { t.diagnostic(`${id} ${got}`); continue; }
    assert.equal(got, GOLDEN[id], id);
  }
});
