const ago = (s) => { s = Number(s); return s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} hours` : `${Math.round(s / 86400)} days`; }; // Snapchain's blockDelay is in seconds
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { Api } from './api.mjs';
import { loadConfig } from './config.mjs';
import { openDb } from './db.mjs';
import { Network } from './hub.mjs';
import { VoicesIndex } from './voices.mjs';
import { useFatlineApp } from './fatline-app.mjs';
import { LifeForce } from './lifeforce.mjs';
import { WalletLogin } from './login.mjs';
import { Launchpad } from './launchpad.mjs';
import { Keeper } from './keeper.mjs';
import { Writer, loadAppKey } from './writer.mjs';
import { attesterList, hatcheryConfig } from './hatchery-run.mjs';
import { NodeMonitor } from './nodes.mjs';
import { Registry, referencesFrom } from './registry.mjs';
import { makeCockpit } from './cockpit.mjs';
import { embedTags, makePlace, manifest } from './miniapp.mjs';
import { makeCompanion } from './companion.mjs';
import { makeHome } from './home.mjs';
import { makeAround } from './around.mjs';
import { makeArt, makeBirth, makeCoins } from './birth.mjs';
import { makeAsleep } from './asleep.mjs';
import { makeVisitor } from './visitor.mjs';
import { verifyLogin } from './fatline-login.mjs';
import { planFatlineLaunch } from './launch-fatline.mjs';
import { Coins } from './coin.mjs';
import { Archive, TYPES as ARCHIVE_TYPES } from './archive.mjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { ROOT } from './config.mjs';
import { base, baseSepolia, foundry } from 'viem/chains';
import { createPublicClient, http, parseAbi } from 'viem';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

export function buildServer({ config, networks, voices, launchpad, keeper = null, nodes = null, coins = null, archive = null, lifeforce = null, registryDb = null, registry = null }) {
  const api = new Api({ config, networks, voices, launchpad });
  coins ??= nodes ? new Coins({ launchpad, nodes, networks, config, keeper }) : null;
  const needCoins = () => { if (!coins) throw Object.assign(new Error('Node monitoring is not set up on this server.'), { status: 503 }); return coins; };

  // Posting signs with this client's app key, so only its owner may ask for it:
  // requests made on this machine directly, or (behind a proxy, on a server) with the write token.
  // On a server that knows its owner (FATLINE_OWNER_FID), signing in as that account gives the browser the token.
  const ownerFid = Number(process.env.FATLINE_OWNER_FID) || null;
  const tokenPath = join(config.dataDir, 'write.token');
  if (ownerFid && !process.env.FATLINE_WRITE_TOKEN && !existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(32).toString('hex'), { mode: 0o600 });
  const writeToken = process.env.FATLINE_WRITE_TOKEN ?? (existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : null);
  const sameSite = (req) => {
    // Other websites open in the same browser must not be able to post through this client.
    const origin = req.headers.origin;
    if (origin) { // "null" too: sandboxed frames, like the apps shown inside this one
      try { if (new URL(origin).host !== req.headers.host) return false; } catch { return false; }
    }
    return !(req.method === 'POST' && !/^application\/json/.test(req.headers['content-type'] ?? ''));
  };
  const mayWrite = (req) => {
    if (!sameSite(req)) return false;
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for']
      && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host ?? ''); // and not a rebound DNS name
    if (local) return true;
    const given = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    return Boolean(writeToken && given.length === writeToken.length && timingSafeEqual(Buffer.from(given), Buffer.from(writeToken)));
  };
  // key: this client's own key file, or a visitor's ({ fid, signer }: the key is in their browser, visitor.mjs).
  const writer = async (network, node, visitorKey = null) => {
    const key = visitorKey ?? loadAppKey(config.dataDir);
    if (!key) throw Object.assign(new Error('This client has no app key yet. Run fatline identity on the machine that runs it, or log in with the Cast button.'), { status: 409 });
    const name = network && networks[network] ? network : (key.network ?? config.defaultNetwork);
    const net = networks[name];
    if (!node) return { w: new Writer({ network: net, key }) }; // automatic: the first node in sync
    // A node that is still catching up can't check a new message (it may not know the account's key or storage
    // yet), so it would refuse or never confirm it. Until it is in sync, the message goes through the first node
    // that is, and the reply says so. Reads stay on the node the person chose.
    const chosen = net.nodes.find((n) => n.url === String(node).replace(/\/$/, ''));
    if (chosen) await net.checkNode(chosen);
    if (chosen && !chosen.status?.ok && chosen.status?.blockDelay > 0) {
      // Your node is catching up: the cast goes to it first. It is confirmed on a node in sync (yours can't show it
      // until it catches up), and if your node refuses it (it may not know your key yet), it goes through that one.
      let other = await net.refresh();
      let otherNet = net;
      if (!other || other.url === chosen.url) {
        const { Network } = await import('./hub.mjs');
        const relays = { farcaster: [['http://46.225.208.199:3381', 'Fatline master node'], ['https://crackle.farcaster.xyz:3381', 'crackle.farcaster.xyz']],
          hypersnap: [['http://46.225.208.199:4381', 'Fatline Hypersnap node'], ['https://haatz.quilibrium.com', 'haatz.quilibrium.com']] }[name] ?? [];
        otherNet = new Network(name, { nodes: relays.map(([url, label]) => ({ url, label })) });
        other = relays.length ? await otherNet.refresh() : null;
      }
      if (other && other.url !== chosen.url) {
        const via = otherNet.pinned(other.url);
        return { w: new Writer({ network: net.pinned(chosen.url), key, confirmVia: via, fallback: via }), chosen, other,
          behind: `${chosen.label ?? chosen.url} is ${ago(chosen.status.blockDelay)} behind` };
      }
    }
    return { w: new Writer({ network: net.pinned(node), key }) };
  };
  const write = (fn) => async (q, m, body, req) => {
    if (!mayWrite(req)) throw Object.assign(new Error('Posting is only allowed from this machine, or with its write token.'), { status: 401 });
    const { w, via, chosen, other, behind } = await writer(body?.network ?? q.get('network'), body?.node ?? q.get('node'));
    const out = await fn(w, body ?? {});
    if (via) return { ...out, via };
    if (!chosen || !other) return out;
    // Say exactly what happened while the node catches up.
    if (out.refused) return { ...out, via: { node: other.url, own: other.own, label: other.label, because: `${behind} and refused it (${out.refused}), so it went through ${other.label ?? other.url}` } };
    return { ...out, syncing: { node: chosen.url, confirmedOn: other.url, because: `${behind}: it took your cast and passed it on; ${other.label ?? other.url} confirms it until yours catches up` } };
  };

  // Sign in from the Cast button (the Farcaster app, or the wallet that owns the account): a key for this client.
  // Anyone may start one on a server with an owner; the key is kept only if the owner's account approves it.
  const login = new WalletLogin({ config, networks, root: ROOT, owner: ownerFid });
  const signIn = (fn, { fresh = false } = {}) => async (q, m, body, req) => {
    if (!(mayWrite(req) || (ownerFid && sameSite(req)))) throw Object.assign(new Error('Signing in works only on this machine.'), { status: 401 });
    if (!fresh && (q.get('session') ?? body?.session) !== login.session) throw Object.assign(new Error('This sign-in was replaced. Start again.'), { status: 409 });
    const out = await fn(body);
    return out.step === 'done' && writeToken ? { ...out, token: writeToken } : out; // only the browser that signed in
  };
  const cockpit = makeCockpit({ config, networks, api });
  const hc = hatcheryConfig(config);
  const place = makePlace({ cockpit, contract: hc.contract, rpc: hc.rpc, ownerFid });
  const sel = (q) => ({ name: q.get('network'), node: q.get('node') });
  // fatline.ink's companion (whoever opens it inside Farcaster): only where it is turned on, the genesis server.
  const companion = makeCompanion({ config, networks, api, contract: hc.contract, rpc: hc.rpc,
    payTo: process.env.FATLINE_PAY_TO ?? config.deployments?.Fatliners?.royaltyTo ?? null, hatcheries: attesterList(hc) });
  const companionOn = process.env.FATLINE_COMPANION === '1';
  const art = makeArt({ dataDir: config.dataDir });
  const chainClient = createPublicClient({ chain: hc.chainId === 8453 ? base : hc.chainId === 84532 ? baseSepolia : foundry, transport: http(hc.rpc) });
  const birth = makeBirth({ config, client: chainClient, contract: hc.contract, hatcheries: attesterList(hc), plan: planFatlineLaunch });
  const coinsLive = makeCoins({ client: chainClient, contract: hc.contract });
  // Anyone signs in and casts here, with a key that stays in their own browser (visitor.mjs).
  const visitorNet = networks[config.defaultNetwork] ?? Object.values(networks)[0];
  const visitor = makeVisitor({ config, writer, nodeFor: () => visitorNet.node(), resolveUser: (q) => api.resolve(visitorNet, q) });
  // Another place's name, while its own server is off: the master's Caddy asks here (asleep.mjs). Never this server's own.
  const asleep = makeAsleep({ worlds: attesterList(hc), api, network: networks[config.defaultNetwork] ?? Object.values(networks)[0] ?? null,
    coins: coinsLive, ownLabel: async () => (await place(null)).surname?.toLowerCase() ?? null });
  // Whoever opens this client: what they have (egg, Fatliner, nothing), and their home feed from this server's node.
  const homeNet = networks[config.defaultNetwork] ?? Object.values(networks)[0];
  const home = homeNet ? makeHome({ api, network: homeNet }) : null;
  const around = makeAround({ api });
  // The registry (registry.mjs): every node and client that joined Fatline with a cast under fatline.ink/nodes, plus
  // Fatline's own places, each measured from here once an hour. Read-only, for anyone, any origin.
  registry ??= registryDb ? new Registry({
    db: registryDb, networks, references: referencesFrom(config), ownerFid,
    places: placesFrom(attesterList(hc)), extraNodes: (config.masterNodes ?? []).filter((n) => n.public !== false),
    users: async (fid) => { const u = await api.resolve(homeNet?.name ?? config.defaultNetwork, String(fid)); return { username: u?.username ?? null, pfp: u?.pfp ?? null }; },
    vaults: (addresses) => vaultFacts(chainClient, addresses),
    measuredBy: process.env.FATLINE_HOST ?? 'this server', log: console.log,
  }) : null;
  const needRegistry = () => { if (!registry) throw Object.assign(new Error('The registry is not running on this server.'), { status: 503 }); return registry; };
  const routes = [
    ...(companionOn ? companion.routes : []),
    ['GET', /^\/api\/registry$/, (q) => needRegistry().list(q)],
    ['GET', /^\/api\/registry\/check$/, (q, m, b, req) => needRegistry().check({ url: q.get('url'), fid: q.get('fid'), client: q.get('client'), ip: req.socket.remoteAddress })],
    ['POST', /^\/api\/registry\/refresh$/, () => needRegistry().refresh()],
    ['GET', /^\/api\/registry\/([a-z0-9-]{1,64})$/, (q, [, id]) => needRegistry().get(id)],
    // Every Fatline's address (<name>.fatline.ink) and FID, as the attesters' hatcheries list them: fatline.ink sends
    // people with an egg to their own client.
    ['GET', /^\/api\/names$/, async () => {
      for (const a of await attesterList(hc)().catch(() => [])) {
        const r = await fetch(`${a.url.replace(/\/$/, '')}/names`, { signal: AbortSignal.timeout(6_000) }).catch(() => null);
        if (r?.ok) return r.json();
      }
      throw Object.assign(new Error('No hatchery answered.'), { status: 503 });
    }],
    // Caddy's on-demand question before it takes a certificate for a name (infra/site-setup.sh): only known places.
    ['GET', /^\/api\/standin\/ask$/, async (q) => { if (await asleep.mayCertify(q.get('domain'))) return { ok: true }; throw Object.assign(new Error('Not a Fatline place.'), { status: 404 }); }],
    ['GET', /^\/api\/viewer\/(\d{1,12})$/, (q, [, fid]) => companion.viewer(fid)],
    // The birth: hatch the egg, then launch its coin, from the holder's own wallet (indexer/src/birth.mjs).
    ['GET', /^\/api\/birth\/(\d{1,12})$/, (q, [, fid]) => birth(fid)],
    ['GET', /^\/api\/coins$/, (q) => coinsLive(q.get('fids'))],
    // Log in with Fatline (fatline-login.mjs): any app, any origin, asks this node who signed. No keys involved.
    ['POST', /^\/api\/auth\/verify$/, (q, m, b) => verifyLogin({ message: b?.message, signature: b?.signature, domain: b?.domain, nonce: b?.nonce, network: (Object.hasOwn(networks, String(b?.network)) && networks[b.network]) || homeNet, client: chainClient })],
    // Around you: everything that happened around you, newest first (around.mjs). Endless.
    ['GET', /^\/api\/around\/(\d{1,12})$/, (q, [, fid]) => around(sel(q), fid, { before: q.get('before'), limit: q.get('limit') })],
    ['GET', /^\/api\/home\/(\d{1,12})$/, (q, [, fid]) => { if (!home) throw Object.assign(new Error('No node here.'), { status: 503 }); return home(fid, { before: q.get('before'), limit: q.get('limit') }); }],
    // The cockpit: you, your nodes, your egg or Fatliner, and its hatching, in one answer (the client's home).
    ['GET', /^\/api\/cockpit$/, () => cockpit()],
    ['GET', /^\/api\/fatline$/, () => config.fatlineApp ?? null],
    // This place, for anyone (the mini app's visitors): whose it is, its egg or Fatliner, its node, its coin.
    ['GET', /^\/api\/place$/, (q, m, b, req) => place(req.headers['x-forwarded-host'] ?? req.headers.host)],
    ['GET', /^\/api\/lifeforce$/, () => lifeforce?.status() ?? null],
    ['GET', /^\/api\/login$/, signIn(() => login.status())],
    ['POST', /^\/api\/login$/, signIn(() => login.start(), { fresh: true })],
    ['POST', /^\/api\/login\/wallet$/, signIn((b) => login.walletStart(b), { fresh: true })],
    ['POST', /^\/api\/login\/wallet\/sign$/, signIn((b) => login.walletSign(b))],
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
    ['GET', /^\/api\/person$/, (q) => api.person(sel(q), q.get('q') ?? q.get('fid') ?? '')],
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
    // Visitors (visitor.mjs): sign in with the Farcaster app or the wallet that owns the account; then each action is
    // built here and signed in their browser. Nothing here holds their key.
    ['POST', /^\/api\/visitor\/qr$/, (q, m, b) => visitor.qrStart(b)],
    ['GET', /^\/api\/visitor\/qr$/, (q) => visitor.qrStatus({ token: q.get('token'), signer: q.get('signer') })],
    ['GET', /^\/api\/visitor\/who$/, (q) => visitor.who({ q: q.get('q') })],
    ['POST', /^\/api\/visitor\/wallet$/, (q, m, b) => visitor.walletStart(b)],
    ['POST', /^\/api\/visitor\/wallet\/sign$/, (q, m, b) => visitor.walletSign(b)],
    ['GET', /^\/api\/visitor\/wallet$/, (q) => visitor.walletStatus({ session: q.get('session') })],
    ['POST', /^\/api\/visitor\/act$/, (q, m, b) => visitor.act(b)],
    ['POST', /^\/api\/visitor\/sign$/, (q, m, b) => visitor.sign(b)],
    ['POST', /^\/api\/cast$/, write((w, b) => w.cast({ text: b.text, parent: b.parent }))],
    ['POST', /^\/api\/cast\/delete$/, write((w, b) => w.deleteCast({ hash: b.hash }))],
    ['POST', /^\/api\/react$/, write((w, b) => w.react({ kind: b.kind, fid: b.fid, hash: b.hash, remove: Boolean(b.remove) }))],
    ['POST', /^\/api\/follow$/, write((w, b) => w.follow({ fid: b.fid, remove: Boolean(b.remove) }))],
    ['POST', /^\/api\/resend$/, write((w, b) => w.resend(b.message))],
  ];

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'OPTIONS') return res.writeHead(204, { 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST' }).end();
    // Standing in for another place whose server is off (the master's Caddy sets this header): only its asleep page.
    if (req.headers['x-fatline-standin'] === '1') {
      return asleep.serve(req.headers['x-forwarded-host'] ?? req.headers.host, url.pathname, res)
        .catch((err) => json(res, err.status ?? 502, { error: err.message }));
    }

    // A Fatliner's picture, from this server's own copy (birth.mjs): kept forever, the id is the content.
    const artId = url.pathname.match(/^\/api\/art\/([\w-]{43})$/)?.[1];
    if (artId && req.method === 'GET') {
      try {
        const a = await art(artId);
        res.writeHead(200, { 'content-type': a.type, 'cache-control': 'public, max-age=31536000, immutable' });
        return createReadStream(a.file).pipe(res);
      } catch (err) { return json(res, err.status ?? 502, { error: err.message }); }
    }
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
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
    if (url.pathname === '/.well-known/farcaster.json') {
      const m = manifest(host, config.dataDir);
      return m ? json(res, 200, m) : json(res, 404, { error: 'Not a Fatline place' });
    }
    serveApp(config.appDir, url.pathname, res, embedTags(host));
  });
  httpServer.registry = registry;
  return httpServer;
}

const VAULT_ABI = parseAbi(['function balance() view returns (uint256)', 'function pendingFees() view returns (uint256)',
  'function ratePerSecond() view returns (uint256)', 'function paidThrough() view returns (uint256)', 'function aliveUntil() view returns (uint256)']);

/** Each Fatliner vault's money, read from Base (the registry's funding): USDC kept and waiting, its rent, until when it lasts. */
export async function vaultFacts(client, addresses) {
  const read = (address, functionName) => client.readContract({ address, abi: VAULT_ABI, functionName }).catch(() => null);
  const out = {};
  await Promise.all(addresses.slice(0, 100).map(async (a) => {
    const [kept, pending, rate, paid, alive] = await Promise.all(['balance', 'pendingFees', 'ratePerSecond', 'paidThrough', 'aliveUntil'].map((f) => read(a, f)));
    if (kept == null) return;
    out[a.toLowerCase()] = { usdc: Number(kept + (pending ?? 0n)) / 1e6, ratePerSecond: rate == null ? null : Number(rate), paidThrough: paid == null ? null : Number(paid), aliveUntil: alive == null ? null : Number(alive) };
  }));
  return out;
}

/**
 * Fatline's places, for the registry: every egg and Fatliner in the first hatchery's /world that answers, with the node
 * its egg names (GET /eggs/<fid>) and its client at <label>.fatline.ink (GET /names). Read once per registry round.
 */
export function placesFrom(attesters, { fetchImpl = fetch } = {}) {
  const get = (url) => fetchImpl(url, { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return async () => {
    for (const a of await attesters().catch(() => [])) {
      const at = String(a.url).replace(/\/$/, '');
      const world = await get(`${at}/world`);
      if (!world?.tokens) continue;
      const names = (await get(`${at}/names`))?.names ?? [];
      const live = world.tokens.filter((t) => t.surname && (t.stage === 'egg' || t.stage === 'fatliner'));
      return Promise.all(live.map(async (t) => {
        const egg = await get(`${at}/eggs/${t.fid}`);
        const label = names.find((n) => n.fid === t.fid)?.label ?? t.surname.toLowerCase();
        return {
          fid: t.linkedFid || t.fid, tokenFid: t.fid, surname: t.surname, stage: t.stage, node: egg?.node ?? null, network: egg?.network ?? null,
          client: `https://${label}.fatline.ink`, coin: t.coin ?? null, vault: t.vault ?? null, earned: t.earned ?? null, being: t.being ?? null,
        };
      }));
    }
    throw new Error('no hatchery answered with its world');
  };
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

