import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { Api } from './api.mjs';
import { loadConfig } from './config.mjs';
import { openDb } from './db.mjs';
import { Network } from './hub.mjs';
import { VoicesIndex } from './voices.mjs';
import { useFatlineApp } from './fatline-app.mjs';
import { WalletLogin } from './login.mjs';
import { Launchpad } from './launchpad.mjs';
import { Keeper } from './keeper.mjs';
import { Writer, loadAppKey } from './writer.mjs';
import { attesterList, hatcheryConfig } from './hatchery-run.mjs';
import { NodeMonitor } from './nodes.mjs';
import { makeCockpit } from './cockpit.mjs';
import { Coins } from './coin.mjs';
import { Archive, TYPES as ARCHIVE_TYPES } from './archive.mjs';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ROOT } from './config.mjs';
import { base, baseSepolia, foundry } from 'viem/chains';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

export function buildServer({ config, networks, voices, launchpad, keeper = null, nodes = null, coins = null, archive = null }) {
  const api = new Api({ config, networks, voices, launchpad });
  coins ??= nodes ? new Coins({ launchpad, nodes, networks, config, keeper }) : null;
  const needCoins = () => { if (!coins) throw Object.assign(new Error('Node monitoring is not set up on this server.'), { status: 503 }); return coins; };

  // Posting signs with this client's app key, so only its owner may ask for it:
  // requests made on this machine directly, or (behind a proxy, on a server) with the write token.
  const writeToken = process.env.FATLINE_WRITE_TOKEN
    ?? (existsSync(join(config.dataDir, 'write.token')) ? readFileSync(join(config.dataDir, 'write.token'), 'utf8').trim() : null);
  const mayWrite = (req) => {
    // Other websites open in the same browser must not be able to post through this client.
    const origin = req.headers.origin;
    if (origin) { // "null" too: sandboxed frames, like the apps shown inside this one
      try { if (new URL(origin).host !== req.headers.host) return false; } catch { return false; }
    }
    if (req.method === 'POST' && !/^application\/json/.test(req.headers['content-type'] ?? '')) return false;
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for']
      && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host ?? ''); // and not a rebound DNS name
    if (local) return true;
    const given = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    return Boolean(writeToken && given.length === writeToken.length && timingSafeEqual(Buffer.from(given), Buffer.from(writeToken)));
  };
  const writer = (network, node) => {
    const key = loadAppKey(config.dataDir);
    if (!key) throw Object.assign(new Error('This client has no app key yet. Run fatline identity on the machine that runs it.'), { status: 409 });
    const name = network && networks[network] ? network : key.network;
    // Posts go to the network the person chose, through the node they chose (no fallback), or the automatic one.
    return new Writer({ network: node ? networks[name].pinned(node) : networks[name], key });
  };
  const write = (fn) => (q, m, body, req) => {
    if (!mayWrite(req)) throw Object.assign(new Error('Posting is only allowed from this machine, or with its write token.'), { status: 401 });
    return fn(writer(body?.network ?? q.get('network'), body?.node ?? q.get('node')), body ?? {});
  };

  // Log in with a wallet (the account's custody address): a QR code, one signature, an app key for this client.
  const login = new WalletLogin({ config, networks, root: ROOT });
  const owner = (fn) => (q, m, body, req) => {
    if (!mayWrite(req)) throw Object.assign(new Error('Logging in is only allowed from this machine, or with its write token.'), { status: 401 });
    return fn();
  };

  const cockpit = makeCockpit({ config, networks, api });
  const sel = (q) => ({ name: q.get('network'), node: q.get('node') });
  const routes = [
    // The cockpit: you, your nodes, your egg or Fatliner, and its hatching, in one answer (the client's home).
    ['GET', /^\/api\/cockpit$/, () => cockpit()],
    ['GET', /^\/api\/fatline$/, () => config.fatlineApp ?? null],
    ['GET', /^\/api\/login$/, owner(() => login.status())],
    ['POST', /^\/api\/login$/, owner(() => login.start())],
    ['GET', /^\/api\/health$/, () => ({ ok: true, voices: voices.status(), launchpad: launchpad.status(), keeper: keeper?.status() ?? null })],
    ['GET', /^\/api\/apps$/, () => launchpad.list()],
    ['GET', /^\/api\/apps\/(0x[0-9a-fA-F]{40})$/, async (q, [, address]) => {
      const app = await launchpad.get(address);
      if (!app) throw Object.assign(new Error('No app with that vault or coin'), { status: 404 });
      return app;
    }],
    // Fatline: a coin, its node and its money. Public and read-only; no wallet needed.
    ['GET', /^\/api\/coin\/([^/]+)\/([^/]+)$/, (q, [, chainId, address]) => needCoins().get(chainId, address)],
    ['GET', /^\/api\/coin\/([^/]+)\/([^/]+)\/activity$/, (q, [, chainId, address]) => needCoins().activity(chainId, address, { before: q.get('before'), limit: q.get('limit') })],
    ['GET', /^\/api\/nodes$/, () => needCoins().overview()],
    // Fatline archive: one FID's messages from every network adapter, each with its own status per network.
    ['GET', /^\/api\/archive(?:\/(\d{1,12}))?$/, (q, [, fid]) => {
      if (!archive) throw Object.assign(new Error('The archive is not set up on this server.'), { status: 503 });
      const own = loadAppKey(config.dataDir)?.fid ?? null;
      const who = fid ? Number(fid) : own;
      if (!who) throw Object.assign(new Error('This client has no FID yet. Run fatline identity.'), { status: 404 });
      const types = (q.get('types') ?? 'cast').split(',').filter((x) => ARCHIVE_TYPES[x]);
      return { ...archive.read(who, { before: q.get('before'), types: types.length ? types : ['cast'], limit: q.get('limit') }), tracked: archive.fids().includes(who), own: who === own, at: Date.now() };
    }],
    ['GET', /^\/api\/nodes\/([\w-]{1,64})$/, (q, [, id]) => needCoins().nodeDetail(id, { before: q.get('before') })],
    ['POST', /^\/api\/launch\/prepare$/, (q, m, body) => launchpad.prepare(body)],
    ['POST', /^\/api\/apps\/(0x[0-9a-fA-F]{40})\/checkin$/, (q, [, vault], body) => launchpad.queueCheckIn(vault, body)],
    ['GET', /^\/api\/config$/, () => api.config_()],
    ['GET', /^\/api\/networks$/, () => api.networksStatus()],
    ['GET', /^\/api\/feed$/, (q) => api.feed(sel(q), {
      fids: (q.get('fids') ?? '').split(',').filter(Boolean),
      before: q.get('before') ? Number(q.get('before')) : undefined,
      limit: q.get('limit'),
      replies: q.get('replies') === '1',
      apps: {
        hide: (q.get('hideApps') ?? '').split(',').filter((x) => /^\d+$/.test(x)),
        only: (q.get('onlyApps') ?? '').split(',').filter((x) => /^\d+$/.test(x)),
        unknown: q.get('unknownApps') === 'hide' ? 'hide' : 'show',
      },
    })],
    ['GET', /^\/api\/voices\/(\d+)$/, (q, [, id]) => api.voice(sel(q), id)],
    ['GET', /^\/api\/thread$/, (q) => api.thread(sel(q), { fid: q.get('fid'), hash: q.get('hash') })],
    ['GET', /^\/api\/user$/, (q) => api.resolve(sel(q), q.get('q') ?? q.get('fid'))],
    // Your egg, as each attester sees it (the client only reads; laying and hatching are CLI steps).
    ['GET', /^\/api\/egg$/, async () => {
      const key = loadAppKey(config.dataDir);
      if (!key) return { fid: null, attesters: [] };
      const attesters = await attesterList(hatcheryConfig(config))().catch(() => []);
      const seen = await Promise.all(attesters.map(async (a) => {
        try {
          const res = await fetch(`${a.url.replace(/\/$/, '')}/eggs/${key.fid}`, { signal: AbortSignal.timeout(8_000) });
          return { label: a.url, egg: res.ok ? await res.json() : null, error: res.ok || res.status === 404 ? null : `HTTP ${res.status}` };
        } catch (err) {
          return { label: a.url, egg: null, error: err.message };
        }
      }));
      return { fid: key.fid, attesters: seen };
    }],
    ['GET', /^\/api\/me$/, (q, m, b, req) => {
      const key = loadAppKey(config.dataDir);
      if (!key) return { fid: null, canWrite: false };
      return { fid: key.fid, network: key.network, publicKey: key.publicKey, scopes: key.scopes, state: key.state, canWrite: mayWrite(req) };
    }],
    ['POST', /^\/api\/cast$/, write((w, b) => w.cast({ text: b.text, parent: b.parent }))],
    ['POST', /^\/api\/cast\/delete$/, write((w, b) => w.deleteCast({ hash: b.hash }))],
    ['POST', /^\/api\/react$/, write((w, b) => w.react({ kind: b.kind, fid: b.fid, hash: b.hash, remove: Boolean(b.remove) }))],
    ['POST', /^\/api\/follow$/, write((w, b) => w.follow({ fid: b.fid, remove: Boolean(b.remove) }))],
    ['POST', /^\/api\/resend$/, write((w, b) => w.resend(b.message))],
  ];

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    if (url.pathname.startsWith('/api/')) {
      const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!route) return json(res, 404, { error: 'Not found' });
      try {
        const body = req.method === 'POST' ? await readJson(req) : null;
        json(res, 200, await route[2](url.searchParams, url.pathname.match(route[1]), body, req));
      } catch (err) {
        json(res, err.status ?? 502, { error: err.message });
      }
      return;
    }
    serveApp(config.appDir, url.pathname, res);
  });
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw Object.assign(new Error('Body too large'), { status: 413 });
  }
  try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

