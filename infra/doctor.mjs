// fatline doctor
// Looks at this machine and at the networks, then says which way of running Fatline fits:
//   1. full  — run your own Farcaster or Hypersnap node here, plus the indexer and apps
//   2. light — run the indexer and apps here, reading from a node that already exists
//   3. rent  — this machine can't do either: rent a server with one x402 payment
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GB = 1024 ** 3;

// Official Snapchain requirements (github.com/farcasterxyz/snapchain README, checked 2026-10-21).
// Hypersnap keeps history unpruned, so it needs more disk, and it keeps growing.
export const FULL_NODE = {
  farcaster: { cpus: 4, ramGb: 8, diskGb: 650, note: 'Keeping 1 day of blocks (the default), the network state was ~560 GB on 2026-10-23 and grows. 16 GB RAM is comfortable.' },
  hypersnap: { cpus: 4, ramGb: 16, diskGb: 800, note: 'Hypersnap keeps full history: ~730 GB on 2026-10-23 and growing.' },
};
export const LIGHT = { cpus: 1, ramGb: 1, diskGb: 2, node: [22, 12] };

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = paint(32), red = paint(31), yellow = paint(33), bold = paint(1), dim = paint(2);
const mark = (ok) => (ok ? green('✓') : red('✗'));

function run(cmd, args) {
  try { return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).toString().trim(); } catch { return null; }
}

export function inspectMachine(dataDir = ROOT) {
  mkdirSync(dataDir, { recursive: true });
  const fs = statfsSync(dataDir);
  const [major, minor] = process.versions.node.split('.').map(Number);
  const dockerCli = run('docker', ['--version']);
  return {
    os: `${os.type()} ${os.release()}`,
    platform: process.platform,
    arch: process.arch,
    cpus: os.availableParallelism?.() ?? os.cpus().length,
    ramGb: +(os.totalmem() / GB).toFixed(1),
    freeDiskGb: +((fs.bavail * fs.bsize) / GB).toFixed(1),
    diskPath: dataDir,
    node: process.versions.node,
    nodeOk: major > LIGHT.node[0] || (major === LIGHT.node[0] && minor >= LIGHT.node[1]),
    git: Boolean(run('git', ['--version'])),
    docker: dockerCli ? (run('docker', ['info', '--format', '{{.ServerVersion}}']) ? 'running' : 'installed, not running') : 'missing',
    forge: Boolean(run('forge', ['--version'])),
  };
}

export function canRunFull(m, network) {
  const r = FULL_NODE[network];
  const checks = {
    cpus: m.cpus >= r.cpus,
    ram: m.ramGb >= r.ramGb * 0.95, // machines sold as "16 GB" report a little less
    disk: m.freeDiskGb >= r.diskGb,
    docker: m.docker === 'running',
    os: m.platform === 'linux' || m.platform === 'darwin',
  };
  return { ok: Object.values(checks).every(Boolean), checks, need: r };
}

export function canRunLight(m) {
  return m.nodeOk && m.ramGb >= LIGHT.ramGb && m.freeDiskGb >= LIGHT.diskGb;
}

