#!/usr/bin/env node
// fatline dashboard            your servers and nodes on http://localhost:8790 (only this machine can open it)
// fatline dashboard add <host> [--name NAME]     watch another server of yours
// fatline dashboard remove <host>
//
// What it watches, from .fatline/dashboard.json (made on first run from what this machine already knows:
// the servers `fatline compute` rented and the nodes marked as yours in fatline.config.json):
//   - each server's own numbers (CPU, memory, every disk, containers), which it writes every 5 minutes to
//     http://<host>:8099/stats.json (infra/server-stats.sh);
//   - each node's /v1/info: how far behind its worst shard is, messages, version.
// The page asks this process; this process asks the servers (they speak plain http, so a browser can't).
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.fatline');
const FILE = process.env.FATLINE_DASHBOARD_FILE ?? join(STATE, 'dashboard.json');
const PORT = Number(process.env.FATLINE_DASHBOARD_PORT ?? 8790);
const PORTS = { snapchain: 3381, hypersnap: 4381 };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** The servers to watch: the saved list, or one made from what this machine already knows. */
export function discover({ state = STATE, root = ROOT } = {}) {
  const hosts = new Map();
  const add = (host, name, extra = {}) => {
    if (!host || /^(127\.|localhost)/.test(host)) return;
    hosts.set(host, { name: hosts.get(host)?.name ?? name, host, ...hosts.get(host), ...extra });
  };
  for (const f of ['hetzner.json', 'hetzner-hypersnap.json']) {
    const h = readJson(join(state, f));
    if (h?.ipv4) add(h.ipv4, `Hetzner ${h.type ?? ''} ${h.location ?? ''}`.replace(/\s+/g, ' ').trim());
  }
  const config = readJson(join(root, 'fatline.config.json')) ?? {};
  for (const net of Object.values(config.networks ?? {})) {
    for (const n of net.nodes ?? []) if (n.own) { try { add(new URL(n.url).hostname, n.label ?? 'Your node'); } catch {} }
  }
  return { servers: [...hosts.values()].map((s) => ({ name: s.name, host: s.host })) };
}

const load = () => readJson(FILE) ?? (() => { const d = discover(); save(d); return d; })();
const save = (d) => writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n');

async function get(url, ms = 6000) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; } catch { return null; }
}

/** One node: alive and in sync, catching up, or not answering. */
export function nodeState(info, maxDelay = 200) {
  if (!info) return { state: 'down' };
  const shards = (info.shardInfos ?? []).filter((s) => s.shardId !== 0);
  const behind = shards.length ? Math.max(...shards.map((s) => Number(s.blockDelay ?? 0))) : null;
  return {
    state: behind === null ? 'starting' : behind <= maxDelay ? 'alive' : 'catching up',
    behind, shards: shards.map((s) => ({ id: s.shardId, behind: Number(s.blockDelay ?? 0) })),
    messages: info.dbStats?.numMessages ?? null, version: info.version ?? null,
  };
}

async function check(server) {
  const [stats, ...nodes] = await Promise.all([
    get(`http://${server.host}:8099/stats.json`),
    ...Object.entries(PORTS).map(async ([network, port]) => ({ network, port, ...nodeState(await get(`http://${server.host}:${port}/v1/info`)) })),
  ]);
  return { ...server, stats, statsAgeSec: stats?.at ? Math.round((Date.now() - Date.parse(stats.at)) / 1000) : null, nodes: nodes.filter((n) => n.state !== 'down' || stats?.nodes?.some((c) => c.container.startsWith(n.network))) };
}

function cli() {
  const [cmd, host] = process.argv.slice(2);
  if (cmd === 'add' || cmd === 'remove') {
    if (!host) { console.error(`Usage: fatline dashboard ${cmd} <host>`); process.exit(1); }
    const d = load();
    d.servers = d.servers.filter((s) => s.host !== host);
    if (cmd === 'add') { const i = process.argv.indexOf('--name'); d.servers.push({ name: i > 0 ? process.argv[i + 1] : host, host }); }
    save(d);
    console.log(`${cmd === 'add' ? 'Watching' : 'Stopped watching'} ${host}. Servers: ${d.servers.map((s) => s.host).join(', ') || 'none'}.`);
    return true;
  }
  return false;
}

if (import.meta.url === `file://${process.argv[1]}` && !cli()) {
  const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'dashboard.html'));
  createServer(async (req, res) => {
    if (req.url === '/api/status') {
      const d = load();
      const servers = await Promise.all(d.servers.map(check));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ at: new Date().toISOString(), file: FILE, servers }));
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  }).listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    const d = load();
    console.log(`Dashboard: ${url}  (only this machine can open it; Ctrl-C stops it)`);
    console.log(`Watching ${d.servers.length} server${d.servers.length === 1 ? '' : 's'}: ${d.servers.map((s) => s.host).join(', ') || 'none yet: fatline dashboard add <host>'}`);
    if (!process.argv.includes('--no-open')) spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
  });
}
