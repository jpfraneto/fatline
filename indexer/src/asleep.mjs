// A place whose own server is off. The names router (infra/names-router.mjs) sends <surname>.fatline.ink to the
// master's Caddy when that server does not answer; Caddy gets a certificate for the name (on demand, only for names
// `knows` says yes to) and asks this client with X-Fatline-Standin. One plain page: the place asleep, whose it is,
// its last cast, its coin's vault, and how it wakes. It works in a browser and as the place's mini app.
// Everything here is read from this server: its hatchery's copy of the contract (/world) and its own node.
// Its /api/health says 503, so the Fatline tab and the landing still show the place as quiet.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { embedTags, labelOf } from './miniapp.mjs';

const SITE = 'https://fatline.ink';
const ART = join(ROOT, 'apps/site/fatliners-art.json');
const SDK = join(ROOT, 'apps/site/vendor/miniapp-sdk-0.3.0.mjs');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const titled = (s) => s.charAt(0) + s.slice(1).toLowerCase();

export function ago(ms, now = Date.now()) {
  const m = Math.round((now - ms) / 60000);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} hours ago`;
  return `${Math.round(m / 1440)} days ago`;
}

/** The place's picture: its being, else its stone's egg, else the egg; served by fatline.ink's own copy. */
function artFor(tk, art) {
  const u = art.beings?.[tk.fid]?.image ?? art.eggs?.[tk.stone]?.image ?? art.egg?.image ?? '';
  const id = String(u).match(/arweave\.net\/([\w-]{43})/)?.[1];
  return id ? `${SITE}/api/art/${id}` : `${SITE}/img/fatline-app.png`;
}

/**
 * worlds: () => [{ url }] of hatcheries (this server's first). api, network: this server's node. coins: makeCoins.
 * ownLabel: () => this server's own name, which it never stands in for.
 */
export function makeAsleep({ worlds, api = null, network = null, coins = null, ownLabel = async () => null, ttlMs = 60_000, fetchImpl = fetch, readArt = () => JSON.parse(readFileSync(ART, 'utf8')) }) {
  let cache = { at: 0, world: null };
  async function world() {
    if (cache.world && Date.now() - cache.at < ttlMs) return cache.world;
    for (const h of await worlds().catch(() => [])) {
      const r = await fetchImpl(`${String(h.url).replace(/\/$/, '')}/world`, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
      if (r?.ok) { cache = { at: Date.now(), world: await r.json() }; return cache.world; }
    }
    if (cache.world) return cache.world;
    throw Object.assign(new Error('No hatchery answered.'), { status: 503 });
  }

  /** The token behind a host, if this server may stand in for it. */
  async function tokenOf(host) {
    const label = labelOf(host);
    if (!label || label === 'fatline' || label === 'www' || label === (await ownLabel().catch(() => null))) return null;
    const w = await world();
    return (w.tokens ?? []).find((t) => t.surname && t.surname.toLowerCase() === label && (t.stage === 'egg' || t.stage === 'fatliner')) ?? null;
  }

  /** May this server stand in for this name (show its asleep page)? */
  async function knows(domain) {
    return Boolean(await tokenOf(String(domain ?? '').toLowerCase()).catch(() => null));
  }

  /**
   * Caddy's on-demand question: may this server hold a certificate for this name? The places it stands in for,
   * and its own names too: Caddy asks for every name under *.fatline.ink, fatline.fatline.ink and www included.
   */
  async function mayCertify(domain) {
    const label = labelOf(String(domain ?? ''));
    if (label && (label === 'fatline' || label === 'www' || label === (await ownLabel().catch(() => null)))) return true;
    return knows(domain);
  }

  async function page(host) {
    const tk = await tokenOf(host);
    if (!tk) return null;
    const fid = tk.linkedFid ?? tk.fid;
    const name = tk.fid === (await world()).genesisFid ? `Aster ${titled(tk.surname)}` : titled(tk.surname);
    const [user, feed, coin] = await Promise.all([
      api && network ? api.user(network, fid).catch(() => null) : null,
      api && network ? api.feed(network.name, { fids: [fid], limit: 10 }).catch(() => null) : null,
      coins ? coins(String(tk.fid)).then((c) => c.coins?.[0] ?? null).catch(() => null) : null,
    ]);
    const last = (feed?.items ?? []).find((c) => c.kind === 'cast' && Number(c.fid) === Number(fid));
    const nodeName = `fatline.ink's ${network?.name === 'hypersnap' ? 'Hypersnap' : 'Snapchain'} node`;
    const check = tk.warmth?.lastCheck;
    const image = artFor(tk, (() => { try { return readArt(); } catch { return {}; } })());
    const lines = [
      `<img class="art" src="${esc(image)}" alt="">`,
      `<p class="host">${esc(host)}</p>`,
      `<h1>${esc(name)}</h1>`,
      `<p class="who">${user?.username ? `@${esc(user.username)}` : `FID ${tk.fid}`} · ${tk.stage === 'egg' ? 'an egg' : 'a Fatliner'}${tk.coin ? ` · $${esc(tk.surname)}` : ''}</p>`,
      `<p class="state"><b>Asleep.</b> Its server is not answering, so fatline.ink is showing this page for it.${check?.at ? ` The network last checked its node ${ago(check.at)}: ${check.ok ? 'it answered' : 'no answer'}.` : ''}</p>`,
      last ? `<blockquote>${esc(String(last.text ?? '').slice(0, 280)) || '(a picture)'}<cite>${ago(last.timestamp)} · read from ${esc(nodeName)}</cite></blockquote>` : '',
      coin?.vault
        ? `<p class="coin">Its vault holds <b>${(coin.usdc ?? 0).toFixed(2)} USDC</b> from $${esc(tk.surname)}'s fees. It pays whoever runs this place's server.</p>`
        : `<p class="coin">No coin yet. With one, its trading fees pay for its server, in USDC.</p>`,
      `<h2>Wake it</h2>`,
      `<p>Its holder turns the server back on and runs <code>fatline update</code>. On a new server:</p>`,
      `<pre><code>curl -fsSL https://fatline.ink/join.sh | sudo bash</code></pre>`,
      `<p class="links"><a href="${SITE}/">Every place</a> · <a href="${SITE}/#launch">Run your own</a></p>`,
    ];
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(name)} · asleep</title>
    <meta name="description" content="${esc(name)}'s Fatline is asleep: its server is not answering." />
    ${embedTags(host).replace(/https:\/\/[^"]*?\/miniapp\/embed\.jpg/g, esc(image)).replace(/https:\/\/[^"]*?\/miniapp\/splash\.png/g, `${SITE}/img/fatline-app.png`)}
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; background: #0b0d1a; color: #eae6dc; font: 17px/1.5 Georgia, 'Times New Roman', serif; }
      main { max-width: 34rem; margin: 0 auto; padding: 24px 16px 48px; }
      .art { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 26px; background: #151829; filter: grayscale(.55) brightness(.8); }
      .host { margin: 18px 0 0; color: #8f8a7e; font: 13px/1.4 ui-monospace, Menlo, monospace; }
      h1 { margin: 4px 0; font-size: 2.1rem; font-weight: 400; }
      h2 { margin: 28px 0 6px; font-size: 1.2rem; font-weight: 400; color: #d8b96a; }
      .who, .links { color: #b9b3a5; }
      .state b { color: #d8b96a; font-weight: 400; }
      blockquote { margin: 18px 0; padding: 12px 16px; border-left: 2px solid #d8b96a55; background: #151829; border-radius: 9px; }
      cite { display: block; margin-top: 6px; color: #8f8a7e; font: 12px/1.4 ui-monospace, Menlo, monospace; }
      pre { overflow-x: auto; padding: 12px; background: #151829; border-radius: 9px; font-size: 13px; }
      code { font-family: ui-monospace, Menlo, monospace; }
      a { color: #d8b96a; }
    </style>
  </head>
  <body>
    <main>
      ${lines.filter(Boolean).join('\n      ')}
    </main>
    <script type="module">
      import { sdk } from '/asleep/sdk.mjs';
      const inside = await sdk.isInMiniApp().catch(() => false);
      if (inside) {
        sdk.actions.ready().catch(() => {});
        for (const a of document.querySelectorAll('a')) a.addEventListener('click', (e) => { e.preventDefault(); sdk.actions.openUrl(a.href).catch(() => {}); });
      }
    </script>
  </body>
</html>
`;
  }

  /** The place's mini app manifest: its own name, Fatline's pictures (no account association: not ours to sign). */
  function manifest(host, tk) {
    const url = `https://${host}`;
    const name = titled(tk.surname);
    return {
      miniapp: {
        version: '1', name, homeUrl: `${url}/`, iconUrl: `${SITE}/img/fatline-app.png`, splashImageUrl: `${SITE}/img/fatline-app.png`,
        splashBackgroundColor: '#0b0d1a', subtitle: 'A Fatline: node, client, coin',
        description: `${name}'s Fatline. Its own Farcaster node, the client that reads it, and the coin that keeps it alive.`,
        primaryCategory: 'social', tags: ['fatline', 'snapchain', 'hypersnap', 'node'], canonicalDomain: host, requiredChains: ['eip155:8453'],
      },
    };
  }

  /** Answers a stand-in request (the node's http.ServerResponse). Nothing here writes or signs. */
  async function serve(host, pathname, res) {
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    const json = (status, body) => send(status, 'application/json', JSON.stringify(body));
    host = String(host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (pathname.startsWith('/api/')) return json(503, { ok: false, asleep: true, error: 'This place is asleep: its server is not answering.' });
    if (pathname === '/asleep/sdk.mjs') return send(200, 'text/javascript', readFileSync(SDK));
    const tk = await tokenOf(host).catch(() => null);
    if (!tk) return send(404, 'text/plain; charset=utf-8', 'Not a Fatline place.\n');
    if (pathname === '/.well-known/farcaster.json') return json(200, manifest(host, tk));
    if (pathname !== '/' && pathname !== '/index.html') { res.writeHead(302, { location: '/' }); return res.end(); }
    return send(200, 'text/html; charset=utf-8', await page(host));
  }

  return { knows, mayCertify, page, serve };
}
