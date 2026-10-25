// Disk watch for the node servers: when a node's volume runs low, grow it, and shout on Telegram.
//
//   node infra/disk-guard.mjs            check now (launchd runs this every 30 min)
//   node infra/disk-guard.mjs --dry-run  check and say what it would do, change nothing
//
// The owner approved growing the volumes when they near their limit (2026-10-23): +50 GB each time,
// at most +200 GB over the size recorded in GROW_CAP below. Volumes can grow but never shrink, and each
// 50 GB costs about $3.84 a month. If Hetzner refuses (account volume limit), it alerts instead.
// Secrets: ~/.hetzner-token, Telegram files (see budget-alert.mjs). Never printed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { telegram } from './budget-alert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.fatline/disk-guard-state.json');
const MIN_FREE_GB = 25;   // grow below this
const STEP_GB = 50;
const ALERT_EVERY_H = 2;  // repeat a failed-grow alert at most this often

// Both volumes are on the one server (since 2026-10-23).
const NODES = [
  { name: 'Snapchain (FATLINE master)', ip: '46.225.208.199', volumeId: 107233477, mount: '/mnt/HC_Volume_107233477', base: 700 },
  { name: 'Hypersnap', ip: '46.225.208.199', volumeId: 107234161, mount: '/mnt/HC_Volume_107234161', base: 685,
    paused: 'stopped on 2026-10-25, disk full, waiting for Hetzner to raise the volume limit (/root/hypersnap-paused.txt)' },
];
const GROW_CAP = 200; // GB over `base`, the size each volume had when this was approved

const dry = process.argv.includes('--dry-run');
const token = () => readFileSync(join(homedir(), '.hetzner-token'), 'utf8').trim();
async function hz(method, path, body) {
  const res = await fetch(`https://api.hetzner.cloud/v1${path}`, {
    method, headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Hetzner ${json.error?.code ?? res.status}: ${json.error?.message ?? ''}`.trim());
  return json;
}
function ssh(ip, cmd) {
  return execFileSync('ssh', ['-n', '-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes', '-i', join(ROOT, '.fatline/ssh_ed25519'), '-o', 'IdentitiesOnly=yes',
    '-o', `UserKnownHostsFile=${join(ROOT, '.fatline/known_hosts')}`, `root@${ip}`, cmd], { encoding: 'utf8', timeout: 300_000 });
}
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');

async function check(n) {
  const [avail, size] = ssh(n.ip, `df -BG --output=avail,size ${n.mount} | tail -1`).trim().split(/\s+/).map((x) => parseInt(x, 10));
  const vol = (await hz('GET', `/volumes/${n.volumeId}`)).volume;
  console.log(`${new Date().toISOString()} ${n.name}: ${avail} GB free of ${size} GB (volume ${vol.size} GB)`);
  if (avail >= MIN_FREE_GB) { delete state[n.volumeId]; return; }
  if (n.paused) { console.log(`  paused: ${n.paused}; no alert`); return; } // a node stopped on purpose
  const target = vol.size + STEP_GB;
  let problem;
  if (target > n.base + GROW_CAP) problem = `already grown to the approved cap (${n.base + GROW_CAP} GB)`;
  else if (dry) { console.log(`  would grow ${vol.size} → ${target} GB`); return; }
  else {
    try {
      const { action } = await hz('POST', `/volumes/${n.volumeId}/actions/resize`, { size: target });
      for (let i = 0; i < 60; i++) {
        const a = (await hz('GET', `/actions/${action.id}`)).action;
        if (a.status === 'success') break;
        if (a.status === 'error') throw new Error(a.error?.message ?? 'resize failed');
        await new Promise((r) => setTimeout(r, 5000));
      }
      // ext4 grows online, the node keeps running.
      ssh(n.ip, `resize2fs $(findmnt -n -o SOURCE ${n.mount})`);
      const after = ssh(n.ip, `df -BG --output=avail ${n.mount} | tail -1`).trim();
      const msg = `💾 ${n.name}: disk was at ${avail} GB free, grew the volume ${vol.size} → ${target} GB (+$3.84/month). Now ${after} free.`;
      console.log(msg); await telegram(msg); delete state[n.volumeId]; return;
    } catch (err) { problem = `Hetzner refused to grow it: ${err.message}`; }
  }
  const last = state[n.volumeId]?.alertAt ?? 0;
  if (Date.now() - last < ALERT_EVERY_H * 3600_000) return;
  const msg = `🚨🚨 ${n.name} DISK ALMOST FULL: ${avail} GB free. ${problem}. When it fills, the node stops. `
    + (problem.includes('limit') ? 'Ask Hetzner to raise the volume limit (Console → Limits), or I need to free space.' : 'Decide: grow more or free space.');
  console.log(msg); await telegram(msg);
  state[n.volumeId] = { alertAt: Date.now() }; save();
}

for (const n of NODES) {
  try { await check(n); } catch (err) {
    console.error(`${n.name}: ${err.message}`);
    try { await telegram(`⚠️ Disk watch for ${n.name} failed: ${err.message}`); } catch {}
  }
}
save();
