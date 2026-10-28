// Disk and sync watch for the node servers: when a node's volume runs low, grow it; when a node stops answering, a
// shard stops moving, or it falls behind without catching up, shout on Telegram. (Hypersnap stood still for four
// days, 2026-10-24..28, answering every request, before anyone saw it.)
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
  { name: 'Snapchain (FATLINE master)', ip: '46.225.208.199', volumeId: 107233477, mount: '/mnt/HC_Volume_107233477', base: 700, port: 3381 },
  // Grown to 1,000 GB on 2026-10-28 once Hetzner raised the account's limit (owner's go); running again.
  // `ready`: no sync alerts until this file exists (the setup writes it when the snapshot is unpacked).
  { name: 'Hypersnap', ip: '46.225.208.199', volumeId: 107234161, mount: '/mnt/HC_Volume_107234161', base: 1000, port: 4381,
    ready: '/mnt/HC_Volume_107234161/hypersnap/.snapshot-done' },
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

// Sync: read /v1/info on the server itself (so a firewall can't fake an outage). A problem is a node that doesn't
// answer, a shard whose height hasn't moved since the last check (~30 min), or a node more than BEHIND blocks behind
// that isn't closing the gap. Catching up after a restart or a new snapshot is not a problem. Shard 0 (the block
// shard) is left out, as everywhere in Fatline: messages live in shards 1 and 2, and a read node's shard 0 often lags.
const BEHIND = 1800; // blocks, about 30 minutes
const msgShards = (info) => (info?.shardInfos ?? []).filter((x) => x.shardId !== 0);
export function syncProblem(info, prev) {
  if (!msgShards(info).length) return 'not answering';
  info = { shardInfos: msgShards(info) };
  const heights = Object.fromEntries(info.shardInfos.map((x) => [x.shardId, x.maxHeight]));
  const worst = Math.max(...info.shardInfos.map((x) => x.blockDelay ?? 0));
  const still = prev?.heights ? Object.keys(heights).filter((k) => prev.heights[k] !== undefined && heights[k] <= prev.heights[k]) : [];
  if (still.length) return `shard ${still.join(', ')} has not moved since the last check (height ${still.map((k) => heights[k]).join(', ')})`;
  if (worst > BEHIND && prev?.worst !== undefined && worst >= prev.worst) return `${worst.toLocaleString('en-US')} blocks behind and not catching up`;
  return null;
}
async function checkSync(n) {
  if (n.ready && ssh(n.ip, `[ -f ${n.ready} ] && echo yes || echo no`).trim() !== 'yes') { console.log(`  ${n.name}: still setting up; no sync alerts`); return; }
  let info = null;
  try { info = JSON.parse(ssh(n.ip, `curl -s -m 10 localhost:${n.port}/v1/info`)); } catch {}
  const key = `sync:${n.port}`, prev = state[key];
  const problem = syncProblem(info, prev);
  const now = { at: Date.now(), alertAt: prev?.alertAt ?? 0, alerting: prev?.alerting ?? false };
  if (msgShards(info).length) {
    now.heights = Object.fromEntries(msgShards(info).map((x) => [x.shardId, x.maxHeight]));
    now.worst = Math.max(...msgShards(info).map((x) => x.blockDelay ?? 0));
  }
  console.log(`  ${n.name} ${info?.version ?? ''}: ${problem ?? `ok, worst shard ${now.worst} blocks behind`}`);
  if (problem) {
    if (Date.now() - now.alertAt >= ALERT_EVERY_H * 3600_000) {
      const msg = `🚨 ${n.name} (${n.ip}:${n.port}) ${problem}. Check: curl -s ${n.ip}:${n.port}/v1/info`;
      if (dry) console.log(`  would send: ${msg}`); else { await telegram(msg); now.alertAt = Date.now(); }
    }
    now.alerting = true;
  } else if (now.alerting) {
    const msg = `✅ ${n.name} is moving again (worst shard ${now.worst} blocks behind).`;
    if (dry) console.log(`  would send: ${msg}`); else await telegram(msg);
    now.alerting = false; now.alertAt = 0;
  }
  // Heights from a node that didn't answer are kept, so "not moved" still compares against the last real reading.
  if (!msgShards(info).length) { now.heights = prev?.heights; now.worst = prev?.worst; }
  if (!dry) state[key] = now;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const n of NODES) {
    try { await check(n); } catch (err) {
      console.error(`${n.name}: ${err.message}`);
      try { await telegram(`⚠️ Disk watch for ${n.name} failed: ${err.message}`); } catch {}
    }
    try { await checkSync(n); } catch (err) {
      console.error(`${n.name} sync: ${err.message}`);
      try { await telegram(`⚠️ Sync watch for ${n.name} failed: ${err.message}`); } catch {}
    }
  }
  save();
}
