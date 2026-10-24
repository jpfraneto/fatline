// Fatline: a quiet window onto autonomous software. Is this thing alive, and what is it doing?
//
// Every number here comes from this server's API, which watches the node and the chain itself.
// The browser never talks to the node. If the data is old or the server can't be reached, the page
// says Unknown, never the last good state.
import { experience, feedForm, presence } from './apps.js';
import { $, api, el, short, state, store, usdc } from './lib.js';
import { castComposer } from './post.js';

const POLL_MS = 15_000;
const LOST_AFTER_MS = 45_000; // no fresh answer from this server for this long: everything is Unknown

const S = {
  en: {
    online: 'Online', degraded: 'Degraded', offline: 'Offline', unknown: 'Unknown',
    masterNode: 'Master node', node: 'Node', nodes: 'Nodes', activity: 'Activity', treasury: 'Treasury', technical: 'Technical details',
    identity: 'Coin', app: 'App', chain: 'Chain', contract: 'Contract', vault: 'Vault', creator: 'Creator', owner: 'Owner', born: 'Born',
    farcaster: 'Farcaster', fidVerified: (fid, name, net) => `${name ? `@${name}, ` : ''}FID ${fid}: the creator's wallet is this FID's custody address on ${net}.`,
    noFid: "The creator's wallet is not the custody address of any FID we can see.",
    lastHeartbeat: 'Last heartbeat', never: 'never', uptime: 'Uptime', onlineSince: (t) => `online since ${t}`,
    observed: (on, all) => `${on} of ${all} checks online in the last 24 h (while this server was watching)`,
    version: 'Version', commit: 'Commit', notReported: 'not reported by the node', sync: 'Sync', behind: (n) => { const s = Number(n); const v = s < 120 ? `${Math.round(s)} s` : s < 7200 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`; return `${v} behind`; },
    cursor: 'Block heights', latency: 'Answer time', network: 'Network', host: 'Host', publicApi: 'Public API', notPublic: 'not public',
    heldBy: (how) => (how === 'operator' ? "Tied to this coin's app by this server's operator." : "Named in the app's own onchain metadata."),
    unmonitored: (url) => `The app names ${url} as its node, but this server does not watch it, so its health is unknown.`,
    noNode: 'No node is tied to this coin.',
    noNodeHow: "A node is tied to an app in one of two ways: the app names the node's URL when it is born (stored onchain), or the operator of this server lists the app under masterNodes in its config.",
    indexer: "This server's indexer", indexerStates: { ok: 'Keeping up', behind: 'Behind', stale: 'Stale', unknown: 'Unknown', off: 'Off' },
    indexed: (c, h) => `Indexed to block ${c ?? '?'} of ${h ?? '?'}`, lastPass: 'Last successful pass',
    updated: (s) => `Updated ${s}`, lost: "Can't reach this server. Retrying…", paused: 'Paused while the tab is hidden.',
    balance: 'In the vault', pending: 'Trading fees not yet harvested', runway: 'Runway', paidThrough: (d) => `Server paid through ${d}`,
    runwayText: (d, rate) => `The vault covers the server until ${d} at its current tier (${rate} USDC per 30 days, the rate the contract lets the server take).`,
    noRunway: 'Not enough to pay another period at the current tier.',
    received: 'Deposited by people', fees: 'Trading fees harvested', spent: 'Paid for compute', withdrawn: 'Withdrawn by the owner',
    howFunded: "How it is funded: anyone can deposit USDC. If the app has a coin, its trading fees collect in Clanker's fee locker, in USDC, and move into the vault only when someone calls harvest(). Market cap and volume are not money in the vault.",
    treasuryError: (e) => `Couldn't read the vault right now (${e}). Totals below come from indexed history.`,
    recent: 'Recent money movements', nothingYet: 'Nothing yet.', more: 'Older', none: 'No events yet.',
    local: 'Local fork of Base: fake money, and no block explorer has these contracts.',
    notFound: 'Nothing here', trade: (s) => `Trade ${s}`, people: 'People here', experience: 'The app',
    nodeLink: 'Status', apps: (n) => (n ? `${n} app${n > 1 ? 's' : ''} on it` : 'No apps tied to it yet'), detail: 'Details',
    keeperHere: 'This server is the keeper of this app: it pays itself from the vault.',
    archive: 'Archive', archiveOf: (fid) => `FID ${fid}`, publishTo: 'Publish to',
    publishHelp: 'This only chooses where your next post goes. Your archive shows every network.',
    notTracked: 'This server keeps an archive only for its own FID for now.',
    emptyArchive: 'Nothing archived yet. The network adapters fill this as they read the nodes.',
    adapters: 'Read from', adapterLine: (label, net, t) => `${label} (${net}) · last event ${t}`, noAdapters: 'No network adapter has written anything yet.',
    status: { merged: 'held', pruned: 'pruned', revoked: 'revoked', displaced: 'replaced or removed', failed: 'failed', null: 'not seen' },
    notSeenNote: '“Not seen” means this server has no record from that network. It may have existed before the server started watching.',
    kinds: { cast: 'Casts', reaction: 'Reactions', link: 'Follows', profile: 'Profile', verification: 'Verifications' },
    reactionTo: 'reaction', linkTo: 'follow', field: 'profile field', verified: 'verified address',
    ev: {
      AppCreated: () => 'App born: vault created by the factory',
      Deposited: (e) => `Funded: +${usdc(e.amount)} USDC from ${short(e.account)}${e.detail ? ` (“${e.detail}”)` : ''}`,
      StartingDeposit: (e) => `Starting deposit at birth: +${usdc(e.amount)} USDC from ${short(e.account)}`,
      DirectTransfer: (e) => `USDC sent straight to the vault: +${usdc(e.amount)} from ${short(e.account)}`,
      Harvested: (e) => `Trading fees moved into the vault: +${usdc(e.amount)} USDC`,
      ComputePaid: (e) => `Infrastructure payment: the server took ${usdc(e.amount)} USDC for compute`,
      Withdrawn: (e) => `Owner withdrew ${usdc(e.amount)} USDC to ${short(e.account)}`,
      TierChanged: (e) => `Compute tier changed to #${e.detail}`,
      KeeperChanged: (e) => `New keeper: ${short(e.account)}`,
      online: () => 'Node seen online', recovered: () => 'Node recovered', synced: () => 'Node synchronized with the network',
      degraded: (e) => `Node degraded: ${e.detail}`, offline: (e) => `Node offline: ${e.detail}`, unknown: (e) => `Lost track of the node: ${e.detail}`,
      version: (e) => `Node version ${e.detail}`,
    },
  },
  es: {
    online: 'En línea', degraded: 'Degradado', offline: 'Caído', unknown: 'Desconocido',
    masterNode: 'Nodo maestro', node: 'Nodo', nodes: 'Nodos', activity: 'Actividad', treasury: 'Tesorería', technical: 'Detalles técnicos',
    identity: 'Moneda', app: 'App', chain: 'Cadena', contract: 'Contrato', vault: 'Bóveda', creator: 'Creador', owner: 'Dueño', born: 'Nació',
    farcaster: 'Farcaster', fidVerified: (fid, name, net) => `${name ? `@${name}, ` : ''}FID ${fid}: la billetera del creador es la dirección custodia de este FID en ${net}.`,
    noFid: 'La billetera del creador no es la dirección custodia de ningún FID que veamos.',
    lastHeartbeat: 'Último latido', never: 'nunca', uptime: 'Tiempo en línea', onlineSince: (t) => `en línea desde ${t}`,
    observed: (on, all) => `${on} de ${all} revisiones en línea en las últimas 24 h (mientras este servidor miraba)`,
    version: 'Versión', commit: 'Commit', notReported: 'el nodo no lo informa', sync: 'Sincronía', behind: (n) => { const s = Number(n); const v = s < 120 ? `${Math.round(s)} s` : s < 7200 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`; return `${v} atrás`; },
    cursor: 'Alturas de bloque', latency: 'Tiempo de respuesta', network: 'Red', host: 'Servidor', publicApi: 'API pública', notPublic: 'no pública',
    heldBy: (how) => (how === 'operator' ? 'Vinculado a la app de esta moneda por el operador de este servidor.' : 'Nombrado en los metadatos onchain de la propia app.'),
    unmonitored: (url) => `La app nombra ${url} como su nodo, pero este servidor no lo vigila, así que su salud es desconocida.`,
    noNode: 'Ningún nodo está vinculado a esta moneda.',
    noNodeHow: 'Un nodo se vincula a una app de dos formas: la app nombra la URL del nodo al nacer (queda onchain), o el operador de este servidor la pone en masterNodes en su configuración.',
    indexer: 'El indexador de este servidor', indexerStates: { ok: 'Al día', behind: 'Atrasado', stale: 'Detenido', unknown: 'Desconocido', off: 'Apagado' },
    indexed: (c, h) => `Indexado hasta el bloque ${c ?? '?'} de ${h ?? '?'}`, lastPass: 'Última pasada exitosa',
    updated: (s) => `Actualizado ${s}`, lost: 'No se puede llegar a este servidor. Reintentando…', paused: 'En pausa mientras la pestaña está oculta.',
    balance: 'En la bóveda', pending: 'Comisiones aún sin cosechar', runway: 'Autonomía', paidThrough: (d) => `Servidor pagado hasta ${d}`,
    runwayText: (d, rate) => `La bóveda cubre el servidor hasta ${d} en su nivel actual (${rate} USDC cada 30 días, lo que el contrato deja tomar al servidor).`,
    noRunway: 'No alcanza para pagar otro periodo en el nivel actual.',
    received: 'Depositado por personas', fees: 'Comisiones cosechadas', spent: 'Pagado en cómputo', withdrawn: 'Retirado por el dueño',
    howFunded: 'Cómo se financia: cualquiera puede depositar USDC. Si la app tiene moneda, sus comisiones se juntan en el fee locker de Clanker, en USDC, y pasan a la bóveda solo cuando alguien llama harvest(). La capitalización y el volumen no son dinero en la bóveda.',
    treasuryError: (e) => `No se pudo leer la bóveda ahora (${e}). Los totales vienen del historial indexado.`,
    recent: 'Movimientos recientes', nothingYet: 'Nada todavía.', more: 'Anteriores', none: 'Sin eventos todavía.',
    local: 'Fork local de Base: dinero falso, y ningún explorador tiene estos contratos.',
    notFound: 'Aquí no hay nada', trade: (s) => `Comerciar ${s}`, people: 'Gente aquí', experience: 'La app',
    nodeLink: 'Estado', apps: (n) => (n ? `${n} app${n > 1 ? 's' : ''} en él` : 'Ninguna app vinculada todavía'), detail: 'Detalles',
    keeperHere: 'Este servidor es el keeper de esta app: se paga a sí mismo desde la bóveda.',
    archive: 'Archivo', archiveOf: (fid) => `FID ${fid}`, publishTo: 'Publicar en',
    publishHelp: 'Esto solo elige adónde va tu próxima publicación. Tu archivo muestra todas las redes.',
    notTracked: 'Por ahora este servidor guarda archivo solo para su propio FID.',
    emptyArchive: 'Nada archivado todavía. Los adaptadores de red lo llenan a medida que leen los nodos.',
    adapters: 'Leído de', adapterLine: (label, net, t) => `${label} (${net}) · último evento ${t}`, noAdapters: 'Ningún adaptador de red ha escrito nada todavía.',
    status: { merged: 'presente', pruned: 'podado', revoked: 'revocado', displaced: 'reemplazado o borrado', failed: 'falló', null: 'no visto' },
    notSeenNote: '“No visto” significa que este servidor no tiene registro de esa red. Pudo existir antes de que empezara a mirar.',
    kinds: { cast: 'Casts', reaction: 'Reacciones', link: 'Seguidos', profile: 'Perfil', verification: 'Verificaciones' },
    reactionTo: 'reacción', linkTo: 'seguir', field: 'campo de perfil', verified: 'dirección verificada',
    ev: {
      AppCreated: () => 'Nació la app: la fábrica creó la bóveda',
      Deposited: (e) => `Financiada: +${usdc(e.amount)} USDC de ${short(e.account)}${e.detail ? ` (“${e.detail}”)` : ''}`,
      StartingDeposit: (e) => `Depósito inicial al nacer: +${usdc(e.amount)} USDC de ${short(e.account)}`,
      DirectTransfer: (e) => `USDC enviado directo a la bóveda: +${usdc(e.amount)} de ${short(e.account)}`,
      Harvested: (e) => `Comisiones a la bóveda: +${usdc(e.amount)} USDC`,
      ComputePaid: (e) => `Pago de infraestructura: el servidor tomó ${usdc(e.amount)} USDC para cómputo`,
      Withdrawn: (e) => `El dueño retiró ${usdc(e.amount)} USDC a ${short(e.account)}`,
      TierChanged: (e) => `Cambió el nivel de cómputo a #${e.detail}`,
      KeeperChanged: (e) => `Nuevo keeper: ${short(e.account)}`,
      online: () => 'Nodo visto en línea', recovered: () => 'El nodo se recuperó', synced: () => 'El nodo se sincronizó con la red',
      degraded: (e) => `Nodo degradado: ${e.detail}`, offline: (e) => `Nodo caído: ${e.detail}`, unknown: (e) => `Se perdió el rastro del nodo: ${e.detail}`,
      version: (e) => `Versión del nodo ${e.detail}`,
    },
  },
};
const f = (key, ...args) => { const v = (S[state.lang] ?? S.en)[key]; return typeof v === 'function' ? v(...args) : v; };

// ------------------------------------------------------------------ time, with the server's clock

/** Times from the server are compared to the server's own "now", so a wrong clock here can't make data look fresh. */
function since(snapshot, t) {
  if (!t) return null;
  return Math.max(0, snapshot.serverAt - t + (Date.now() - snapshot.fetchedAt));
}
function agoText(ms) {
  if (ms === null) return f('never');
  const s = Math.round(ms / 1000);
  const rtf = new Intl.RelativeTimeFormat(state.lang, { numeric: 'auto' });
  if (s < 60) return rtf.format(-s, 'second');
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour');
  return rtf.format(-Math.floor(s / 86400), 'day');
}
/** A relative time that the page clock keeps current without re-rendering. */
function ago(snap, t) {
  return el('span', { 'data-at': t ?? '' }, agoText(since(snap, t)));
}
function tickTimes(snap) {
  document.querySelectorAll('#main .live-region [data-at]').forEach((n) => { n.textContent = agoText(since(snap, Number(n.dataset.at) || null)); });
  const fresh = document.querySelector('#main .live-region .fresh');
  if (fresh) fresh.replaceWith(freshness(snap));
}
const when = (ms) => new Date(ms).toLocaleString(state.lang, { dateStyle: 'medium', timeStyle: 'short' });
const day = (ms) => new Date(ms).toLocaleDateString(state.lang, { dateStyle: 'medium' });

// ------------------------------------------------------------------ polling

let stopCurrent = null;
/** Stops the live updates of the page being left. main.js calls this on every route change. */
export function leaveLive() { stopCurrent?.(); stopCurrent = null; }

/**
 * Fetches `load` now and every POLL_MS while the tab is visible, and calls `render(snapshot)`.
 * snapshot = { data, fetchedAt, serverAt, lost, error }. When the server can't be reached for
 * LOST_AFTER_MS, `lost` is true and the page must stop claiming anything is healthy.
 */
function live(load, render) {
  leaveLive();
  let timer = null;
  let lastOk = null;
  let stopped = false;
  const tick = async () => {
    clearTimeout(timer);
    try {
      const data = await load();
      lastOk = { data, fetchedAt: Date.now(), serverAt: data.at ?? Date.now(), lost: false, error: null };
      if (!stopped) render(lastOk);
    } catch (err) {
      if (stopped) return;
      if (!lastOk) throw err; // nothing to show yet: let the page show the error
      render({ ...lastOk, error: err.message, lost: Date.now() - lastOk.fetchedAt > LOST_AFTER_MS });
    }
    if (!stopped && !document.hidden) timer = setTimeout(() => tick().catch(() => {}), POLL_MS);
  };
  const onVisible = () => { if (!document.hidden) tick().catch(() => {}); else clearTimeout(timer); };
  document.addEventListener('visibilitychange', onVisible);
  // A small clock so "updated 12 s ago" keeps counting, and staleness shows even with no new fetch.
  let wasLost = false;
  const clock = setInterval(() => {
    if (!lastOk || stopped) return;
    const lost = Date.now() - lastOk.fetchedAt > LOST_AFTER_MS;
    const snap = { ...lastOk, lost };
    if (lost !== wasLost) render(snap); else tickTimes(snap);
    wasLost = lost;
  }, 5_000);
  stopCurrent = () => { stopped = true; clearTimeout(timer); clearInterval(clock); document.removeEventListener('visibilitychange', onVisible); };
  return tick();
}

/** What a status looks like right now, given how fresh our copy is. */
function effective(status, snap) {
  if (!status) return { state: 'unknown', reason: '' };
  if (snap.lost) return { ...status, state: 'unknown', reason: f('lost'), sync: null };
  const age = since(snap, status.checkedAt);
  if (age === null || age > (status.staleAfterMs ?? 45_000)) return { ...status, state: 'unknown', reason: status.reason, sync: null };
  return status;
}

// ------------------------------------------------------------------ the signal line

/**
 * A fine line with a pulse travelling along it. Healthy: a steady pulse. Degraded: slow and warm.
 * Offline: the line is broken and still. Unknown: dotted and still. Reduced motion: no movement at all.
 */
function signal(stateName, beatKey) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 600 48');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', `signal ${stateName}`);
  svg.setAttribute('aria-hidden', 'true');
  const d = stateName === 'offline' ? 'M0 24 H270 M330 24 H600' : 'M0 24 H210 C240 24 250 10 270 10 C290 10 290 38 310 38 C330 38 340 24 370 24 H600';
  for (const cls of ['base', 'pulse']) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', cls);
    p.setAttribute('pathLength', '600');
    p.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(p);
  }
  const end = document.createElementNS(ns, 'circle');
  end.setAttribute('cx', '594'); end.setAttribute('cy', '24'); end.setAttribute('r', '4');
  end.setAttribute('class', 'end');
  svg.append(end);
  // The pulse's phase follows the wall clock, so a re-render continues the motion instead of restarting it.
  const period = { online: 3200, degraded: 9000 }[stateName];
  if (period) svg.style.setProperty('--phase', `-${(Date.now() % period) / 1000}s`);
  svg.dataset.beat = beatKey ?? '';
  return svg;
}