async function probe(url) {
  const started = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/info`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const info = await res.json();
    const shards = (info.shardInfos ?? []).filter((s) => s.shardId !== 0);
    const delay = Math.max(0, ...shards.map((s) => Number(s.blockDelay ?? 0)));
    return { ok: shards.length > 0 && delay <= 200, delay, version: info.version, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, error: err.cause?.code ?? err.name };
  }
}

function loadConfig() {
  const own = join(ROOT, 'fatline.config.json');
  return JSON.parse(readFileSync(existsSync(own) ? own : join(ROOT, 'fatline.config.example.json'), 'utf8'));
}

export async function main() {
  const config = loadConfig();
  const chosen = process.argv[2] && config.networks[process.argv[2]] ? process.argv[2] : config.defaultNetwork;
  const m = inspectMachine(join(ROOT, '.fatline'));

  console.log(bold('\nThis machine'));
  console.log(`  ${m.os} · ${m.arch} · ${m.cpus} CPUs · ${m.ramGb} GB RAM · ${m.freeDiskGb} GB free disk`);
  console.log(`  ${mark(m.nodeOk)} Node.js ${m.node} ${m.nodeOk ? '' : red('(need 22.12 or newer)')}`);
  console.log(`  ${mark(m.git)} git   ${mark(m.docker === 'running')} docker: ${m.docker}   ${mark(m.forge)} foundry ${m.forge ? '' : dim('(only needed to deploy contracts)')}`);

  console.log(bold('\nNetworks'));
  const reachable = {};
  for (const [name, n] of Object.entries(config.networks)) {
    for (const node of n.nodes) {
      const p = await probe(node.url);
      const tag = node.own ? 'yours' : 'public';
      const detail = p.ok ? green(`in sync (${p.delay} blocks behind, v${p.version}, ${p.ms} ms)`) : dim(`not reachable (${p.error ?? `${p.delay} blocks behind`})`);
      console.log(`  ${mark(p.ok)} ${n.label.padEnd(10)} ${tag.padEnd(6)} ${node.url}  ${detail}`);
      if (p.ok && !reachable[name]) reachable[name] = { ...node };
    }
  }

  console.log(bold(`\nCan this machine run a full node?`));
  const full = {};
  for (const name of Object.keys(FULL_NODE)) {
    full[name] = canRunFull(m, name);
    const c = full[name].checks, r = full[name].need;
    const missing = [
      !c.cpus && `${r.cpus} CPUs`, !c.ram && `${r.ramGb} GB RAM`, !c.disk && `${r.diskGb} GB free disk (have ${m.freeDiskGb})`,
      !c.docker && 'Docker running', !c.os && 'Linux or macOS',
    ].filter(Boolean);
    console.log(`  ${mark(full[name].ok)} ${config.networks[name]?.label ?? name}: ${full[name].ok ? green('yes') : `no — needs ${missing.join(', ')}`}`);
    console.log(`     ${dim(r.note)}`);
  }

  const light = canRunLight(m);
  const label = config.networks[chosen].label;
  let plan;
  if (full[chosen]?.ok) plan = 'full';
  else if (light && reachable[chosen]) plan = 'light';
  else plan = 'rent';

  console.log(bold(`\nRecommendation for ${label}`));
  if (plan === 'full') {
    console.log(`  Run your own ${label} node here, then the indexer and apps:`);
    console.log(`    fatline node ${chosen}`);
    console.log('    fatline up');
    console.log(dim('  The node downloads a snapshot (hundreds of GB) and can take hours to catch up.'));
    console.log(dim('  It also needs ports 3381-3383 (TCP and UDP) reachable from the internet.'));
  } else if (plan === 'light') {
    const r = reachable[chosen];
    console.log(`  This machine can't hold a ${label} node. Your own node can live somewhere else:`);
    whereElse();
    console.log(`  Meanwhile, this machine can run your client now,`);
    console.log(`  reading ${label} from ${r.url} (${r.own ? 'your node' : yellow('a public node you do not control')}).`);
    console.log('    fatline up');
    if (!r.own) {
      console.log(dim('  The app always shows which node it reads from. To be fully independent later,'));
      console.log(dim('  run a node on a bigger machine and put its URL first in fatline.config.json.'));
    }
  } else {
    console.log(`  Nothing here can run Fatline for ${label} right now.`);
    if (!m.nodeOk) console.log(`  ${red('•')} Install Node.js 22.12+ (https://nodejs.org) and run doctor again; or`);
    whereElse();
  }

  function whereElse() {
    console.log('    cloud     a server by the day, paid in USDC from your own wallet (~11 USDC/day): fatline compute');
    console.log('    hetzner   your own Hetzner account, card, hourly (~$2.60/day): fatline compute hetzner');
    console.log('    vps       a server you already have, any provider: fatline compute vps root@<ip>');
    console.log(dim('  fatline setup asks, and walks you through the one you pick.'));
  }

  const report = { checkedAt: new Date().toISOString(), network: chosen, machine: m, full, light, reachable, plan };
  mkdirSync(join(ROOT, '.fatline'), { recursive: true });
  writeFileSync(join(ROOT, '.fatline/doctor.json'), JSON.stringify(report, null, 2));
  console.log(dim(`\n  Saved to .fatline/doctor.json\n`));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((r) => process.exit(r.plan === 'rent' ? 2 : 0));
}
