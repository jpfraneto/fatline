// The registry, in the client: every node and client that joined Fatline, as this server measured them (#/nodes),
// one node's page (#/nodes/<id>), and bringing your own node in (#/join). The records are casts under
// https://fatline.ink/nodes; this server reads them from its own node and measures each node once an hour
// (indexer/src/registry.mjs). If this server does not run the registry yet, fatline.ink's answer is shown, and named.
import { $, el, state, timeAgo } from './lib.js';
import { castAs, loadMe } from './post.js';
import { openCast } from './castbutton.js';
import { openPlace } from './miniapp.js';

const FALLBACK = 'https://fatline.ink';
const RECORDS_URL = 'https://fatline.ink/nodes';
const NET = { snapchain: 'Snapchain', hypersnap: 'Hypersnap' };

/** GET from this server's registry, else fatline.ink's (so an older place still shows the network). */
async function registry(path = '', params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  for (const origin of [location.origin, FALLBACK]) {
    try {
      const res = await fetch(`${origin}/api/registry${path}${qs ? `?${qs}` : ''}`, { signal: AbortSignal.timeout(path === '/check' ? 45_000 : 12_000) });
      const out = await res.json().catch(() => ({}));
      if (res.ok) return { ...out, from: origin };
      if (res.status !== 404 && res.status !== 503) throw new Error(out.error ?? `HTTP ${res.status}`);
      if (path && path !== '/check' && origin === FALLBACK) throw new Error(out.error ?? 'Not listed.');
    } catch (err) {
      if (origin === FALLBACK || !/fetch|Failed|NetworkError|aborted|timed out/i.test(err.message)) throw err;
    }
  }
  throw new Error('No registry answered.');
}

const arweaveId = (u) => String(u ?? '').match(/arweave\.net\/([\w-]{43})/)?.[1];
const pic = (u) => (arweaveId(u) ? `${FALLBACK}/api/art/${arweaveId(u)}` : u); // fatline.ink's copy, as in the world
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const host = (url) => String(url ?? '').replace(/^https?:\/\//, '');

/** A health state in plain words, and its lamp. */
export function healthWords(h) {
  const s = h?.state ?? 'unknown';
  const behind = h?.behindBlocks;
  return {
    synced: { lamp: 'online', word: 'In sync', short: 'in sync' },
    behind: { lamp: 'degraded', word: 'Catching up', short: behind ? `catching up · ${behind.toLocaleString('en-US')} blocks behind` : 'catching up' },
    unknown: { lamp: 'unknown', word: 'Not measured yet', short: 'not measured yet' },
    stale: { lamp: 'unknown', word: 'No recent measurement', short: 'no recent measurement' },
    invalid: { lamp: 'offline', word: 'Not answering like a node', short: 'answers, not like a node' },
    unreachable: { lamp: 'offline', word: 'Not answering', short: 'not answering' },
  }[s] ?? { lamp: 'unknown', word: s, short: s };
}

const lamp = (h, small = true) => el('span', { class: `rg-lamp ${healthWords(h).lamp}${small ? ' small' : ''}`, 'aria-hidden': 'true' });

function who(op) {
  if (!op?.fid) return el('span', { class: 'muted' }, 'unknown');
  return el('a', { class: 'wk', href: `#/u/${op.fid}` },
    op.pfp ? el('img', { src: op.pfp, alt: '', loading: 'lazy' }) : el('span', { class: 'wk-dot' }),
    op.username ? `@${op.username}` : `FID ${op.fid}`);
}

function copyButton(text, label = 'Copy') {
  const b = el('button', { type: 'button', class: 'rg-copy' }, label);
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = Object.assign(document.createElement('textarea'), { value: text }); document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
    }
    b.textContent = 'Copied';
    setTimeout(() => { b.textContent = label; }, 1500);
  });
  return b;
}