const stateWord = (s) => f(s) ?? s;

// ------------------------------------------------------------------ the node, large

function statusView(raw, snap, { how, compact = false } = {}) {
  const s = effective(raw, snap);
  const rows = [
    [f('lastHeartbeat'), raw?.lastHeartbeatAt ? el('span', {}, ago(snap, raw.lastHeartbeatAt), ` · ${when(raw.lastHeartbeatAt)}`) : f('never')],
    [f('uptime'), s.state === 'online' && raw.onlineSince ? f('onlineSince', when(raw.onlineSince)) : null,
      raw?.observed24h ? f('observed', raw.observed24h.online, raw.observed24h.checks) : null],
    [f('sync'), s.sync ? `${s.sync}${s.blocksBehind !== null && s.blocksBehind !== undefined ? ` · ${f('behind', s.blocksBehind)}` : ''}` : '—'],
    [f('cursor'), raw?.shards?.length ? raw.shards.map((x) => `shard ${x.shard}: ${x.height?.toLocaleString() ?? '?'}`).join(' · ') : '—'],
    [f('version'), raw?.version ?? '—'],
    [f('commit'), f('notReported')],
  ];
  return el('section', { class: `node-status ${s.state}`, 'aria-live': 'polite' },
    el('div', { class: 'node-head' },
      el('span', { class: 'node-label' }, raw?.label ?? f('node')),
      raw?.network ? el('span', { class: 'node-net' }, NETWORK_LABEL(raw.network)) : null),
    el('p', { class: 'state-word' }, el('span', { class: 'lamp', 'aria-hidden': 'true' }), stateWord(s.state)),
    signal(s.state, raw?.lastHeartbeatAt),
    el('p', { class: 'reason' }, s.reason || ''),
    how ? el('p', { class: 'fine' }, f('heldBy', how)) : null,
    compact ? null : el('dl', { class: 'facts' }, ...rows.map(([k, ...v]) => el('div', {}, el('dt', {}, k), ...v.filter(Boolean).map((x) => el('dd', {}, x))))));
}

