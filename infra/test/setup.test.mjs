import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SETUP = join(dirname(fileURLToPath(import.meta.url)), '..', 'setup.mjs');
const plan = (state) => {
  const file = join(mkdtempSync(join(tmpdir(), 'setup-')), 'setup.json');
  if (state) writeFileSync(file, JSON.stringify(state));
  return execFileSync('node', [SETUP, '--plan'], { env: { ...process.env, FATLINE_SETUP_FILE: file, NO_COLOR: '1' }, encoding: 'utf8' });
};

test('setup --plan: each path lists its own steps with the command to run by hand', () => {
  const rent = plan({ done: ['check', 'choose'], path: 'rent', network: 'hypersnap' });
  assert.match(rent, /→ 3\. Connect your Hetzner account/);
  assert.match(rent, /\.\/fatline compute --quote/);
  assert.match(rent, /\.\/fatline node hypersnap\n/);
  assert.match(rent, /Start your client/);

  const light = plan({ done: ['check', 'choose'], path: 'light', network: 'farcaster' });
  assert.doesNotMatch(light, /Hetzner|compute/, 'the free path never mentions renting');
  assert.match(light, /--node crackle/, 'the light path names a public node, never a missing local one');

  const local = plan({ done: [], path: 'local', network: 'farcaster' });
  assert.match(local, /→ 1\. Check this machine/);
  assert.match(local, /node farcaster --local/);
});

test('setup without a terminal says how to see the plan instead of hanging', () => {
  let out = '';
  try { execFileSync('node', [SETUP], { input: '', encoding: 'utf8', env: { ...process.env, FATLINE_SETUP_FILE: join(tmpdir(), 'none.json') } }); }
  catch (e) { out = e.stdout; }
  assert.match(out, /--plan/);
});