const measuredLine = (r) => {
  const by = r.measuredBy && r.measuredBy !== 'this server' ? r.measuredBy : host(r.from);
  return r.roundAt ? `Measured by ${by}, ${timeAgo(r.roundAt)}` : `Measured by ${by}: the first round is still running`;
};

/** The two doors: bring a node you run, or start one. */
function doors() {
  return el('div', { class: 'rg-doors' },
    el('a', { class: 'rg-door', href: '#/join' }, el('b', {}, 'I already run a node'), el('span', {}, 'Put it on the map. One cast, no install.')),
    el('a', { class: 'rg-door', href: '#/fatline' }, el('b', {}, 'I want to start one'), el('span', {}, 'Rent a server or use yours. The manual is in the world.')));
}

/** A place you can open: a client, the nodes it reads, who runs it. */
function placeCard(c, nodes) {
  const read = c.nodes.map((n) => nodes.find((x) => x.id === n.id) ?? n);
  const art = pic(c.fatliner?.being) ?? c.operator?.pfp ?? null;
  const face = c.operator?.pfp;
  const open = () => openPlace(c.url);
  return el('article', { class: 'rg-place' },
    el('button', { type: 'button', class: 'rg-place-top', onclick: open, 'aria-label': `Open ${c.name ?? host(c.url)}` },
      art ? el('img', { class: 'rg-place-art', src: art, alt: '', loading: 'lazy', onerror: (e) => { if (face && e.target.src !== face) e.target.src = face; } }) : el('span', { class: 'rg-place-art blank', 'aria-hidden': 'true' }),
      el('span', { class: 'rg-place-name' }, c.name ?? host(c.url), el('small', {}, host(c.url)))),
    el('div', { class: 'rg-place-nodes' }, ...(read.length ? read.map((n) => el('a', { class: 'rg-mini', href: `#/nodes/${n.id}` },
      lamp(n.health ?? n), [NET[n.network ?? n.health?.network] ?? 'Its node', healthWords(n.health ?? n).short].join(' · '))) : [el('span', { class: 'muted small' }, 'reads a node it does not run')])),
    el('div', { class: 'rg-place-foot' }, who(c.operator), el('button', { type: 'button', class: 'rg-open', onclick: open }, 'Open →')));
}

/** Places whose node is in sync first, then catching up, then the rest; the order they joined within each. */
function placesFirstAlive(clients) {
  const rank = (c) => Math.min(9, ...c.nodes.map((n) => ({ synced: 0, behind: 1, unknown: 2, stale: 2 }[n.state] ?? 3)));
  return clients.map((c, i) => [c, i]).sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j).map(([c]) => c);
}

function nodeRow(n) {
  const w = healthWords(n.health);
  return el('a', { class: 'rg-node', href: `#/nodes/${n.id}` },
    lamp(n.health),
    el('span', { class: 'rg-node-main' },
      el('b', {}, n.name ?? host(n.url)),
      el('small', {}, [NET[n.network], w.short, n.health?.latencyMs ? `${(n.health.latencyMs / 1000).toFixed(1)} s` : null].filter(Boolean).join(' · '))),
    el('span', { class: 'rg-node-who' }, n.operator?.username ? `@${n.operator.username}` : n.operator?.fid ? `FID ${n.operator.fid}` : ''));
}