function indexerView(ix, snap) {
  if (!ix) return null;
  const stale = snap.lost ? 'unknown' : ix.state;
  return el('section', { class: `indexer ${stale}` },
    el('p', { class: 'row-line' }, el('span', { class: 'lamp small', 'aria-hidden': 'true' }), el('strong', {}, f('indexer')), ' · ', f('indexerStates')[stale] ?? stale),
    el('p', { class: 'fine' }, ix.state === 'off' ? ix.reason : [`${f('indexed', ix.cursor, ix.head)} · ${f('lastPass')} `, ago(snap, ix.lastSyncAt)]),
    ix.error ? el('p', { class: 'fine warn-text' }, ix.error) : null);
}

function freshness(snap) {
  if (snap.lost) return el('p', { class: 'fresh lost', role: 'status' }, f('lost'));
  return el('p', { class: 'fresh', role: 'status' }, document.hidden ? f('paused') : f('updated', agoText(Math.max(0, Date.now() - snap.fetchedAt))), snap.error ? ` · ${snap.error}` : '');
}

// ------------------------------------------------------------------ activity

function eventLine(e, snap) {
  const label = (f('ev')[e.kind] ?? (() => e.kind))(e);
  return el('li', { class: `ev ${e.source} ${e.kind}` },
    el('time', { datetime: new Date(e.at).toISOString(), title: when(e.at), 'data-at': e.at }, agoText(since(snap, e.at))),
    el('span', {}, label),
    e.link ? el('a', { href: e.link, target: '_blank', rel: 'noopener', class: 'tx' }, 'tx ↗') : null);
}

