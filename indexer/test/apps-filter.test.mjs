import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appFidOf, appFilter } from '../src/api.mjs';

// A real onchain key record (FID 18350's first key, from crackle, 2026-10-22): requested by FID 9152.
const REAL_METADATA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAjwAAAAAAAAAAAAAAAAALveQ3XmTo1/YR8BT7drpQNBVWWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZO6C7wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBQeMnDiP9JFhdZgnobVGTdU69cdJ/3SiT2NR6JuOvVWlYX6J1hT158GG19qb3V1VXW1S0buVs30mopHtWx3LZMhwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

test('the app behind a key is read from its own record, never guessed', () => {
  assert.equal(appFidOf({ onChainEvent: { signerEventBody: { metadata: REAL_METADATA, metadataType: 1 } } }), 9152);
  assert.equal(appFidOf({ requestFid: 18350 }), 18350, 'gasless keys may carry requestFid directly');
  assert.equal(appFidOf({ onChainEvent: { signerEventBody: { metadata: 'bm90IGFiaQ==', metadataType: 1 } } }), null, 'garbage metadata is unknown');
  assert.equal(appFidOf({ onChainEvent: { signerEventBody: { metadata: REAL_METADATA, metadataType: 2 } } }), null, 'other metadata types are unknown');
  assert.equal(appFidOf({}), null);
});

test('include or exclude casts by app, with a stated rule for unknown apps; voices are never filtered', () => {
  const items = [
    { kind: 'cast', id: 'a', app: { fid: 9152 } },
    { kind: 'cast', id: 'b', app: { fid: 16823 } },
    { kind: 'cast', id: 'c', app: null },
    { kind: 'voice', id: 'v' },
  ];
  const ids = (opts) => items.filter(appFilter(opts)).map((i) => i.id).join('');
  assert.equal(ids({}), 'abcv');
  assert.equal(ids({ hide: ['9152'] }), 'bcv');
  assert.equal(ids({ only: [16823] }), 'bv');
  assert.equal(ids({ unknown: 'hide' }), 'abv');
  assert.equal(ids({ hide: [9152], unknown: 'hide' }), 'bv');
});
