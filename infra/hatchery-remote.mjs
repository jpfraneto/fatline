// fatline hatchery install: puts the hatchery on the server fatline compute rented (or --ip), next to its
// node, by running infra/hatchery-setup.sh there over SSH. Prints the server's attester key at the end.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickServer } from './node-remote.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.fatline');

export function installHatchery({ ip = pickServer('farcaster'), env = {} } = {}) {
  if (!ip) throw new Error('No server. Run fatline compute first, or pass --ip <address>.');
  const vars = Object.entries(env).filter(([, v]) => v).map(([k, v]) => `${k}=${JSON.stringify(String(v))}`).join(' ');
  console.log(`Installing the hatchery on ${ip} (Node 22, Fatline, a key of its own, a service on port 8791)…`);
  const r = spawnSync('ssh', [
    '-i', join(STATE, 'ssh_ed25519'), '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${join(STATE, 'known_hosts')}`, '-o', 'ConnectTimeout=15', '-o', 'LogLevel=ERROR',
    `root@${ip}`, `${vars} bash -s`,
  ], { input: readFileSync(join(ROOT, 'infra/hatchery-setup.sh'), 'utf8'), stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`The setup stopped (exit ${r.status}).`);
  console.log(`\nYour server's hatchery: http://${ip}:8791. Lay your egg there: fatline egg lay`);
}