function activityView(items, snap, onMore) {
  const list = el('ol', { class: 'events' }, ...items.map((e) => eventLine(e, snap)));
  return el('div', {}, items.length ? list : el('p', { class: 'fine' }, f('none')),
    onMore ? el('button', { type: 'button', class: 'quiet more-ev', onclick: onMore }, f('more')) : null);
}

// ------------------------------------------------------------------ treasury

function treasuryView(t, items, snap) {
  const rate = t.tiers?.[t.tier]?.usdPer30Days;
  const runway = t.alive !== null && t.aliveUntil && t.aliveUntil > snap.serverAt
    ? f('runwayText', day(t.aliveUntil), rate?.toFixed(2) ?? '?') : t.balance !== null ? f('noRunway') : null;
  const money = items.filter((e) => e.source === 'vault' && e.amount !== null);
  return el('section', { class: 'treasury' },
    t.error ? el('p', { class: 'fine warn-text' }, f('treasuryError', t.error)) : null,
    el('dl', { class: 'facts money' },
      el('div', {}, el('dt', {}, f('balance')), el('dd', { class: 'big-num' }, t.balance === null ? '—' : `${usdc(t.balance)} USDC`)),
      el('div', {}, el('dt', {}, f('pending')), el('dd', {}, t.pendingFees === null ? '—' : `${usdc(t.pendingFees)} USDC`)),
      el('div', {}, el('dt', {}, f('runway')), el('dd', {}, runway ?? '—'), t.paidThrough ? el('dd', { class: 'fine' }, f('paidThrough', day(t.paidThrough))) : null)),
    el('dl', { class: 'facts totals' },
      ...[['received', 'Deposited'], ['fees', 'Harvested'], ['spent', 'ComputePaid'], ['withdrawn', 'Withdrawn']]
        .map(([k, kind]) => el('div', {}, el('dt', {}, f(k)), el('dd', {}, `${usdc(t.totals[kind])} USDC`)))),
    el('p', { class: 'fine' }, f('howFunded')),
    el('h3', {}, f('recent')),
    money.length ? el('ol', { class: 'events' }, ...money.slice(0, 8).map((e) => eventLine(e, snap))) : el('p', { class: 'fine' }, f('nothingYet')));
}

