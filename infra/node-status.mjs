// fatline status, the "Your nodes" part: for each node of yours, what it is doing, in plain words.
// A node that doesn't answer yet is usually being born (downloading or unpacking its snapshot, or starting): this
// logs in to its server and says which, with progress. If something is wrong it says what, writes a bug report
// (.fatline/reports/<time>.md) and prints a prompt to give to your agent.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.fatline');
const SCRIPT = { farcaster: 'node-setup.sh', hypersnap: 'hypersnap-setup.sh' };
const LABEL = { farcaster: 'Snapchain', hypersnap: 'Hypersnap' };
const ago = (s) => { s = Number(s); return s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} hours` : `${Math.round(s / 86400)} days`; };
const read = (f) => { try { return JSON.parse(readFileSync(join(STATE, f), 'utf8')); } catch { return null; } };

/** What the server's setup is doing, from what it printed. Pure: { state: 'downloading'|'unpacking'|'starting'|'problem', say, detail? } */
export function classify({ running, log = '', docker = '' }) {
  const lines = log.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean);
  const err = lines.find((l) => /FATLINE_ERROR/.test(l));
  if (err) return { state: 'problem', say: err.replace(/^.*FATLINE_ERROR:\s*/, ''), detail: lines.slice(-20).join('\n') };
  const shards = {};
  for (const l of lines) { const m = l.match(/shard (\d+): (\d+)\/(\d+)/); if (m) shards[m[1]] = [Number(m[2]), Number(m[3])]; }
  const started = lines.some((l) => /Starting Snapchain|Starting Hypersnap|Starting the node/i.test(l));
  const up = /Up /.test(docker);
  if (started && up) return { state: 'starting', say: 'the download is done; the node is opening its database (a few minutes), then it catches up to the network' };
  if (running && lines.some((l) => /Snapshot unpacked/.test(l))) return { state: 'unpacking', say: 'the snapshot is downloaded and unpacked; starting the node' };
  if (running && Object.keys(shards).length) {
    const done = Object.values(shards).reduce((a, [n]) => a + n, 0), total = Object.values(shards).reduce((a, [, t]) => a + t, 0);
    const per = Object.entries(shards).map(([s, [n, t]]) => `shard ${s} ${Math.round((100 * n) / t)}%`).join(', ');
    return { state: 'downloading', say: `downloading its snapshot: ${Math.round((100 * done) / total)}% (${per}), about ${Math.round((done * 70) / 1024)} of ${Math.round((total * 70) / 1024)} GB` };
  }
  if (running) return { state: 'downloading', say: `setting up: ${lines.at(-1) ?? 'starting'}` };
  if (!lines.length) return { state: 'problem', say: 'its setup never started on the server. Run: fatline node snapchain' };
  if (started && !up) return { state: 'problem', say: 'the node was started but is not running on the server', detail: lines.slice(-20).join('\n') };
  return { state: 'problem', say: `its setup stopped before the node was running. Last line: "${lines.at(-1)}"`, detail: lines.slice(-20).join('\n') };
}

function server(net) {
  const own = net === 'hypersnap' ? read('hetzner-hypersnap.json') : null;
  return own ?? read('hetzner.json') ?? read('compute.json') ?? read('vps.json');
}

function ssh(ip, cmd) {
  return spawnSync('ssh', ['-i', join(STATE, 'ssh_ed25519'), '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${join(STATE, 'known_hosts')}`, '-o', 'ConnectTimeout=12', '-o', 'BatchMode=yes', '-o', 'LogLevel=ERROR', `root@${ip}`, cmd], { encoding: 'utf8' });
}

function report(net, url, d, extra = '') {
  mkdirSync(join(STATE, 'reports'), { recursive: true });
  const at = new Date().toISOString();
  const file = join(STATE, 'reports', `${at.replace(/[:.]/g, '-')}-${net}-node.md`);
  writeFileSync(file, `# Fatline: my ${LABEL[net]} node is not working

- When: ${at}
- Node: ${url}
- What \`fatline status\` says: ${d.say}
- Fatline version: ${spawnSync('git', ['-C', ROOT, 'log', '-1', '--format=%h %cs'], { encoding: 'utf8' }).stdout.trim()}

## What the server printed last

\`\`\`
${d.detail ?? '(nothing)'}
\`\`\`
${extra}
## For the agent fixing this

The node is installed by \`infra/node-setup.sh\` (Snapchain) or \`infra/hypersnap-setup.sh\`, copied to the server and run by
\`fatline node ${net === 'hypersnap' ? 'hypersnap' : 'snapchain'}\` (infra/node-remote.mjs), which logs to /root/${net}-setup.log there. The server's address and
SSH key are in .fatline/ (compute.json or hetzner.json or vps.json, ssh_ed25519). Find the cause, fix it on the server or in
the code, and say what you changed. Never print or move private keys.
`);
  return file;
}

