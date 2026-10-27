// The client inside Farcaster: the game depends on who opens it.
//   No egg yet     how to get one, plainly.
//   An egg         its status on top, and their Farcaster coming to life underneath: the people they follow,
//                  read from this server's own node.
//   A Fatliner     just their feed (with one line about the node while it is not in sync).
// The same layout on every Fatline, so it is predictable. Everything comes from this server: /api/viewer and /api/home.
import { $, api, el, state } from './lib.js';
import { card } from './feed.js';
import { AR, EGGS } from './cockpit.js';
import { openUrl, viewer } from './miniapp.js';

const cap = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');
const copy = (text) => el('div', { class: 'ck-cmd' }, el('code', {}, text), el('button', { type: 'button', onclick: async (e) => {
  try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Select it'; }
  setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
} }, 'Copy'));

function howToGetOne(v) {
  return el('section', { class: 'vw-how' },
    el('h1', { class: 'ck-title' }, v.username ? `@${v.username}, you have no egg yet.` : 'No egg yet.'),
    el('p', { class: 'ck-line' }, 'A Fatliner hatches from your own Farcaster node. Keep it live for three days and it is yours: one of 777.'),
    el('ol', { class: 'vw-steps' },
      el('li', {}, el('b', {}, 'Rent a server'), ' that can hold Farcaster. From about $2.60 a day.'),
      el('li', {}, el('b', {}, 'Run your node'), ' on it: Snapchain or Hypersnap, your pick.'),
      el('li', {}, el('b', {}, 'Lay your egg.'), ' The network checks your node every hour. Three warm days and it hatches.')),
    el('p', { class: 'vw-label' }, 'Easiest: paste this into your agent (Claude Code, Codex…)'),
    copy('Help me run a Fatline: https://fatline.ink/skill.md'),
    el('p', { class: 'vw-label' }, 'Or on your computer:'),
    copy('curl -fsSL https://fatline.ink/install.sh | sh'),
    el('p', { class: 'vw-label' }, 'Already run a node? On its server:'),
    copy('curl -fsSL https://fatline.ink/join.sh | sudo bash'),
    el('p', { class: 'ck-foot' }, el('a', { href: 'https://fatline.ink/docs/', onclick: (e) => { e.preventDefault(); openUrl('https://fatline.ink/docs/'); } }, 'The full guide')));
}

function eggStatus(v) {
  const e = v.egg ?? { warmDays: 0, needed: 3, days: [] };
  const days = Array.from({ length: e.needed }, (_, i) => {
    const d = e.days?.[i];
    const pct = d ? Math.min(100, Math.round((d.passed / d.need) * 100)) : 0;
    return el('li', { class: d?.warm ? 'warm' : '' }, el('div', { class: 'ck-bar' }, el('i', { style: `width:${pct}%` })), el('small', {}, `day ${i + 1}`));
  });
  const eta = e.eta ? new Date(e.eta) : null;
  const when = !eta ? 'Your node keeps it warm.' : eta - Date.now() < 60_000 ? 'Hatching now.'
    : `Hatches in about ${Math.max(1, Math.round((eta - Date.now()) / 3_600_000))} h, ${eta.toLocaleString(state.lang, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}, if your node stays up.`;
  return el('section', { class: 'vw-egg' },
    el('img', { src: AR + EGGS[v.stone ?? 'ivory'], alt: '', width: 72, height: 72 }),
    el('div', {},
      el('b', {}, cap(v.surname) || 'Your egg', el('small', {}, ` · ${e.warmDays} of ${e.needed} warm days`)),
      el('ul', { class: 'ck-days vw-days' }, days),
      el('small', { class: 'vw-when' }, when)));
}

function nodeLine(v) {
  if (!v.node || v.node.live) return null;
  return el('p', { class: 'vw-node' }, v.node.syncing ? 'Your node is catching up. The feed fills in as it does.' : 'Your node did not answer the last check.');
}

function feed(fid) {
  const list = el('div', { class: 'list' }, el('p', { class: 'muted' }, 'Reading the people you follow from this node…'));
  const more = el('button', { type: 'button', class: 'more', hidden: true }, 'More');
  let next = null;
  const load = async () => {
    more.disabled = true;
    try {
      const page = await api(`/api/home/${fid}`, next ? { before: next } : {});
      if (!next) list.replaceChildren();
      list.append(...page.items.map((i) => card(i, page.users)));
      if (!list.children.length) list.append(el('p', { class: 'muted' }, 'Quiet so far.'));
      next = page.next; more.hidden = !next;
    } catch (err) {
      if (!next) list.replaceChildren(el('p', { class: 'muted' }, err.message));
    }
    more.disabled = false;
  };
  more.onclick = load;
  load();
  return el('div', {}, list, more);
}

export async function placePage() {
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'ck-loading' }, '…'));
  // Who is looking (the Farcaster app says; outside it, this place's owner).
  let fid = (await viewer())?.fid ?? null;
  if (!fid) { try { fid = (await api('/api/place')).fid; } catch {} }
  if (!fid) { main.replaceChildren(howToGetOne({})); return; }
  let v;
  try { v = await api(`/api/viewer/${fid}`); } catch (err) { main.replaceChildren(el('p', { class: 'warn' }, err.message)); return; }
  if (v.stage === 'none') { main.replaceChildren(howToGetOne(v)); return; }
  // Warm enough to hatch: the birth (hatch, then its coin).
  if (v.stage === 'egg' && v.egg?.hatched) { location.hash = `#/birth/${fid}`; return; }
  const coinLine = v.stage === 'fatliner' ? el('p', { class: 'vw-node' }, el('a', { href: `#/birth/${fid}` }, `$${v.surname ?? ''} →`)) : null;
  main.replaceChildren(...[v.stage === 'egg' ? eggStatus(v) : nodeLine(v), coinLine, feed(fid)].filter(Boolean));
}