function serveApp(dir, pathname, res) {
  if (!existsSync(dir)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('The indexer is running. The app is not built yet: run fatline up\nAPI: /api/networks, /api/feed\n');
  }
  let file = normalize(join(dir, decodeURIComponent(pathname)));
  if (!file.startsWith(dir)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) file = join(dir, 'index.html'); // single-page app routes
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

export async function start(config = loadConfig()) {
  // One node, one client, one contract: run on the contract this client's Fatline is tied to (appOf).
  const fatline = await useFatlineApp(config);
  const db = openDb(config.dataDir);
  const networks = Object.fromEntries(Object.entries(config.networks).map(([name, n]) => [name, new Network(name, n)]));
  const voices = new VoicesIndex(db, config.voices);
  voices.start(Number(process.env.VOICES_POLL_MS ?? 5_000));
  const launchpad = new Launchpad(db, config.launchpad ?? {});
  launchpad.start(Number(process.env.LAUNCHPAD_POLL_MS ?? 5_000));
  let keeper = null;
  const vault = process.env.KEEPER_VAULT ?? config.keeper?.vault;
  if (process.env.KEEPER_PRIVATE_KEY && vault && launchpad.client) {
    const chain = { 8453: base, 84532: baseSepolia, 31337: foundry }[launchpad.chainId];
    keeper = new Keeper({ client: launchpad.client, chain, privateKey: process.env.KEEPER_PRIVATE_KEY, vault, root: ROOT, dataDir: config.dataDir, launchpad });
    keeper.start(Number(process.env.KEEPER_INTERVAL_MS ?? 3_600_000), Number(process.env.CHECKIN_INTERVAL_MS ?? 300_000));
  }
  const nodes = new NodeMonitor(db, config.masterNodes ?? [], { intervalMs: Number(process.env.NODE_POLL_MS ?? 15_000), log: console.log });
  nodes.start();
  // The archive's tables live in the same SQLite file; the network adapters write them from their own processes.
  const archive = new Archive(db);
  const ownKey = loadAppKey(config.dataDir);
  if (ownKey?.fid) archive.track(ownKey.fid); // the owner decided: only this client's own FID, for now
  const server = buildServer({ config, networks, voices, launchpad, keeper, nodes, archive });
  server.listen(config.port, () => {
    console.log(`Fatline indexer on http://localhost:${config.port}`);
    console.log(`  config:   ${config.path}`);
    console.log(`  fatline:  #${fatline.fid}${fatline.app ? `, runs on ${fatline.app} (appOf)` : ', no contract tied yet'}`);
    console.log(`  networks: ${Object.keys(networks).join(', ')} (default: ${config.defaultNetwork})`);
    console.log(`  apps:     ${launchpad.enabled ? `factory ${launchpad.factory} on chain ${launchpad.chainId}` : 'off (no factory address in config)'}`);
    console.log(`  keeper:   ${keeper ? keeper.account.address : 'off'}`);
    console.log(`  nodes:    ${nodes.nodes.length ? nodes.nodes.map((n) => n.id).join(', ') : 'none watched (add masterNodes to the config)'}`);
    console.log(`  voices:   ${voices.enabled ? `${voices.address} on chain ${voices.chainId}` : 'off (no contract address in config)'}`);
  });
  return { server, voices, launchpad, keeper, db, nodes, archive };
}

if (import.meta.url === `file://${process.argv[1]}`) start();