// ------------------------------------------------------------------ pages

const linkOr = (text, href) => (href ? el('a', { href, target: '_blank', rel: 'noopener', class: 'mono' }, text) : el('span', { class: 'mono' }, text));

export async function coinPage(chainId, address) {
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'fine' }, '…'));
  main.classList.add('fatline-page');
  let older = [];
  let moreCursor = null;
  let stable = null; // the parts people type into or watch: rendered once, never replaced by a refresh
  const region = el('div', { class: 'live-region' });
  const path = `/api/coin/${chainId}/${address}`;
  const load = async () => {
    const [coin, act] = await Promise.all([api(path), api(`${path}/activity`)]);
    if (!older.length) moreCursor = act.more;
    return { ...coin, activity: act.items };
  };
  const refresh = () => live(load, render);

  const stableParts = (c) => {
    const symbol = c.coin?.symbol ? `$${c.coin.symbol}` : null;
    return el('div', { class: 'stable' }, ...[
      state.config.launchpad && c.treasury ? feedForm({ vault: c.app.vault }, refresh) : null,
      c.treasury.people ? el('h2', { class: 'section' }, f('people')) : null,
      c.treasury.people ? presence({ vault: c.app.vault, state: c.treasury.people }, refresh) : null,
      c.app.experience ? el('h2', { class: 'section' }, f('experience')) : null,
      c.app.experience ? experience({ name: c.app.name, experience: c.app.experience }) : null,
      c.app.trade && c.coin ? el('p', {}, el('a', { class: 'button', href: c.app.trade, target: '_blank', rel: 'noopener' }, f('trade', symbol ?? ''))) : null,
      el('details', { class: 'technical' }, el('summary', {}, f('technical')),
        el('dl', { class: 'facts' },
          el('div', {}, el('dt', {}, f('chain')), el('dd', {}, `${c.chain.name} · chain id ${c.chain.id}`)),
          el('div', {}, el('dt', {}, f('creator')), el('dd', {}, linkOr(c.app.creator, c.app.links.creator))),
          el('div', {}, el('dt', {}, f('owner')), el('dd', {}, linkOr(c.app.owner, c.app.links.owner))),
          el('div', {}, el('dt', {}, 'Keeper'), el('dd', { class: 'mono' }, c.treasury.keeper ?? '—'), c.server.keeperForThisApp ? el('dd', { class: 'fine' }, f('keeperHere')) : null),
          ...c.nodes.filter((n) => n.status).map((n) => el('div', {}, el('dt', {}, `${f('publicApi')} · ${n.status.label}`), el('dd', { class: 'mono' }, n.status.url ?? f('notPublic')),
            n.status.host ? el('dd', { class: 'fine' }, `${n.status.host}${n.status.operator ? ` · ${n.status.operator}` : ''}`) : null)),
          el('div', {}, el('dt', {}, 'Block'), el('dd', { class: 'mono' }, String(c.app.block))))),
    ].filter(Boolean));
  };

  const render = (snap) => {
    const c = snap.data;
    const items = [...c.activity, ...older.filter((o) => !c.activity.some((a) => a.at === o.at && a.kind === o.kind && a.tx === o.tx))];
    const name = c.coin?.name ?? c.app.name ?? short(c.app.vault);
    const symbol = c.coin?.symbol ? `$${c.coin.symbol}` : null;
    const loadMore = moreCursor ? async () => {
      const next = await api(`${path}/activity`, { before: moreCursor });
      older = older.concat(next.items);
      moreCursor = next.more;
      render(snap);
    } : null;
    const nodesSection = c.nodes.length
      ? c.nodes.map((n) => (n.status ? statusView(n.status, snap, { how: n.how }) : el('section', { class: 'node-status unknown' },
        el('p', { class: 'state-word' }, el('span', { class: 'lamp' }), stateWord('unknown')), signal('unknown'), el('p', { class: 'reason' }, f('unmonitored', n.url)))))
      : [el('section', { class: 'node-status none' }, el('p', { class: 'state-word dim' }, f('noNode')), signal('unknown'), el('p', { class: 'fine' }, f('noNodeHow')))];

    region.replaceChildren(...[
      c.chain.local ? el('p', { class: 'banner' }, f('local')) : null,
      el('header', { class: 'coin-head' },
        el('p', { class: 'eyebrow' }, c.coin ? f('identity') : f('app'), ' · ', c.chain.name, ` (${c.chain.id})`),
        el('h1', { class: 'coin-name' }, name, symbol ? el('span', { class: 'sym' }, ` ${symbol}`) : null),
        c.app.description ? el('p', { class: 'lede' }, c.app.description) : null,
        el('dl', { class: 'facts ident' },
          c.coin ? el('div', {}, el('dt', {}, f('contract')), el('dd', {}, linkOr(c.coin.address, c.coin.link))) : null,
          el('div', {}, el('dt', {}, f('vault')), el('dd', {}, linkOr(c.app.vault, c.app.links.vault))),
          el('div', {}, el('dt', {}, f('farcaster')), el('dd', {}, c.identity?.pending ? '…' : c.identity ? f('fidVerified', c.identity.fid, c.identity.username, c.identity.networkLabel) : f('noFid'))),
          el('div', {}, el('dt', {}, f('born')), el('dd', {}, when(c.app.createdAt))))),
      el('h2', { class: 'section' }, c.nodes.length > 1 ? f('nodes') : f('masterNode')),
      ...nodesSection,
      indexerView(c.indexer, snap),
      freshness(snap),
      el('h2', { class: 'section' }, f('activity')),
      activityView(items, snap, loadMore),
      el('h2', { class: 'section' }, f('treasury')),
      treasuryView(c.treasury, items, snap),
    ].filter(Boolean));
    if (!stable) {
      stable = stableParts(c);
      main.replaceChildren(region, stable);
    }
  };
  try {
    await live(load, render);
  } catch (err) {
    main.replaceChildren(el('section', { class: 'node-status none' }, el('p', { class: 'state-word dim' }, f('notFound')), el('p', { class: 'reason' }, err.message)));
  }
}

