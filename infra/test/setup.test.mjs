import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  const rent = plan({ done: ['check', 'connect', 'choose'], path: 'rent', network: 'hypersnap' });
  assert.match(rent, /→ 4\. Connect your Hetzner account/);
  assert.match(rent, /\.\/fatline compute --quote/);
  assert.match(rent, /\.\/fatline node hypersnap\n/);
  assert.match(rent, /Start your client/);

  const light = plan({ done: ['check', 'connect', 'choose'], path: 'light', network: 'farcaster' });
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

test('the arch: the cap, the pillars and the opening are where the Farcaster icon has them', async () => {
  const { inArch, sample, frame } = await import('../arch.mjs');
  assert.ok(inArch(200, 80), 'cap');
  assert.ok(inArch(100, 200) && inArch(300, 200), 'pillars');
  assert.ok(!inArch(200, 250), 'the opening is empty');
  assert.ok(!inArch(40, 80), 'nothing beside the cap');
  const px = sample(48);
  assert.equal(px.length, 48 * 48);
  assert.equal(frame(px, 48, 3).length, 24, 'two pixels per character cell');
});

test('setup asks for the license once, and quitting there changes nothing but points to the code', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'setup-')), 'setup.json');
  writeFileSync(file, JSON.stringify({ done: [] }));
  // A pseudo-terminal is needed for the guided mode; `script` gives one on macOS and Linux.
  // Fed through a shell pipe: macOS's script refuses Node's own pipes (they are sockets).
  const run = process.platform === 'darwin' ? `script -q /dev/null node '${SETUP}'` : `script -qec "node '${SETUP}'" /dev/null`;
  const out = execFileSync('sh', ['-c', `printf 'q\\n' | ${run}`], { encoding: 'utf8', env: { ...process.env, FATLINE_SETUP_FILE: file, NO_COLOR: '1' } });
  assert.match(out, /open source, under the MIT license/);
  assert.match(out, /github\.com\/jpfraneto\/fatline\/edit\/main\/infra\/setup\.mjs/);
  assert.doesNotMatch(readFileSync(file, 'utf8'), /agreed/, 'saying no is not agreeing');
});