export async function nodesPage() {
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'ck-loading' }, '…'));
  let r;
  try { r = await registry(); } catch (err) { main.replaceChildren(el('section', { class: 'rg' }, el('h1', { class: 'rg-title' }, 'Nodes'), el('p', { class: 'warn' }, `The registry did not answer: ${err.message}`), doors())); return; }
  const synced = r.nodes.filter((n) => n.health.state === 'synced').length;
  main.replaceChildren(el('section', { class: 'rg' },
    el('header', { class: 'rg-head' },
      el('h1', { class: 'rg-title' }, 'Nodes'),
      el('p', { class: 'rg-ins' }, `${r.nodes.length} ${r.nodes.length === 1 ? 'node' : 'nodes'} · ${synced} in sync · ${r.clients.length} ${r.clients.length === 1 ? 'client' : 'clients'}`),
      el('p', { class: 'muted small' }, measuredLine(r))),
    doors(),
    el('h2', { class: 'rg-h' }, 'Places to read Farcaster'),
    r.clients.length ? el('div', { class: 'rg-places' }, ...placesFirstAlive(r.clients).map((c) => placeCard(c, r.nodes))) : el('p', { class: 'muted' }, 'No clients listed yet.'),
    el('h2', { class: 'rg-h' }, 'Every node, measured'),
    r.nodes.length ? el('div', { class: 'rg-nodes' }, ...r.nodes.map(nodeRow)) : el('p', { class: 'muted' }, 'No nodes listed yet. Be the first: bring yours.'),
    el('details', { class: 'rg-dev' },
      el('summary', {}, 'For developers'),
      el('p', {}, 'The same list, as JSON, with each node\'s last measurement:'),
      el('pre', {}, `curl '${FALLBACK}/api/registry?network=snapchain&healthy=true'`),
      el('p', {}, 'Or skip Fatline: the records are casts. Any node has them:'),
      el('pre', {}, `curl '<any node>/v1/castsByParent?url=${RECORDS_URL}'`),
      el('p', {}, el('a', { href: `${FALLBACK}/docs/#the-registry`, target: '_blank', rel: 'noopener' }, 'The schema and what each state means')))));
}

function facts(rows) {
  return el('dl', { class: 'pf-facts' }, ...rows.filter(Boolean).map(([k, v]) => el('div', { class: 'pf-fact' }, el('dt', {}, k), el('dd', {}, v))));
}

const PROOF = { egg: 'its keeper\'s egg (checked every hour by the hatcheries)', 'well-known': 'a file at its host (/.well-known/fatline)', dns: 'a DNS record (_fatline)' };