export async function nodePage(id) {
  const main = $('#main');
  main.classList.add('fatline-page');
  main.replaceChildren(el('p', { class: 'fine' }, '…'));
  const render = (snap) => {
    const n = snap.data;
    main.replaceChildren(el('div', { class: 'live-region' },
      el('p', { class: 'eyebrow' }, f('masterNode')),
      statusView(n, snap),
      indexerView(snap.data.indexer, snap),
      freshness(snap),
      n.apps.length ? el('ul', { class: 'node-apps' }, ...n.apps.map((a) => el('li', {}, el('a', { href: `#/coin/${state.config.launchpad?.chainId}/${a.coin ?? a.vault}` }, a.name ?? short(a.vault)))))
        : el('p', { class: 'fine' }, f('apps', 0)),
      el('h2', { class: 'section' }, f('activity')),
      activityView(n.events, snap, null),
      el('details', { class: 'technical' }, el('summary', {}, f('technical')),
        el('dl', { class: 'facts' },
          el('div', {}, el('dt', {}, f('publicApi')), el('dd', { class: 'mono' }, n.url ?? f('notPublic'))),
          el('div', {}, el('dt', {}, f('host')), el('dd', {}, [n.host, n.operator].filter(Boolean).join(' · ') || '—')),
          el('div', {}, el('dt', {}, f('latency')), el('dd', {}, n.latencyMs !== null ? `${n.latencyMs} ms` : '—'))))));
  };
  const load = async () => {
    const [node, overview] = await Promise.all([api(`/api/nodes/${encodeURIComponent(id)}`), api('/api/nodes')]);
    return { ...node, indexer: overview.indexer };
  };
  try { await live(load, render); } catch (err) {
    main.replaceChildren(el('section', { class: 'node-status none' }, el('p', { class: 'state-word dim' }, f('notFound')), el('p', { class: 'reason' }, err.message)));
  }
}

