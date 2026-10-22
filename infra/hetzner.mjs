// ./infinicaster compute hetzner [--type cx43] [--location nbg1] [--disk 700] [--quote]
// ./infinicaster compute hetzner status
// ./infinicaster compute hetzner down        (deletes everything this created; billing stops)
//
// A read node on Hetzner Cloud, billed by the hour, paid by card on your own Hetzner account.
// Cheaper than the USDC sellers today (about $2.50/day with 16 GB RAM and 700 GB of disk), but it
// needs an account and a card. The USDC path (./infinicaster compute --provider agentmetal) stays.
//
// The API token is read from ~/.hetzner-token (mode 600) or HETZNER_TOKEN. It is never printed.
// Every resource created is written to .infinicaster/hetzner.json, so `down` can remove exactly those.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.infinicaster');
const RECORD = join(STATE, 'hetzner.json');
// Volumes other tools attached to the same server (e.g. Hypersnap): { "volumeIds": [..] } or { "volumeId": n }.
const EXTRA_RECORDS = [join(STATE, 'hetzner-hypersnap.json')];
const extraVolumes = () => EXTRA_RECORDS.filter((f) => existsSync(f)).flatMap((f) => {
  const r = JSON.parse(readFileSync(f, 'utf8'));
  return (r.volumeIds ?? (r.volumeId ? [r.volumeId] : [])).map((id) => ({ id, file: f }));
});
const SSH_KEY = join(STATE, 'ssh_ed25519');
const API = 'https://api.hetzner.cloud/v1';

function token() {
  if (process.env.HETZNER_TOKEN) return process.env.HETZNER_TOKEN.trim();
  const file = join(homedir(), '.hetzner-token');
  if (!existsSync(file)) throw new Error('No Hetzner API token. Put it in ~/.hetzner-token (chmod 600) or HETZNER_TOKEN.');
  return readFileSync(file, 'utf8').trim();
}

async function hz(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = res.status === 204 ? {} : await res.json();
  if (!res.ok) throw new Error(`Hetzner ${method} ${path}: ${out.error?.message ?? res.status}`);
  return out;
}

function args() {
  const a = process.argv.slice(2);
  const get = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : d; };
  return {
    command: a[0] && !a[0].startsWith('--') ? a[0] : 'up',
    type: get('type', 'cx43'), location: get('location', 'nbg1'), disk: Number(get('disk', '700')),
    quote: a.includes('--quote'), yes: a.includes('--yes'),
  };
}

const ask = (q) => new Promise((done) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (x) => { rl.close(); done(x.trim()); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sshArgs = () => ['-i', SSH_KEY, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${join(STATE, 'known_hosts')}`, '-o', 'ConnectTimeout=20'];
const save = (r) => writeFileSync(RECORD, JSON.stringify(r, null, 2));

async function price(opts) {
  const { pricing } = await hz('GET', '/pricing');
  const type = pricing.server_types.find((t) => t.name === opts.type);
  const hourly = Number(type?.prices.find((p) => p.location === opts.location)?.price_hourly.gross);
  if (!hourly) throw new Error(`No price for ${opts.type} in ${opts.location}.`);
  const ip = Number(pricing.primary_ips?.[0]?.prices?.find((p) => p.location === opts.location)?.price_hourly?.gross ?? 0);
  const disk = (Number(pricing.volume.price_per_gb_month.gross) * opts.disk) / 730;
  const perHour = hourly + ip + disk;
  return { currency: pricing.currency, perHour, perDay: perHour * 24 };
}

async function up(opts) {
  // A run that stopped halfway (for example Hetzner had no room) is resumed: its volume and key are reused.
  const old = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : null;
  if (old?.serverId) throw new Error('A Hetzner node already exists (see .infinicaster/hetzner.json). Use `status` or `down`.');
  if (old && old.location !== opts.location) throw new Error(`An unfinished run left a volume in ${old.location}. Use --location ${old.location}, or \`down\` first.`);
  const spec = (await hz('GET', `/server_types?name=${opts.type}`)).server_types[0];
  if (!spec) throw new Error(`Unknown server type ${opts.type}.`);
  // Hetzner sells out of some types. Check before creating anything, and say what is in stock instead.
  if (!spec.locations?.find((l) => l.name === opts.location)?.available) {
    const all = (await hz('GET', '/server_types?per_page=50')).server_types;
    const inStock = all.filter((t) => t.memory >= 16 && !t.deprecation && t.locations?.find((l) => l.name === opts.location)?.available)
      .map((t) => `${t.name} (${t.cores} CPU, ${t.memory} GB, ${t.architecture})`);
    throw new Error(`${opts.type} is sold out in ${opts.location}. In stock there with 16 GB+: ${inStock.join(', ') || 'none'}. Use --type <name>.`);
  }
  const p = await price(opts);
  console.log(`
  What you get   ${spec.cores} CPU · ${spec.memory} GB RAM · ${spec.disk} GB disk + ${opts.disk} GB volume, ${opts.location}
  Price          ~${p.perHour.toFixed(4)} ${p.currency}/hour = ~${p.perDay.toFixed(2)} ${p.currency}/day, billed by the hour on your Hetzner account
  Stop paying    ./infinicaster compute hetzner down   (deletes the server and the volume)
  It will run    a Farcaster read node: streamed snapshot (~600 GB), 1 day of blocks
`);
  if (opts.quote) return console.log('Quote only. Nothing was created.');
  if (!opts.yes && (await ask('Type "create" to create it: ')) !== 'create') return console.log('Stopped. Nothing was created.');

  mkdirSync(STATE, { recursive: true });
  if (!existsSync(SSH_KEY)) execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'infinicaster', '-f', SSH_KEY]);
  const record = old ?? { location: opts.location, createdAt: new Date().toISOString() };
  record.type = opts.type;
  record.name ??= `infinicaster-node-${Date.now().toString(36)}`;
  save(record);
  const name = record.name;

  if (!record.sshKeyId) {
    const key = await hz('POST', '/ssh_keys', { name, public_key: readFileSync(`${SSH_KEY}.pub`, 'utf8').trim() });
    record.sshKeyId = key.ssh_key.id; save(record);
  }
  if (!record.volumeId) {
    const volume = await hz('POST', '/volumes', { name, size: opts.disk, location: opts.location, format: 'ext4', automount: false });
    record.volumeId = volume.volume.id; save(record);
    console.log(`Created a ${opts.disk} GB volume (${record.volumeId}).`);
  } else console.log(`Reusing the ${opts.disk} GB volume from the unfinished run (${record.volumeId}).`);

  const server = await hz('POST', '/servers', {
    name, server_type: opts.type, location: opts.location, image: 'ubuntu-24.04',
    ssh_keys: [record.sshKeyId], volumes: [record.volumeId], automount: true,
    labels: { app: 'infinicaster' },
  });
  record.serverId = server.server.id;
  record.ipv4 = server.server.public_net.ipv4?.ip;
  save(record);
  console.log(`Created server ${record.serverId} at ${record.ipv4}. Waiting for SSH…`);

  for (let i = 0; i < 60; i++) {
    if (spawnSync('ssh', [...sshArgs(), `root@${record.ipv4}`, 'true']).status === 0) break;
    await sleep(10_000);
  }
  const put = spawnSync('ssh', [...sshArgs(), `root@${record.ipv4}`, 'cat > /root/node-setup.sh && chmod +x /root/node-setup.sh'], { input: readFileSync(join(ROOT, 'infra/node-setup.sh')) });
  if (put.status !== 0) throw new Error('Could not copy the node setup. Retry: ./infinicaster compute hetzner status');
  spawnSync('ssh', [...sshArgs(), `root@${record.ipv4}`, 'setsid nohup /root/node-setup.sh > /root/node-setup.log 2>&1 < /dev/null &']);
  console.log('The node setup is running on the server (the snapshot takes a few hours). Follow it: ./infinicaster compute hetzner status');
}