export async function nodeProfilePage(id) {
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'ck-loading' }, '…'));
  let n;
  try { n = await registry(`/${encodeURIComponent(id)}`); } catch (err) {
    main.replaceChildren(el('section', { class: 'rg' }, el('a', { class: 'back', href: '#/nodes' }, '← Nodes'), el('p', { class: 'warn' }, err.message))); return;
  }
  if (n.kind === 'client') { main.replaceChildren(el('section', { class: 'rg' }, el('a', { class: 'back', href: '#/nodes' }, '← Nodes'), placeCard({ ...n, nodes: n.nodes }, n.nodes))); return; }
  const h = n.health;
  const w = healthWords(h);
  const f = n.funding;
  const usd = (x) => `${Number(x).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC`;
  main.replaceChildren(el('section', { class: 'rg' },
    el('a', { class: 'back', href: '#/nodes' }, '← Nodes'),
    el('p', { class: 'rg-ins' }, `${NET[n.network] ?? ''} node`.trim()),
    el('h1', { class: 'rg-title left' }, n.name ?? host(n.url)),
    el('div', { class: `node-status ${w.lamp}` },
      el('div', { class: 'state-word' }, lamp(h, false), w.word),
      el('p', { class: 'reason' }, cap(h.reason ?? '')),
      el('p', { class: 'muted small' }, [h.checkedAt ? `Measured ${timeAgo(h.checkedAt)} by ${h.measuredBy && h.measuredBy !== 'this server' ? h.measuredBy : host(n.from)}` : 'Not measured yet', h.lastSyncedAt && h.state !== 'synced' ? `last in sync ${timeAgo(h.lastSyncedAt)}` : null].filter(Boolean).join(' · ')),
      n.history?.length ? el('div', { class: 'rg-ticks', 'aria-label': 'The last measurements, newest on the right' }, ...[...n.history].reverse().map((x) => el('i', { class: healthWords(x).lamp, title: `${new Date(x.at).toLocaleString()}: ${x.state}` }))) : null),
    facts([
      ['Address', el('span', {}, el('code', {}, n.url), ' ', copyButton(n.url))],
      ['Run by', who(n.operator)],
      ['Proven by', PROOF[n.proof?.method] ?? 'not proven'],
      h.version ? ['Version', h.version] : null,
      h.latencyMs != null ? ['Answered in', `${(h.latencyMs / 1000).toFixed(1)} s`] : null,
      h.behindBlocks != null ? ['Behind', `${h.behindBlocks.toLocaleString('en-US')} blocks`] : null,
      h.dataCheck != null ? ['Data check', h.dataCheck ? 'returned the casts it was asked for' : 'missing a cast it should hold'] : null,
    ]),
    n.clients?.length ? el('h2', { class: 'rg-h' }, 'Clients reading it') : null,
    n.clients?.length ? el('div', { class: 'rg-links' }, ...n.clients.map((c) => el('button', { type: 'button', class: 'pf-place', onclick: () => openPlace(c.url) }, 'Open ', el('b', {}, c.name ?? host(c.url)), ' →'))) : null,
    n.fatliner ? el('h2', { class: 'rg-h' }, 'Its Fatliner') : null,
    n.fatliner ? el('p', {}, el('a', { href: '#/fatline' }, n.fatliner.surname ? n.fatliner.surname.charAt(0) + n.fatliner.surname.slice(1).toLowerCase() : `#${n.fatliner.fid}`), ` · ${n.fatliner.stage === 'fatliner' ? 'hatched' : 'an egg, being kept warm'}`) : null,
    f ? el('h2', { class: 'rg-h' }, 'Keeping it alive') : null,
    f ? facts([
      f.earnedUsdc != null ? ['Its coin earned', usd(f.earnedUsdc)] : null,
      f.vaultUsdc != null ? ['In its vault', usd(f.vaultUsdc)] : null,
      f.costMonthUsd != null ? ['Costs', `$${f.costMonthUsd} a month (its operator says)`] : null,
      f.runwayDays != null ? ['Runway', `about ${f.runwayDays} days at that cost`] : null,
      f.supportUsdc ? ['Support it', el('span', {}, 'USDC on Base to ', el('code', {}, `${f.supportUsdc.slice(0, 6)}…${f.supportUsdc.slice(-4)}`), ' ', copyButton(f.supportUsdc))] : null,
      f.coin ? ['Coin', el('span', {}, el('code', {}, `${f.coin.slice(0, 6)}…${f.coin.slice(-4)}`), ' ', copyButton(f.coin))] : null,
    ]) : null,
    el('details', { class: 'rg-dev' },
      el('summary', {}, 'Use it'),
      el('p', {}, 'Its HTTP API, straight from your app. Nothing goes through Fatline:'),
      el('pre', {}, `curl '${n.url}/v1/info'\ncurl '${n.url}/v1/castsByFid?fid=3&pageSize=5&reverse=true'`),
      el('p', {}, 'This page as JSON: ', el('code', {}, `${FALLBACK}/api/registry/${n.id}`)),
      n.record ? el('p', {}, 'Listed by ', el('a', { href: `${FALLBACK}/c/${n.record.fid}/${n.record.hash}`, target: '_blank', rel: 'noopener' }, 'this cast'), '. Deleting it takes the node out.') : null)));
}

// ------------------------------------------------------------------ bringing a node in

