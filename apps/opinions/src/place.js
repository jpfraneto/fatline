// The place, for whoever opens it (in Farcaster, from a cast of its address): whose it is, the node it reads,
// its egg or Fatliner, its coin, and what its owner says. Everything from /api/place and this server's own node.
import { $, api, el, state } from './lib.js';
import { card } from './feed.js';
import { AR, BEINGS, EGGS } from './cockpit.js';
import { openUrl, viewCoin, viewProfile } from './miniapp.js';

const NET = { farcaster: 'Snapchain', hypersnap: 'Hypersnap' };
const big = (x) => (x >= 1e9 ? `${(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `${Math.round(x / 1e6)}M` : Number(x).toLocaleString('en-US'));
const lag = (s) => (s < 120 ? `${Math.round(s)} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

function art(p) {
  if (p.stage === 'fatliner' && BEINGS[p.fid]) return AR + BEINGS[p.fid];
  return AR + EGGS[p.stone ?? 'ivory'];
}

function stage(p) {
  if (p.stage === 'fatliner') return p.asleep ? 'Fatliner · asleep' : 'Fatliner';
  if (p.stage === 'egg') return `Egg · ${p.hatch?.warmDays ?? 0} of ${p.hatch?.needed ?? 3} warm days`;
  return 'No egg yet';
}

function nodeLine(n) {
  const how = n.synced ? 'in sync' : n.answering ? `${lag(n.blocksBehind)} behind` : 'asleep';
  return el('li', { class: `pl-node ${n.synced ? 'on' : n.answering ? 'sync' : 'off'}` },
    el('i', { class: `ck-dot ${n.synced ? 'on' : n.answering ? 'sync' : 'off'} ${n.network}` }),
    el('b', {}, NET[n.network] ?? n.network), ' ', el('small', {}, how, n.messages ? ` · ${big(n.messages)} messages` : ''));
}

function coin(p) {
  const name = p.surname ? `$${p.surname}` : 'Its coin';
  if (!p.coin?.address) return el('div', { class: 'pl-coin none' }, el('b', {}, name), el('small', {}, 'not launched yet'));
  const alive = p.coin.aliveUntil ? new Date(p.coin.aliveUntil * 1000).toLocaleDateString(state.lang, { month: 'short', day: 'numeric' }) : null;
  return el('button', { type: 'button', class: 'pl-coin', onclick: () => viewCoin(state.config?.launchpad?.chainId ?? 8453, p.coin.address) },
    el('b', {}, name),
    el('small', {}, p.coin.balanceUsdc != null ? `$${p.coin.balanceUsdc.toLocaleString('en-US', { maximumFractionDigits: 0 })} in its vault` : '', alive ? ` · node paid until ${alive}` : ''));
}

export async function placePage() {
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'ck-loading' }, '…'));
  let p;
  try { p = await api('/api/place'); }
  catch (err) { main.replaceChildren(el('p', { class: 'warn' }, err.message)); return; }
  const who = p.owner?.username ? `@${p.owner.username}` : p.fid ? `#${p.fid}` : '';
  const title = p.surname ?? (p.label ? p.label.toUpperCase() : 'FATLINE');
  const own = (p.nodes ?? []).filter((n) => n.own);
  const casts = el('div', { class: 'list' }, el('p', { class: 'muted' }, '…'));
  main.replaceChildren(el('section', { class: 'pl' },
    el('figure', { class: 'pl-art' }, el('img', { src: art(p), alt: '', width: 260, height: 260 })),
    el('h1', { class: 'pl-name' }, title),
    el('button', { type: 'button', class: 'pl-who', onclick: () => p.fid && viewProfile(p.fid) },
      p.owner?.pfp ? el('img', { src: p.owner.pfp, alt: '' }) : null, who),
    el('p', { class: 'pl-stage' }, stage(p)),
    coin(p),
    el('ul', { class: 'pl-nodes', 'aria-label': 'Its node' }, (own.length ? own : p.nodes ?? []).map(nodeLine)),
    el('p', { class: 'pl-host' }, 'Read from its own node, on this server.'),
    casts,
    el('p', { class: 'pl-foot' }, el('a', { href: 'https://fatline.ink', onclick: (e) => { e.preventDefault(); openUrl('https://fatline.ink'); } }, 'fatline.ink'))));
  if (!p.fid) { casts.replaceChildren(); return; }
  try {
    const page = await api('/api/feed', { network: state.network, fids: String(p.fid), limit: 20 });
    casts.replaceChildren(...(page.items.length ? page.items.map((i) => card(i, page.users)) : [el('p', { class: 'muted' }, 'Quiet.')]));
  } catch (err) {
    casts.replaceChildren(el('p', { class: 'muted' }, err.message));
  }
}