export async function describe(net, url) {
  const info = await fetch(`${url}/v1/info`, { signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => null);
  if (info) {
    const worst = Math.max(0, ...(info.shardInfos ?? []).filter((x) => x.shardId !== 0).map((x) => Number(x.blockDelay ?? 0)));
    return { state: worst <= 50 ? 'in sync' : 'catching up', say: worst <= 50 ? `in sync (${LABEL[net]} ${info.version})` : `catching up: ${ago(worst)} behind the network (${LABEL[net]} ${info.version})` };
  }
  if (/127\.0\.0\.1|localhost/.test(url)) return { state: 'off', say: 'not running on this machine' };
  const s = server(net);
  const ip = new URL(url).hostname;
  if (!s || s.ipv4 !== ip) return { state: 'problem', say: 'it does not answer, and this machine has no login for that server, so it can\'t say why' };
  const until = Date.parse(s.expiresAt ?? s.expires_at ?? s.paidUntil ?? s.paid_until ?? '');
  if (until && until < Date.now()) return { state: 'problem', say: `its server's paid time ended at ${new Date(until).toISOString().slice(0, 16)} UTC. Renew it: fatline compute renew --days 1` };
  const r = ssh(ip, `pgrep -f ${SCRIPT[net]} >/dev/null && echo RUN=yes || echo RUN=no; echo ===LOG; tail -n 60 /root/${net}-setup.log 2>/dev/null; echo ===DOCKER; docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -i ${net === 'hypersnap' ? 'hypersnap' : 'snapchain'}-1`);
  if (r.status !== 0 && !r.stdout) return { state: 'problem', say: `it does not answer, and its server (${ip}) does not accept a login either: it may still be booting, or be down. ${r.stderr.trim().slice(0, 120)}` };
  const [head, rest = ''] = r.stdout.split('===LOG');
  const [log, docker = ''] = rest.split('===DOCKER');
  const d = classify({ running: /RUN=yes/.test(head), log, docker });
  // How long until the download is done: from the progress since the last time you asked (kept in .fatline).
  const m = d.state === 'downloading' && d.say.match(/about (\d+) of (\d+) GB/);
  if (m) {
    const file = join(STATE, `node-progress-${net}.json`), now = Date.now(), gb = Number(m[1]), total = Number(m[2]);
    const prev = read(`node-progress-${net}.json`);
    if (prev && now - prev.t < 3_600_000 && gb > prev.gb) {
      const left = Math.round((total - gb) / ((gb - prev.gb) / ((now - prev.t) / 60_000)));
      d.say += `; about ${left < 90 ? `${left} min` : `${Math.round(left / 60)} hours`} left at this speed`;
    } else if (!prev || now - prev.t >= 3_600_000) d.say += '; ask again in a minute for how long is left';
    if (!prev || now - prev.t > 30_000) writeFileSync(file, JSON.stringify({ t: now, gb }));
  }
  return d;
}

async function main() {
  let c = {}; try { c = JSON.parse(readFileSync(join(ROOT, 'fatline.config.json'), 'utf8')); } catch {}
  const own = Object.entries(c.networks ?? {}).flatMap(([net, n]) => (n.nodes ?? []).filter((x) => x.own).map((x) => ({ net, url: x.url.replace(/\/$/, '') })));
  const remote = own.filter((o) => !/127\.0\.0\.1|localhost/.test(o.url));
  const list = remote.length ? remote : own;
  if (!list.length) return console.log('  none yet. Rent one: fatline compute   (or use Fatline without a node: light mode)');
  for (const { net, url } of list) {
    const d = await describe(net, url);
    const icon = { 'in sync': '●', 'catching up': '◐', downloading: '◌', unpacking: '◌', starting: '◌', off: '○', problem: '✗' }[d.state] ?? '·';
    console.log(`  ${icon} ${LABEL[net] ?? net} at ${url}: ${d.state === 'downloading' || d.state === 'unpacking' || d.state === 'starting' ? `being born, ${d.say}` : d.say}`);
    if (d.state === 'problem') {
      const file = report(net, url, d);
      console.log(`\n    Something is wrong. A report is in ${file}`);
      console.log('    Ask your agent to fix it:');
      console.log(`      claude "Please fix this Fatline problem: ${file}"`);
      console.log(`      codex "Please fix this Fatline problem: ${file}"\n`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`  ${e.message}`); process.exit(1); });
