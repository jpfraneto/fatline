// fatline compute vps root@<ip>   use a server you already have, from any provider (DigitalOcean, OVH, Contabo,
//                                 Vultr, a box at home…). Fatline logs in with its own SSH key, checks the machine
//                                 can hold a node, and remembers it; then fatline node snapchain installs the node.
//
// Fatline's key is .fatline/ssh_ed25519. If the server doesn't know it yet, this runs ssh-copy-id once: ssh asks for
// the server's password in its own prompt (Fatline never sees it).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.fatline');
const KEY = join(STATE, 'ssh_ed25519');
export const NEED = { ramGb: 8, goodRamGb: 16, diskGb: 650, cpus: 4 };

const sshArgs = () => ['-i', KEY, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${join(STATE, 'known_hosts')}`, '-o', 'ConnectTimeout=15', '-o', 'LogLevel=ERROR'];

/** Reads what the probe printed and says whether a node fits. */
export function judge(out) {
  const v = Object.fromEntries(out.trim().split('\n').map((l) => l.split('=')).filter((x) => x.length === 2));
  const ramGb = Math.round(Number(v.mem_kb) / 1024 / 1024);
  const diskGb = Math.round(Number(v.free_kb) / 1024 / 1024);
  const cpus = Number(v.cpus);
  const problems = [];
  if (!(ramGb >= NEED.ramGb)) problems.push(`${ramGb} GB of RAM; a node needs at least ${NEED.ramGb} (${NEED.goodRamGb} is comfortable)`);
  if (!(diskGb >= NEED.diskGb)) problems.push(`${diskGb} GB free on ${v.mount}; a node needs about ${NEED.diskGb} GB (attach a bigger disk)`);
  if (!(cpus >= NEED.cpus)) problems.push(`${cpus} CPUs; ${NEED.cpus} or more keep it in sync`);
  return { ramGb, diskGb, cpus, mount: v.mount, arch: v.arch, os: v.os, problems };
}

async function main() {
  const host = process.argv[2];
  if (!host || !/^root@[\w.-]+$/.test(host)) throw new Error('Usage: fatline compute vps root@<ip or name>  (the node setup runs as root)');
  mkdirSync(STATE, { recursive: true });
  if (!existsSync(KEY)) spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'fatline', '-f', KEY], { stdio: 'inherit' });
  const ssh = (cmd) => spawnSync('ssh', [...sshArgs(), '-o', 'BatchMode=yes', host, cmd], { encoding: 'utf8' });
  if (ssh('true').status !== 0) {
    console.log(`Fatline's key isn't on ${host} yet. Adding it with ssh-copy-id; ssh will ask for the server's password itself.`);
    const copy = spawnSync('ssh-copy-id', ['-i', `${KEY}.pub`, '-o', `UserKnownHostsFile=${join(STATE, 'known_hosts')}`, '-o', 'StrictHostKeyChecking=accept-new', host], { stdio: 'inherit' });
    if (copy.status !== 0 || ssh('true').status !== 0) {
      throw new Error(`Could not log in to ${host}. Add this line to /root/.ssh/authorized_keys on it (your provider's console can do it), then run this again:\n${spawnSync('cat', [`${KEY}.pub`], { encoding: 'utf8' }).stdout}`);
    }
  }
  // The biggest mounted disk is where the node's data will go (node-setup.sh prefers an attached volume).
  const probe = ssh(`echo mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo); echo cpus=$(nproc); echo arch=$(uname -m); . /etc/os-release 2>/dev/null; echo os=$PRETTY_NAME;
    df -k --output=avail,target -x tmpfs -x devtmpfs -x overlay 2>/dev/null | sed 1d | sort -n | tail -1 | awk '{print "free_kb=" $1; print "mount=" $2}'`);
  if (probe.status !== 0) throw new Error(`Logged in, but could not read the machine: ${probe.stderr.trim()}`);
  const m = judge(probe.stdout);
  console.log(`\n  ${host}: ${m.os}, ${m.arch}, ${m.cpus} CPUs, ${m.ramGb} GB RAM, ${m.diskGb} GB free on ${m.mount}`);
  if (m.problems.length) {
    console.log(`  It can't hold a node yet:\n${m.problems.map((p) => `    - ${p}`).join('\n')}`);
    if (!process.argv.includes('--force')) throw new Error('Not saved. Fix that and run this again (or add --force to use it anyway).');
  } else console.log('  It can hold a node.');
  const ipv4 = host.split('@')[1];
  writeFileSync(join(STATE, 'vps.json'), JSON.stringify({ provider: 'your own', host, ipv4, checkedAt: new Date().toISOString(), ...m }, null, 2) + '\n');
  console.log(`  Saved (.fatline/vps.json). Next: fatline node snapchain   (or hypersnap)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`\n${e.message}`); process.exit(1); });
