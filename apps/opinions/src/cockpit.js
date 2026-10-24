// The cockpit: the client's home. Your node, your egg (or your Fatliner), and the one next step.
// Everything comes from /api/cockpit, refreshed every 15 seconds while the tab is visible.
import { $, api, el, state } from './lib.js';
import { card } from './feed.js';
import { castComposer } from './post.js';

const POLL_MS = 15_000;
// Each stone's egg, alive under the arch (the same art the token's metadata shows; on Arweave).
const AR = 'https://arweave.net/';
const EGGS = {
  ivory: 'mSdZFwP24DiFfz5n_CVxBOzrB7NUdj0BpxwBw1Q1Rcw', marble: '7RVqUSxKa1KAPRhRECd2hF3sqhiXJwGFHr1taHNflO4',
  sandstone: 'wJluZiKFMkVP8SuSdRRfaPtQsUBiH3DdcCDJkK-RF0E', basalt: 'kTiWpzd30A7VujdWhiiYKH0wMDTq6NHSqZy23109qu8',
  moss: 'tn1sJo8F2BLMkwf1VwAyS1nQ7pHX9ET9lFe8dfrEmag', gold: '3SXU46X5qj_uWYJ5n_R8TATUHDXd9XM9WMLWmX2kC08',
  opal: '8tZep0THiF6aYGlOv8LxxJs9xCbvwl6liWJvkBWApcw',
};
const BEINGS = { 18350: '9pzIvT9KiTuiIh98jxYMKP9NcIyUTSom6N2YxKVQWIM' };
const NET = { farcaster: 'Snapchain', hypersnap: 'Hypersnap' };

const n = (x) => Number(x).toLocaleString('en-US');
const hours = (min) => (min < 90 ? `about ${Math.max(1, Math.round(min))} min` : `about ${Math.round(min / 60)} h`);
const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
const cmd = (text) => el('div', { class: 'ck-cmd' }, el('code', {}, text), el('button', { type: 'button', onclick: async (e) => {
  try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Select it'; }
  setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
} }, 'Copy'));

// Where this person is, in one sentence, and what to do next.
export function story(d) {
  const { me, token: tk, hatch } = d;
  const nodes = Array.isArray(d.nodes) ? d.nodes : [];
  const own = nodes.some((x) => x.own) ? nodes.filter((x) => x.own) : nodes;
  const synced = own.find((x) => x.synced);
  const catching = own.filter((x) => x.answering && !x.synced).sort((a, b) => a.blocksBehind - b.blocksBehind)[0];
  const stage = tk?.stage ?? 'none';
  const hib = tk?.hibernatingUntil && tk.hibernatingUntil * 1000 > Date.now() ? tk.hibernatingUntil * 1000 : null;

  if (!me.fid) return { mood: 'idle', title: 'Who are you?', line: 'Connect your Farcaster account to this Fatline. You are your FID.', next: 'fatline connect' };
  if (stage === 'fatliner') return { mood: 'alive', title: `${tk.surname ?? ''} is alive.`, line: tk.asleep ? 'It changed hands and is asleep: link your own Farcaster account to it to wake it.' : `One of the 777. Its surname is the ticker of its coin, $${tk.surname}.`, next: null };
  if (stage === 'egg') {
    const w = hatch?.warmDays ?? 0, need = hatch?.needed ?? 3;
    const today = hatch?.today;
    const line = hatch?.none
      ? 'Your egg is on Base. No hatchery has reported on it yet; the first check comes within the hour.'
      : `${w} of ${need} warm days.${today && !today.done ? ` Today: ${today.passed} of ${today.need} hourly checks passed (of ${today.checks} so far).` : ''} Keep the node running: if it stops, the egg dies.`;
    return { mood: 'warm', title: 'Your egg is warming.', line, next: w >= need ? 'fatline hatch' : null };
  }
  if (tk?.genesis && stage === 'none') return { mood: 'ready', title: 'Aster is waiting for its keeper.', line: `The first egg is reserved for ${tk.genesis.to ? `${tk.genesis.to.slice(0, 6)}…${tk.genesis.to.slice(-4)}` : 'its keeper'}. Claim it with that wallet (a QR code to sign) and its three days begin.`, next: 'fatline genesis claim' };
  if (hib) return { mood: 'idle', title: 'Your Fatline is hibernating.', line: `An egg died here. You can take another on ${new Date(hib).toLocaleString()}.`, next: null };
  if (synced) return { mood: 'ready', title: 'Your node is in sync.', line: 'It holds its own copy of Farcaster. Now lay your egg: your node keeps it warm for three days, and it hatches into one of the 777.', next: 'fatline egg lay' };
  if (catching) {
    const eta = catching.etaMinutes != null ? ` About ${hours(catching.etaMinutes).replace(/^about /, "")} left at this pace.` : ' Measuring its pace…';
    return { mood: 'sync', title: 'Your node is catching up.', line: `${NET[catching.network] ?? catching.label}: ${n(catching.blocksBehind)} blocks behind.${eta} When it's in sync, you can lay your egg.`, next: null };
  }
  return { mood: 'idle', title: 'Your node is not answering yet.', line: 'If it is still downloading its snapshot, that is normal: it starts answering once the download is unpacked. Check it with fatline status.', next: 'fatline status' };
}

