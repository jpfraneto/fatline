// The Snapchain upgrader (fatline-snapchain-upgrade): since 0.16.0 the image has no shell, so it writes config.toml
// on the host from upstream's compose text and starts /app/snapchain directly. Docker is faked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const upgraderIn = (file) => {
  const s = readFileSync(join(here, '..', file), 'utf8');
  const start = s.indexOf(`cat > "$SNAP_UPGRADER" <<'EOF'\n`);
  assert.ok(start >= 0, `${file} writes the upgrader`);
  const body = s.slice(s.indexOf('\n', start) + 1);
  return body.slice(0, body.indexOf('\nEOF\n') + 1);
};

test('autoupgrade.sh and node-setup.sh write the same upgrader', () => {
  assert.equal(upgraderIn('node-setup.sh'), upgraderIn('autoupgrade.sh'));
});

const entry = [
  '#!/bin/bash',
  'set -euo pipefail',
  'cat > config.toml <<EOF',
  '',
  'rpc_address="0.0.0.0:3383"',
  'http_address="0.0.0.0:3381"',
  'read_node = true',
  'EOF',
  'cat /app/validators.toml >> config.toml',
  'exec $0 $@',
  '',
].join('\n');

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'snapup-'));
  const bin = join(dir, 'bin');
  spawnSync('mkdir', [bin]);
  writeFileSync(join(dir, 'upgrader'), upgraderIn('autoupgrade.sh'));
  chmodSync(join(dir, 'upgrader'), 0o755);
  writeFileSync(join(dir, 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(join(dir, 'validators.toml'), '[[validator_sets]]\neffective_at = 0\n');
  writeFileSync(join(dir, 'docker-compose.override.yml'), 'services:\n  snapchain:\n    environment:\n      A: "1"\n');
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ services: { snapchain: { entrypoint: ['/bin/bash', '-c', entry] } } }));
  // Fake docker: compose config prints the JSON; inspect prints $FAKE_STATE; compose up is logged.
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
case "$*" in
  *"config --format json"*) cat "${dir}/config.json" ;;
  *"ps -aq"*) echo abc123 ;;
  inspect*) [ -n "\${FAKE_STATE:-}" ] && echo "$FAKE_STATE" || exit 1 ;;
  *"up -d snapchain"*) echo up >> "${dir}/ups" ;;
esac
`);
  chmodSync(join(bin, 'docker'), 0o755);
  const run = (state) => spawnSync('bash', [join(dir, 'upgrader'), dir, '--no-upgrade'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_STATE: state ?? '' },
  });
  const ups = () => (existsSync(join(dir, 'ups')) ? readFileSync(join(dir, 'ups'), 'utf8').trim().split('\n').length : 0);
  return { dir, run, ups };
}

test('writes config.toml, adds the override once, and starts the node', () => {
  const { dir, run, ups } = setup();
  let r = run('restarting');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(
    readFileSync(join(dir, 'config.toml'), 'utf8'),
    '\nrpc_address="0.0.0.0:3383"\nhttp_address="0.0.0.0:3381"\nread_node = true\n[[validator_sets]]\neffective_at = 0\n',
  );
  const override = readFileSync(join(dir, 'docker-compose.override.yml'), 'utf8');
  assert.match(override, /entrypoint: \["\/app\/snapchain"\]/);
  assert.match(override, /- \.\/config\.toml:\/app\/config\.toml:ro/);
  assert.equal(ups(), 1);

  // Nothing changed and it runs: no restart, no second block.
  r = run('running');
  assert.equal(r.status, 0);
  assert.equal(ups(), 1);
  assert.equal(readFileSync(join(dir, 'docker-compose.override.yml'), 'utf8'), override);

  // New validators: config rewritten and the node restarted.
  writeFileSync(join(dir, 'validators.toml'), '[[validator_sets]]\neffective_at = 5\n');
  r = run('running');
  assert.equal(ups(), 2);
  assert.match(readFileSync(join(dir, 'config.toml'), 'utf8'), /effective_at = 5/);
});

test('leaves config.toml alone when upstream stops writing it in the entrypoint', () => {
  const { dir, run, ups } = setup();
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ services: { snapchain: { image: 'x' } } }));
  writeFileSync(join(dir, 'config.toml'), 'old\n');
  const r = run('running');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /check by hand/);
  assert.equal(readFileSync(join(dir, 'config.toml'), 'utf8'), 'old\n');
  assert.equal(ups(), 0);
});
