// The client inside Farcaster: the game depends on who opens it.
//   No egg yet     how to get one, plainly.
//   An egg         the egg on top (hatch it when it's ready, or launch its coin), its warm days, and their
//                  Farcaster underneath: the people they follow, read from this server's own node.
//   A Fatliner     the being and its coin on top, then their feed (one line about the node while it is not in sync).
// The same layout on every Fatline, so it is predictable. Everything comes from this server: /api/viewer and /api/home.
import { $, api, el } from './lib.js';
import { openUrl, viewer } from './miniapp.js';
import { birthPanel } from './birth.js';
import { dayFeed } from './day.js';

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

function nodeLine(v) {
  if (!v.node || v.node.live) return null;
  return el('p', { class: 'vw-node' }, v.node.syncing ? 'Your node is catching up. The feed fills in as it does.' : 'Your node did not answer the last check.');
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
  // Their token on top, as it is now (egg, ready to hatch, Fatliner, its coin), and what they can do with it, right here.
  const warm = v.egg ? { warmDays: v.egg.warmDays ?? 0, needed: v.egg.needed ?? 3 } : null;
  main.replaceChildren(...[birthPanel(fid, { warm }), nodeLine(v), dayFeed(fid, 'The people you follow, read from this node.')].filter(Boolean));
}