function serveApp(dir, pathname, res, headTags = '') {
  if (!existsSync(dir)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('The indexer is running. The app is not built yet: run fatline up\nAPI: /api/networks, /api/feed\n');
  }
  let file = normalize(join(dir, decodeURIComponent(pathname)));
  if (!file.startsWith(dir)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) file = join(dir, 'index.html'); // single-page app routes
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  // The page itself carries this place's card for Farcaster (fc:miniapp), so a cast of its address opens it.
  if (headTags && file === join(dir, 'index.html')) return res.end(readFileSync(file, 'utf8').replace('</head>', `    ${headTags}  </head>`));
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
  const lifeforce = new LifeForce(networks[config.defaultNetwork]);
  lifeforce.start();
  const server = buildServer({ config, networks, voices, launchpad, keeper, nodes, archive, lifeforce, registryDb: db });
  if (process.env.FATLINE_REGISTRY !== '0') server.registry?.start();
  // FATLINE_BIND=127.0.0.1 on a server, where Caddy serves the client over https and nothing else should reach it.
  server.listen(config.port, process.env.FATLINE_BIND || undefined, async () => {
    const url = `http://localhost:${config.port}`;
    console.log(`\n  \x1b[1mYour Fatline client is running. Open ${url} in your browser.\x1b[0m`);
    console.log(`  \x1b[2m(It is one program: the client you open, and the indexer behind it that reads your node. Stop it with Ctrl+C.)\x1b[0m\n`);
    if (process.env.FATLINE_OPEN === '1') {
      const { spawn } = await import('node:child_process');
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      spawn(cmd, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    }
    console.log(`  config:   ${config.path}`);
    console.log(`  fatline:  #${fatline.fid}${fatline.app ? `, runs on ${fatline.app} (appOf)` : ', no contract tied yet'}`);
    console.log(`  networks: ${Object.keys(networks).join(', ')} (default: ${config.defaultNetwork})`);
    console.log(`  apps:     ${launchpad.enabled ? `factory ${launchpad.factory} on chain ${launchpad.chainId}` : 'off (no factory address in config)'}`);
    console.log(`  keeper:   ${keeper ? keeper.account.address : 'off'}`);
    console.log(`  nodes:    ${nodes.nodes.length ? nodes.nodes.map((n) => n.id).join(', ') : 'none watched (add masterNodes to the config)'}`);
    console.log(`  registry: ${server.registry && process.env.FATLINE_REGISTRY !== '0' ? `reads ${'https://fatline.ink/nodes'} hourly, /api/registry` : 'off'}`);
    console.log(`  voices:   ${voices.enabled ? `${voices.address} on chain ${voices.chainId}` : 'off (no contract address in config)'}`);
  });
  return { server, voices, launchpad, keeper, db, nodes, archive };
}

if (import.meta.url === `file://${process.argv[1]}`) start();