/** The compact strip on the main page: every node this server watches. Polls on its own, quietly. */
export function nodeStrip() {
  const box = el('section', { class: 'strip', 'aria-label': f('nodes') });
  let timer = null;
  let lastOk = null;
  const draw = (snap) => {
    if (!snap.data.nodes.length) { box.hidden = true; return; }
    box.replaceChildren(...snap.data.nodes.map((raw) => {
      const s = effective(raw, snap);
      return el('a', { class: `strip-node ${s.state}`, href: `#/node/${encodeURIComponent(raw.id)}` },
        el('span', { class: 'lamp small', 'aria-hidden': 'true' }),
        el('span', { class: 'strip-main' }, el('strong', {}, raw.label), ' · ', NETWORK_LABEL(raw.network), ' · ', stateWord(s.state)),
        el('span', { class: 'strip-sub' }, f('lastHeartbeat'), ' ', ago(snap, raw.lastHeartbeatAt), ' · ', f('apps', raw.apps.length)),
        signal(s.state, raw.lastHeartbeatAt));
    }));
  };
  const tick = async () => {
    if (!box.isConnected && lastOk) return; // left the page
    try {
      const data = await api('/api/nodes');
      lastOk = { data, fetchedAt: Date.now(), serverAt: data.at, lost: false };
      draw(lastOk);
    } catch {
      if (lastOk) draw({ ...lastOk, lost: Date.now() - lastOk.fetchedAt > LOST_AFTER_MS });
      else box.hidden = true;
    }
    timer = setTimeout(tick, document.hidden ? POLL_MS * 4 : POLL_MS);
  };
  tick();
  const prev = stopCurrent;
  stopCurrent = () => { prev?.(); clearTimeout(timer); };
  return box;
}

// ------------------------------------------------------------------ the archive

const NETWORK_LABEL = (name) => state.config.networks.find((n) => n.name === name)?.label ?? name;