function art(d) {
  const tk = d.token ?? {};
  if (tk.stage === 'fatliner' && BEINGS[d.me.fid]) return { src: AR + BEINGS[d.me.fid], alt: 'Your Fatliner' };
  if (tk.stage === 'egg') return { src: AR + EGGS[tk.stone ?? 'ivory'], alt: `Your ${tk.stone ?? ''} egg, coming alive under the arch` };
  return { src: AR + EGGS.ivory, alt: 'An egg, waiting', dim: true };
}

function days(h) {
  const need = h?.needed ?? 3;
  const list = h?.days ?? [];
  return el('ol', { class: 'ck-days', 'aria-label': 'Warm days' }, Array.from({ length: need }, (_, i) => {
    const d = list[i];
    const pct = d ? Math.min(100, Math.round((d.passed / d.need) * 100)) : 0;
    const label = !d ? 'not yet' : d.warm ? 'warm' : d.done ? 'cold' : `${d.passed}/${d.need}`;
    return el('li', { class: d?.warm ? 'warm' : d?.done ? 'cold' : d ? 'now' : '' },
      el('span', { class: 'ck-bar' }, el('i', { style: `width:${pct}%` })), el('b', {}, `Day ${i + 1}`), el('small', {}, label));
  }));
}

function nodeRow(x) {
  const state = x.synced ? 'on' : x.answering ? 'sync' : 'off';
  const what = x.synced ? `in sync · ${n(x.blocksBehind)} blocks behind` : x.answering ? `catching up · ${n(x.blocksBehind)} blocks behind${x.etaMinutes != null ? ` · ${hours(x.etaMinutes)} left` : ''}` : 'not answering';
  return el('li', {}, el('i', { class: `ck-dot ${state} ${x.network}` }),
    el('span', {}, el('b', {}, NET[x.network] ?? x.label), ' ', el('small', {}, x.url.replace(/^https?:\/\//, ''))),
    el('small', { class: 'ck-what' }, what, x.messages ? ` · ${n(x.messages)} messages` : ''));
}

// How a cast leaves this window right now: through your own node, or (while it catches up) through another.
function casting(d) {
  const nodes = Array.isArray(d.nodes) ? d.nodes : [];
  const own = nodes.filter((x) => x.own);
  const ready = own.find((x) => x.synced);
  const behind = own.filter((x) => x.answering && !x.synced).sort((a, b) => a.blocksBehind - b.blocksBehind)[0];
  if (!d.me.canWrite) return { ok: false, text: 'This window has no key to speak with yet. Run fatline identity, or tap Cast and sign once with your wallet.' };
  if (ready) return { ok: true, text: `Your casts leave through your own node (${NET[ready.network] ?? ready.label}), signed here by you.` };
  if (behind) return { ok: false, text: `Your node is still catching up (${n(behind.blocksBehind)} blocks behind), so it can't check new casts yet. Until it can, your casts are still signed here, by you, and go out through Fatline's master node, which is not yours. You'll see which node carried each one.` };
  return { ok: false, text: "Your node isn't answering yet. Your casts are signed here and go out through Fatline's master node, which is not yours, until yours is in sync." };
}

function hero(d) {
  const s = story(d);
  const a = art(d);
  const tk = d.token ?? {};
  const name = d.me.username ? `@${d.me.username}` : d.me.fid ? `FID ${d.me.fid}` : 'Your Fatline';
  return el('div', { class: `ck-hero ck-${s.mood}` },
    el('div', { class: 'ck-fire' }, el('figure', { class: `ck-art${a.dim ? ' dim' : ''}` }, el('img', { src: a.src, alt: a.alt, width: 320, height: 320 }))),
    el('p', { class: 'ck-who' }, d.me.pfp ? el('img', { src: d.me.pfp, alt: '' }) : null, name, d.me.fid ? el('small', {}, ` · FID ${d.me.fid}`) : null,
      tk.surname && tk.stage !== 'none' ? el('small', {}, ` · ${tk.surname}`) : null, tk.stone ? el('small', {}, ` · ${tk.stone}`) : null),
    el('h1', { class: 'ck-title' }, s.title),
    el('p', { class: 'ck-line' }, s.line),
    tk.stage === 'egg' ? days(d.hatch) : null,
    s.next ? cmd(s.next) : null);
}

function lower(d) {
  const tk = d.token ?? {};
  const slots = tk.slots && tk.slots.fatliners != null ? (tk.slots.eggs != null ? `${tk.slots.eggs + tk.slots.fatliners} of ${tk.slots.max} taken (${tk.slots.eggs} eggs, ${tk.slots.fatliners} Fatliners)` : `${tk.slots.fatliners} of ${tk.slots.max} hatched`) : null;
  const nodes = Array.isArray(d.nodes) ? d.nodes : [];
  const scan = (x) => el('a', { href: `https://basescan.org/address/${x}`, target: '_blank', rel: 'noopener' }, `${x.slice(0, 6)}…${x.slice(-4)}`);
  const app = tk.app
    ? el('p', { class: 'ck-app' }, 'This window runs its own smart contract: ', scan(tk.app), '.')
    : tk.stage === 'egg'
      ? el('p', { class: 'ck-app' }, 'This window has no smart contract yet. You can set one, once, while your egg is hatching: after that it is final.')
      : null;
  return [
    app,
    el('h2', { class: 'ck-h' }, 'Your nodes'),
    el('ul', { class: 'ck-nodes' }, nodes.length ? nodes.map(nodeRow) : el('li', {}, el('small', {}, 'No nodes configured. Run fatline setup.'))),
    el('p', { class: 'ck-foot' },
      slots ? `The 777: ${slots}. ` : '',
      tk.contract ? el('a', { href: `https://basescan.org/address/${tk.contract}`, target: '_blank', rel: 'noopener' }, 'The Fatliners contract') : null,
      ' · ', el('a', { href: 'https://fatline.ink', target: '_blank', rel: 'noopener' }, 'fatline.ink'),
      ' · ', el('span', { class: 'ck-at' }, `checked ${ago(d.at)}`)),
  ];
}

// Around the fire: your voice and your people's, through this window.
function fire(fids, onCast) {
  const list = el('div', { class: 'list ck-around' }, el('p', { class: 'muted' }, 'Listening…'));
  const load = async () => {
    try {
      const page = await api('/api/feed', { network: state.network, fids: fids.join(','), limit: 8 });
      list.replaceChildren(...(page.items.length ? page.items.map((i) => card(i, page.users)) : [el('p', { class: 'muted' }, 'Quiet for now. Say something, or add your people in My people.')]));
    } catch (err) {
      list.replaceChildren(el('p', { class: 'muted' }, /No reachable|synced/i.test(err.message) ? "Your people's casts appear here once a node in sync can read them." : err.message));
    }
  };
  load();
  return { list, load };
}

let timer = null;
export async function cockpitPage() {
  clearTimeout(timer);
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'ck-loading' }, 'Looking at your node…'));
  let d;
  try { d = await api('/api/cockpit'); }
  catch (err) { main.replaceChildren(el('p', { class: 'warn' }, `Can't reach this Fatline's server: ${err.message}`)); return; }
  // The parts that change with the node are redrawn on each check; the fire (what you type, what was said) stays.
  const top = el('div', {}, hero(d));
  const way = el('p', { class: 'ck-way' });
  const showWay = (x) => { const c = casting(x); way.className = `ck-way ${c.ok ? 'ok' : 'via'}`; way.textContent = c.text; };
  showWay(d);
  const fids = [...new Set([...(state.people ?? []).map((p) => p.fid), ...(d.me.fid ? [d.me.fid] : [])])];
  const around = fire(fids);
  const bottom = el('div', {}, ...lower(d));
  main.replaceChildren(el('section', { class: 'ck' }, top,
    el('section', { class: 'ck-circle', 'aria-labelledby': 'ck-fire-h' },
      el('h2', { class: 'ck-h', id: 'ck-fire-h' }, 'By the fire'),
      el('p', { class: 'ck-sub' }, 'Your Fatliner, you, and your people. Talk about life.'),
      way,
      castComposer({ onDone: () => setTimeout(around.load, 1500) }),
      around.list),
    bottom));
  const tick = async () => {
    if (!document.body.contains(top) || !/^\/?$/.test(location.hash.slice(1))) return;
    if (!document.hidden) {
      try { const x = await api('/api/cockpit'); top.replaceChildren(hero(x)); showWay(x); bottom.replaceChildren(...lower(x)); } catch { /* keep the last view; the next check retries */ }
    }
    timer = setTimeout(tick, POLL_MS);
  };
  timer = setTimeout(tick, POLL_MS);
}
export function leaveCockpit() { clearTimeout(timer); }
