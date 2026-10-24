// fatline node <farcaster|hypersnap>, when fatline compute rented a server:
// installs that network's read node on the rented server, follows the setup until the node answers,
// then makes it this client's own node for that network.
//
//   farcaster  → infra/node-setup.sh       (Snapchain, ports 3381-3383)
//   hypersnap  → infra/hypersnap-setup.sh  (Hypersnap, ports 4381-4383; needs its own disk next to Snapchain)
//
// Safe to re-run: if the setup is already running it just follows it, and if the node already answers it
// only updates the config. Ctrl-C stops following, not the setup.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.fatline');
export const NETWORKS = {
  farcaster: { script: 'node-setup.sh', port: 3381, label: 'Snapchain', dir: '/root/snapchain' },
  hypersnap: { script: 'hypersnap-setup.sh', port: 4381, label: 'Hypersnap', dir: '/root/hypersnap' },
};

/** Which rented server to use: the Hypersnap record if this network has its own server, else the main one. */
export function pickServer(network, read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null)) {
  const own = network === 'hypersnap' ? read(join(STATE, 'hetzner-hypersnap.json')) : null;
  if (own?.ipv4) return own.ipv4;
  // Hetzner first, then a server paid in USDC (fatline compute), then your own (fatline compute vps).
  return read(join(STATE, 'hetzner.json'))?.ipv4 ?? read(join(STATE, 'compute.json'))?.ipv4 ?? read(join(STATE, 'vps.json'))?.ipv4 ?? null;
}

const ssh = (ip, cmd, input) => spawnSync('ssh', [
  '-i', join(STATE, 'ssh_ed25519'), '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new',
  '-o', `UserKnownHostsFile=${join(STATE, 'known_hosts')}`, '-o', 'ConnectTimeout=15', '-o', 'LogLevel=ERROR',
  `root@${ip}`, cmd,
], { input, encoding: 'utf8' });

async function info(url) {
  try {
    const res = await fetch(`${url}/v1/info`, { signal: AbortSignal.timeout(8000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let [network, ...flags] = process.argv.slice(2);
  if (network === 'snapchain') network = 'farcaster';
  const net = NETWORKS[network];
  if (!net) throw new Error('Usage: fatline node snapchain|hypersnap [--force]');
  if (flags.includes('--lite')) throw new Error('--lite (copy only the current state from our full node, no snapshot) is not tested yet. Coming soon.');
  const force = flags.includes('--force');
  const ip = pickServer(network);
  if (!ip) throw new Error('No rented server. Run fatline compute first, or fatline node <network> --local.');
  const url = `http://${ip}:${net.port}`;
  const log = `/root/${network}-setup.log`;

  // A server rented a minute ago may still be booting: wait for SSH before anything else.
  if (!(await info(url)) && ssh(ip, 'true').status !== 0) {
    process.stdout.write(`Waiting for ${ip} to accept SSH (a new server takes a few minutes)`);
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { await sleep(10_000); process.stdout.write('.'); ok = ssh(ip, 'true').status === 0; }
    console.log(ok ? ' ready' : '');
    if (!ok) throw new Error(`${ip} still refuses SSH after 10 minutes. Check the server with your provider, then run this again.`);
  }
  if (!(await info(url))) {
    // `[n]ode-setup.sh`: the bracket keeps this check from matching its own command line.
    const pattern = `[${net.script[0]}]${net.script.slice(1)}`;
    const running = ssh(ip, `pgrep -f '${pattern}' >/dev/null && echo yes || echo no`).stdout.trim() === 'yes';
    if (running) console.log(`The ${net.label} setup is already running on ${ip}. Following it.`);
    else {
      // Never put a second network on a server that already has the other one (a re-run of the same network
      // resumes in its own folder). Hypersnap next to Snapchain needs its own disk: rent that separately.
      const other = Object.entries(NETWORKS).find(([n]) => n !== network)[1];
      const busy = ssh(ip, `[ -e ${other.dir} ] && echo dir; curl -s -m 5 -o /dev/null -w '%{http_code}' localhost:${other.port}/v1/info`).stdout;
      if ((busy.includes('dir') || busy.includes('200')) && !force) {
        throw new Error(`${ip} already runs a ${other.label} node. Installing ${net.label} there too could fill its disk. Use a separate server, or add --force if it has room.`);
      }
      const put = ssh(ip, `cat > /root/${net.script} && chmod +x /root/${net.script}`, readFileSync(join(ROOT, 'infra', net.script)));
      if (put.status !== 0) throw new Error(`Could not reach ${ip} over SSH: ${put.stderr.trim()}`);
      ssh(ip, `cd /root && (setsid nohup /root/${net.script} > ${log} 2>&1 < /dev/null &)`);
      console.log(`Started the ${net.label} setup on ${ip}. It streams a ~400 GB snapshot first: expect 1-3 hours.`);
    }
    console.log(`Following ${log} (Ctrl-C stops following; the setup keeps going. Re-run this command to follow again.)\n`);
    let last = '';
    for (;;) {
      if (await info(url)) break;
      const r = ssh(ip, `grep -a -v '^perl\\|locale\\|LANG\\|LC_\\|supported' ${log} | tail -n 1; pgrep -f '[${net.script[0]}]${net.script.slice(1)}' >/dev/null || echo __stopped__`);
      const lines = r.stdout.trim().split('\n');
      const stopped = lines.includes('__stopped__');
      const line = lines.filter((l) => l !== '__stopped__').pop() ?? '';
      if (line && line !== last) { console.log(`  ${line.replace(/\x1b\[[0-9;]*m/g, '')}`); last = line; }
      if (stopped && !(await info(url))) {
        const tail = ssh(ip, `grep -a -v '^perl\\|locale\\|LANG\\|LC_\\|supported' ${log} | tail -n 15`).stdout.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
        const why = tail.split('\n').find((l) => l.startsWith('FATLINE_ERROR:'));
        throw new Error(`The setup stopped before the node answered.${why ? `\n${why.slice(15).trim()}` : ''}\nLast lines of ${log} on ${ip}:\n${tail.replace(/^/gm, '  ')}\nFix that and run this command again: finished steps are skipped.`);
      }
      await sleep(30_000);
    }
  }

  const i = await info(url);
  spawnSync('node', [join(ROOT, 'infra/config-tool.mjs'), 'own-node', network, url], { stdio: 'inherit' });
  console.log(`\n${net.label} ${i.version} answers at ${url}.`);
  for (const s of i.shardInfos ?? []) console.log(`  shard ${s.shardId}: height ${s.maxHeight}, ${s.blockDelay} blocks behind`);
  console.log('It is healthy when every shard is only a few blocks behind. Check again with: fatline status');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(`\n${err.message}`); process.exit(1); });
}
