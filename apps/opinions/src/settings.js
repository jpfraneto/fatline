// Settings: which network to read (Farcaster or Hypersnap) and which nodes. Not on the front page,
// but always one tap away, and the app never switches nodes without saying so.
import { $, api, chosenNode, el, state, store, t } from './lib.js';

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
  const token = el('input', { type: 'password', autocomplete: 'off', value: store.get('writeToken', ''), placeholder: '••••••' });
  token.addEventListener('change', () => store.set('writeToken', token.value.trim()));
  const identity = state.me?.fid
    ? el('p', { class: 'muted small' }, t('postingAs', state.me.fid), ' ', el('span', { class: 'mono' }, `${state.me.publicKey.slice(0, 12)}…`))
    : el('p', { class: 'muted small' }, t('needKey'));
  main.replaceChildren(
    el('h1', { class: 'app-title' }, t('settings')),
    el('h2', {}, t('network')), el('p', { class: 'muted small' }, t('networkHelp')), networks,
    el('h2', {}, t('nodes')), nodes,
    el('h2', {}, t('language')), langs,
    el('h2', {}, 'Farcaster'), identity,
    el('label', { class: 'muted small' }, t('writeToken'), token),
  );
  const status = await api('/api/networks').catch(() => []);
  // One choice per network: automatic, or exactly one node. The choice is stored in this browser.
  const current = chosenNode(state.network);
  const choose = (url) => { store.set(`node:${state.network}`, url); onChange(); };
  const describe = (node) => {
    const s = node.status;
    if (!s) return t('unknownState');
    if (s.error) return `${t('downState')} · ${s.error}`;
    return `v${s.version ?? '?'} · ${s.blockDelay > 200 ? t('behind', s.blockDelay) : `${s.blockDelay} ${t('blocksBehind')}`}`;
  };
  const net = status.find((n) => n.name === state.network);
  nodes.replaceChildren(
    el('p', { class: 'muted small' }, t('nodeChoice')),
    el('div', { class: 'node-choice', role: 'radiogroup', 'aria-label': t('nodes') },
      el('label', { class: 'node-option' }, el('input', { type: 'radio', name: 'node', checked: !current, onchange: () => choose('') }),
        el('span', {}, el('strong', {}, t('automaticShort')), el('span', { class: 'muted small' }, ` ${t('automatic')}`),
          net?.using ? el('span', { class: 'muted small' }, ` · ${t('usingNow', net.using.node.replace(/^https?:\/\//, ''))}`) : null)),
      ...(net?.nodes ?? []).map((node) => el('label', { class: `node-option ${node.status?.ok ? 'ok' : node.status?.error ? 'off' : node.status ? 'behind' : ''}` },
        el('input', { type: 'radio', name: 'node', checked: current === node.url, onchange: () => choose(node.url) }),
        el('span', {}, el('strong', {}, node.label ?? node.url.replace(/^https?:\/\//, '')), ' ',
          el('span', { class: 'muted small' }, node.own ? t('yours') : t('public')), el('br'),
          el('span', { class: 'mono' }, node.url.replace(/^https?:\/\//, '')), ' ',
          el('span', { class: 'muted small' }, describe(node)))))));
}