async function status() {
  if (!existsSync(RECORD)) return console.log('No Hetzner node.');
  const r = JSON.parse(readFileSync(RECORD, 'utf8'));
  const hours = (Date.now() - Date.parse(r.createdAt)) / 3_600_000;
  console.log(`Server ${r.serverId} at ${r.ipv4} (${r.type}, ${r.location}), running ${hours.toFixed(1)} h`);
  for (const v of extraVolumes()) console.log(`Also attached: volume ${v.id} (from ${v.file.split('/').pop()})`);
  const remote = `tail -n 3 /root/node-setup.log 2>/dev/null; df -h /mnt/HC_Volume_* 2>/dev/null | sed 1d | awk '{print "volume: " $3 " used, " $4 " free"}'; curl -s -m 5 localhost:3381/v1/info | jq -c '.shardInfos[]? | {shard: .shardId, blockDelay}' 2>/dev/null`;
  spawnSync('ssh', [...sshArgs(), `root@${r.ipv4}`, remote], { stdio: 'inherit' });
}

async function down(opts) {
  if (!existsSync(RECORD)) return console.log('Nothing to delete.');
  const r = JSON.parse(readFileSync(RECORD, 'utf8'));
  const extra = extraVolumes();
  const vols = [r.volumeId, ...extra.map((v) => v.id)].filter(Boolean);
  if (!opts.yes && (await ask(`Delete server ${r.serverId} and volume(s) ${vols.join(', ')} (all node data)? Type "delete": `)) !== 'delete') return console.log('Kept.');
  if (r.serverId) {
    await hz('DELETE', `/servers/${r.serverId}`).catch((e) => console.log(e.message));
    console.log('Server deleted.');
  }
  for (const id of vols) {
    // A volume can only be deleted once the server that held it is gone.
    for (let i = 0; i < 30; i++) {
      const v = await hz('GET', `/volumes/${id}`).catch(() => null);
      if (!v || !v.volume.server) break;
      await sleep(5_000);
    }
    await hz('DELETE', `/volumes/${id}`).catch((e) => console.log(e.message));
    console.log(`Volume ${id} deleted.`);
  }
  for (const v of extra) rmSync(v.file, { force: true });
  if (r.sshKeyId) await hz('DELETE', `/ssh_keys/${r.sshKeyId}`).catch(() => {});
  rmSync(RECORD);
  console.log('Everything this created is gone. Billing has stopped.');
}

const opts = args();
const commands = { up, status, down, quote: (o) => up({ ...o, quote: true }) };
if (!commands[opts.command]) { console.error('Usage: compute hetzner [--quote] | status | down'); process.exit(1); }
commands[opts.command](opts).catch((err) => { console.error(`\n${err.message}`); process.exit(1); });