export async function joinPage() {
  const main = $('#main');
  await loadMe();
  const me = state.me?.fid ? state.me : null;
  const input = el('input', { type: 'url', inputmode: 'url', placeholder: 'http://203.0.113.7:3381', autocomplete: 'off', spellcheck: 'false', value: new URLSearchParams(location.hash.split('?')[1] ?? '').get('node') ?? '' });
  const clientIn = el('input', { type: 'url', inputmode: 'url', placeholder: 'https://your-client.example (optional)', autocomplete: 'off', spellcheck: 'false' });
  const nameIn = el('input', { type: 'text', maxlength: 40, placeholder: 'A name for it (optional)' });
  const out1 = el('div', { class: 'rg-out' });
  const step2 = el('div', { class: 'rg-step-body' });
  const step3 = el('div', { class: 'rg-step-body' });
  let last = null; // the last check: { node, client, record, ... }

  const say = (box, ...kids) => box.replaceChildren(...kids.filter((k) => k != null && k !== false));
  const row = (ok, text) => el('p', { class: `rg-check ${ok === true ? 'ok' : ok === false ? 'no' : ''}` }, el('span', { 'aria-hidden': 'true' }, ok === true ? '✓' : ok === false ? '×' : '·'), text);

  async function check() {
    const url = input.value.trim();
    if (!url) return say(out1, el('p', { class: 'warn' }, 'Its address first.'));
    say(out1, el('p', { class: 'muted' }, 'Asking it: info, network, sync against our reference nodes, and two casts it should hold… (up to 30 s)'));
    try {
      last = await registry('/check', { url, fid: me?.fid, client: clientIn.value.trim() || undefined });
    } catch (err) { last = null; return say(out1, el('p', { class: 'warn' }, err.message)); }
    const h = last.node.health;
    const w = healthWords(h);
    say(out1,
      el('div', { class: `rg-result ${w.lamp}` },
        el('p', { class: 'rg-result-head' }, lamp(h), el('b', {}, `${NET[h.network] ?? 'Node'} · ${w.word}`)),
        el('p', { class: 'muted small' }, [cap(h.reason), h.version ? `version ${h.version}` : null, h.latencyMs ? `answered in ${(h.latencyMs / 1000).toFixed(1)} s` : null].filter(Boolean).join(' · ')),
        h.state === 'unreachable' ? el('p', { class: 'small' }, 'Fatline could not reach it from the internet. Its HTTP API port (3381 for Snapchain, often 4381 for Hypersnap here) must be open to anyone. If it is behind a domain, give that address.') : null,
        last.node.listed ? el('p', { class: 'small' }, 'Already listed: ', el('a', { href: `#/nodes/${last.node.id}` }, 'its page'), '.') : null));
    drawProof();
  }

  function drawProof() {
    if (!last) return say(step2, el('p', { class: 'muted' }, 'Check its address first.'));
    if (!me) {
      drawPublish();
      return say(step2,
        el('p', {}, 'Sign in, so the proof can name your Farcaster account.'),
        el('button', { type: 'button', class: 'rg-primary', onclick: () => openCast() }, 'Sign in with Farcaster'));
    }
    const proven = last.node.proof?.ok;
    if (proven && last.node.proof.method === 'egg') {
      say(step2, row(true, 'Already proven: your egg keeps a node on this same machine.'));
      return drawPublish();
    }
    say(step2,
      el('p', {}, 'Put one line where only you can: a file on that machine\'s web server, or a DNS record.'),
      el('div', { class: 'rg-proof' },
        el('p', { class: 'rg-k' }, 'A file'),
        el('p', { class: 'small' }, 'At ', el('code', {}, last.wellKnown), ' (port 80 or 443), holding:'),
        el('pre', {}, last.proofFile), copyButton(last.proofFile),
        el('p', { class: 'small muted' }, 'With nginx or Caddy serving /var/www/html:'),
        el('pre', {}, `sudo mkdir -p /var/www/html/.well-known && echo '${last.proofFile}' | sudo tee /var/www/html/.well-known/fatline`)),
      last.dns ? el('div', { class: 'rg-proof' },
        el('p', { class: 'rg-k' }, 'Or a DNS record'),
        el('p', { class: 'small' }, 'TXT ', el('code', {}, last.dns.name), ' = ', el('code', {}, last.dns.value))) : null,
      proven ? row(true, `Found: ${last.node.proof.where}`) : last.node.proof ? el('details', { class: 'small rg-tried' }, el('summary', {}, '× Not found yet: what Fatline tried'), ...(last.node.proof.tried ?? []).map((t) => el('p', { class: 'mono' }, t))) : null,
      el('button', { type: 'button', class: proven ? 'quiet' : 'rg-primary', onclick: () => check() }, proven ? 'Check again' : 'I put it there: check'),
      el('p', { class: 'small muted' }, 'Fatline reads it again about once a week. Your node itself is never touched.'));
    drawPublish();
  }

  function drawPublish() {
    if (!last || !me) return say(step3, el('p', { class: 'muted' }, 'After the proof.'));
    const client = clientIn.value.trim();
    const lines = [`fatline node`, `node: ${last.node.url}`];
    if (last.client?.url) lines.push(`client: ${last.client.url}`);
    if (nameIn.value.trim()) lines.push(`name: ${nameIn.value.trim().replace(/[\r\n]/g, ' ')}`);
    const text = lines.join('\n');
    const status = el('p', { class: 'status' });
    const go = el('button', { type: 'button', class: 'rg-primary', disabled: !last.node.proof?.ok }, 'Publish to Farcaster');
    go.addEventListener('click', async () => {
      go.disabled = true;
      status.textContent = 'Publishing…';
      try {
        const r = await castAs('/api/cast', { text, parent: { url: RECORDS_URL } });
        await fetch('/api/registry/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
        say(step3, row(true, r.state === 'confirmed' ? 'Published, and read back from the node.' : 'Sent. It is on its way.'),
          el('p', {}, 'It shows up in the list within a few minutes, measured. ', el('a', { href: `#/nodes/${last.node.id}` }, 'Its page →')),
          el('p', { class: 'small muted' }, 'To leave, delete that cast.'));
      } catch (err) { status.textContent = err.message; go.disabled = false; }
    });
    say(step3,
      el('p', {}, `One cast, as ${state.me?.username ? `@${state.me.username}` : `FID ${me.fid}`}, under ${host(RECORDS_URL)}. Anyone can read it from any node.`),
      el('pre', { class: 'rg-record' }, text),
      client && !last.client?.proof?.ok ? row(false, `The client ${host(client)} needs the same file at its own address before it is listed with your node.`) : null,
      go, status);
  }

  for (const i of [input, clientIn]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
  nameIn.addEventListener('input', () => drawPublish());
  window.addEventListener('fatline:me', () => { if (location.hash.startsWith('#/join')) joinPage(); }, { once: true });

  main.replaceChildren(el('section', { class: 'rg' },
    el('a', { class: 'back', href: '#/nodes' }, '← Nodes'),
    el('h1', { class: 'rg-title left' }, 'Bring your node'),
    el('p', { class: 'lede' }, 'You run Snapchain or Hypersnap. Put it where people and apps can find it, measured every hour. Nothing to install, nothing to pay; your node stays as it is.'),
    el('ol', { class: 'rg-steps' },
      el('li', {}, el('h2', { class: 'rg-h' }, 'Its address'),
        el('div', { class: 'row' }, input, el('button', { type: 'submit', onclick: check }, 'Check')), out1),
      el('li', {}, el('h2', { class: 'rg-h' }, 'Prove it is yours'), step2),
      el('li', {}, el('h2', { class: 'rg-h' }, 'Your client, if you have one'),
        el('p', { class: 'small muted' }, 'A Farcaster client or app that reads this node. Same proof, at its own address.'),
        clientIn, nameIn),
      el('li', {}, el('h2', { class: 'rg-h' }, 'Publish'), step3)),
    el('p', { class: 'small muted rg-after' }, 'Want a Fatliner and a coin that pays its rent? That needs Fatline on your server: ', el('code', {}, 'curl -fsSL https://fatline.ink/join.sh | bash -s -- --check'), ' looks first and changes nothing.')));
  clientIn.addEventListener('change', () => { if (last) check(); });
  drawProof();
  if (input.value) check();
}
