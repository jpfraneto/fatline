// Settings: which network to read (Farcaster or Hypersnap) and which nodes. Not on the front page,
// but always one tap away, and the app never switches nodes without saying so.
import { $, api, el, state, store, t } from './lib.js';

export async function settingsPage({ onChange }) {
  const main = $('#main');
  const networks = el('div', { class: 'switch', role: 'radiogroup', 'aria-label': t('network') },
    ...state.config.networks.map((n) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(n.name === state.network), title: n.about,
      onclick: () => { state.network = n.name; store.set('network', n.name); onChange(); },
    }, n.label)));
  const langs = el('div', { class: 'switch', role: 'radiogroup', 'aria-label': t('language') },
    ...[['es', 'Español'], ['en', 'English']].map(([code, name]) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(code === state.lang),
      onclick: () => { state.lang = code; store.set('lang', code); onChange(); },
    }, name)));
  const nodes = el('div', { class: 'nodes' }, el('p', { class: 'muted' }, '…'));
  main.replaceChildren(
    el('h1', { class: 'app-title' }, t('settings')),
    el('h2', {}, t('network')), el('p', { class: 'muted small' }, t('networkHelp')), networks,
    el('h2', {}, t('nodes')), nodes,
    el('h2', {}, t('language')), langs,
  );
  const status = await api('/api/networks').catch(() => []);
  nodes.replaceChildren(...status.filter((n) => n.name === state.network).flatMap((n) => n.nodes.map((node) => el('p', { class: `node ${node.status?.ok ? 'ok' : 'off'}` },
    el('span', { class: 'mono' }, node.url.replace(/^https?:\/\//, '')), ' ',
    el('span', { class: 'muted' }, `${node.own ? t('yours') : t('public')} · ${node.status?.ok ? `v${node.status.version} · ${node.status.blockDelay} blocks behind` : node.status?.error ?? 'offline'}`),
    n.using?.node === node.url ? el('strong', {}, ' ✓') : null))));
}
