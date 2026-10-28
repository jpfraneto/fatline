import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { embed, embedTags, labelOf, manifest, saveAssociation, signAssociation } from '../src/miniapp.mjs';

test('a place is <label>.fatline.ink and nothing else', () => {
  assert.equal(labelOf('fatline.fatline.ink'), 'fatline');
  assert.equal(labelOf('Thaituma.fatline.ink:443'), 'thaituma');
  assert.equal(labelOf('fatline.ink'), 'fatline'); // the genesis Fatline's short name
  assert.equal(labelOf('evil.com'), null);
  assert.equal(labelOf('a.b.fatline.ink'), null);
  assert.equal(manifest('localhost:8787', null), null);
  assert.equal(embedTags('localhost:8787'), '');
});

test('the card opens the place it was cast from', () => {
  const e = embed('aenon.fatline.ink');
  assert.equal(e.version, '1');
  assert.equal(e.button.title, 'Open Aenon');
  assert.equal(e.button.action.type, 'launch_frame');
  assert.equal(e.button.action.url, 'https://aenon.fatline.ink/');
  assert.match(embedTags('aenon.fatline.ink'), /^<meta name="fc:miniapp" content='\{"version":"1"/);
  assert.doesNotMatch(embedTags('aenon.fatline.ink'), /content='[^']*'[^ ]/); // the JSON never closes the attribute early
});

test('the domain association is a JSON Farcaster Signature by the custody key, used only for its own domain', async () => {
  const key = generatePrivateKey();
  const a = await signAssociation({ domain: 'fatline.fatline.ink', fid: 3356653, privateKey: key });
  const header = JSON.parse(Buffer.from(a.header, 'base64url').toString());
  assert.deepEqual(header, { fid: 3356653, type: 'custody', key: privateKeyToAccount(key).address });
  assert.deepEqual(JSON.parse(Buffer.from(a.payload, 'base64url').toString()), { domain: 'fatline.fatline.ink' });
  const ok = await verifyMessage({ address: header.key, message: `${a.header}.${a.payload}`, signature: `0x${Buffer.from(a.signature, 'base64url').toString('hex')}` });
  assert.equal(ok, true);

  const dir = mkdtempSync(join(tmpdir(), 'miniapp-'));
  saveAssociation(dir, a);
  assert.deepEqual(manifest('fatline.fatline.ink', dir).accountAssociation, a);
  assert.equal(manifest('aenon.fatline.ink', dir).accountAssociation, undefined); // another place doesn't borrow it
});

test('fatline.ink itself is the genesis Fatline: its card, and the association signed for fatline.ink', () => {
  const m = manifest('fatline.ink', mkdtempSync(join(tmpdir(), 'miniapp-')));
  assert.equal(m.miniapp.homeUrl, 'https://fatline.ink/');
  assert.equal(m.miniapp.canonicalDomain, 'fatline.ink');
  assert.deepEqual(JSON.parse(Buffer.from(m.accountAssociation.payload, 'base64url').toString()), { domain: 'fatline.ink' });
  assert.match(embedTags('fatline.ink'), /"url":"https:\/\/fatline\.ink\/"/);
});