function archiveText(item) {
  const b = item.body ?? {};
  if (typeof b.text === 'string') return b.text;
  if (item.type?.includes('REACTION')) return `${f('reactionTo')} ${b.type ?? ''} ${b.targetCastId ? `→ ${short(b.targetCastId.hash ?? '')}` : b.targetUrl ?? ''}`.trim();
  if (item.type?.includes('LINK')) return `${f('linkTo')} → FID ${b.targetFid ?? '?'}`;
  if (item.type?.includes('USER_DATA')) return `${f('field')}: ${b.value ?? ''}`;
  if (item.type?.includes('VERIFICATION')) return `${f('verified')}: ${b.address ?? ''}`;
  return item.type ?? '';
}

/**
 * One personal archive: every network adapter's record for this FID, as one list.
 * Each item says what each network holds. The selector above chooses where to publish; it never changes whose archive this is.
 */
export async function archivePage(fid) {
  const main = $('#main');
  main.classList.add('fatline-page');
  main.replaceChildren(el('p', { class: 'fine' }, '…'));
  const networks = state.config.networks.map((n) => n.name);
  let publishTo = networks.includes(store.get('publishTo', null)) ? store.get('publishTo', null) : state.network;
  let kind = 'cast';
  let older = []; // pages loaded with "Older"; the live refresh only re-reads the newest page
  let moreAt = null;
  const region = el('div', { class: 'live-region' });
  let stable = null;
  const path = fid ? `/api/archive/${fid}` : '/api/archive';
  const load = async () => {
    const page = await api(path, { types: kind });
    if (!older.length) moreAt = page.more;
    return page;
  };
  const refresh = () => live(load, render);

  const selector = () => el('div', { class: 'publish' },
    el('span', { class: 'fine' }, f('publishTo')),
    el('div', { class: 'switch', role: 'radiogroup', 'aria-label': f('publishTo') },
      ...networks.map((n) => el('button', {
        type: 'button', role: 'radio', 'aria-checked': String(n === publishTo),
        onclick: (e) => {
          publishTo = n; store.set('publishTo', n);
          e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget)));
        },
      }, NETWORK_LABEL(n)))),
    el('p', { class: 'fine' }, f('publishHelp')));

  const kinds = () => el('div', { class: 'switch kinds', role: 'radiogroup', 'aria-label': 'type' },
    ...Object.entries(f('kinds')).map(([k, label]) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(k === kind),
      onclick: (e) => {
        kind = k; older = []; moreAt = null;
        e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget)));
        refresh();
      },
    }, label)));

  const render = (snap) => {
    const a = snap.data;
    const items = [...a.items, ...older.filter((o) => !a.items.some((i) => i.key === o.key))];
    const loadOlder = moreAt ? async () => {
      const next = await api(path, { types: kind, before: moreAt });
      older = older.concat(next.items);
      moreAt = next.more;
      render(snap);
    } : null;
    if (!stable) {
      stable = el('div', { class: 'stable' },
        el('p', { class: 'eyebrow' }, f('archive'), ' · ', f('archiveOf', a.fid)),
        a.own ? selector() : null,
        a.own ? castComposer({ network: () => publishTo, onDone: () => setTimeout(refresh, 2000) }) : null,
        kinds());
      main.replaceChildren(stable, region);
    }
    const sources = a.sources.length
      ? el('ul', { class: 'sources' }, ...a.sources.map((src) => el('li', {}, f('adapterLine', src.label, NETWORK_LABEL(src.network), agoText(since(snap, src.lastEventAt))))))
      : el('p', { class: 'fine' }, f('noAdapters'));
    region.replaceChildren(...[
      a.tracked ? null : el('p', { class: 'banner' }, f('notTracked')),
      el('div', { class: 'fine' }, f('adapters'), sources),
      freshness(snap),
      items.length
        ? el('ol', { class: 'archive' }, ...items.map((item) => el('li', { class: 'arch-item' },
          el('p', { class: 'arch-text' }, archiveText(item)),
          el('p', { class: 'arch-meta' },
            el('time', { datetime: new Date(item.at).toISOString(), title: when(item.at), 'data-at': item.at }, agoText(since(snap, item.at))),
            ...networks.map((n) => el('span', { class: `net-chip ${item.networks[n] ?? 'unseen'}` }, `${NETWORK_LABEL(n)}: ${f('status')[item.networks[n] ?? 'null']}`))))))
        : el('p', { class: 'fine' }, f('emptyArchive')),
      loadOlder ? el('button', { type: 'button', class: 'quiet more-ev', onclick: loadOlder }, f('more')) : null,
      items.some((i) => networks.some((n) => !i.networks[n])) ? el('p', { class: 'fine' }, f('notSeenNote')) : null,
    ].filter(Boolean));
  };
  try { await live(load, render); } catch (err) {
    main.replaceChildren(el('section', { class: 'node-status none' }, el('p', { class: 'state-word dim' }, f('notFound')), el('p', { class: 'reason' }, err.message)));
  }
}
