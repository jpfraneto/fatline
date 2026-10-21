import { appPage, appsPage, launchPage } from './apps.js';
import { feedPage, peoplePage, voicePage } from './feed.js';
import { $, api, el, showSource, state, store, t } from './lib.js';
import { settingsPage } from './settings.js';

function renderChrome() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-t]').forEach((n) => { n.textContent = t(n.dataset.t); });
  $('#settings-link').setAttribute('aria-label', t('settings'));
}

const fail = (err) => $('#main').replaceChildren(el('p', { class: 'warn' }, err.message));

function route() {
  const hash = location.hash.slice(1) || '/';
  const tab = hash.startsWith('/voices') || hash.startsWith('/voice/') ? 'voices' : hash.startsWith('/people') ? 'people' : hash.startsWith('/settings') ? 'settings' : 'apps';
  document.querySelectorAll('#tabs a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.tab === tab)));
  if (tab !== 'voices' && tab !== 'people') showSource(null);
  window.scrollTo(0, 0);

  const app = hash.match(/^\/app\/(0x[0-9a-fA-F]{40})/);
  if (app) return appPage(app[1]).catch(fail);
  const voice = hash.match(/^\/voice\/(\d+)/);
  if (voice) return voicePage(voice[1]).catch(fail);
  if (hash.startsWith('/launch')) return launchPage();
  if (hash.startsWith('/voices')) return feedPage({ route }).catch(fail);
  if (hash.startsWith('/people')) return peoplePage({ route });
  if (hash.startsWith('/settings')) return settingsPage({ onChange: () => { renderChrome(); route(); } }).catch(fail);
  return appsPage().catch(fail);
}

async function boot() {
  state.config = await api('/api/config');
  const saved = store.get('network', null);
  state.network = state.config.networks.some((n) => n.name === saved) ? saved : state.config.defaultNetwork;
  renderChrome();
  window.addEventListener('hashchange', route);
  route();
}

boot().catch(fail);
