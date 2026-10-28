import { appsPage, launchPage } from './apps.js';
import { feedPage, peoplePage, voicePage } from './feed.js';
import { $, api, el, showSource, state, store, t } from './lib.js';
import { settingsPage } from './settings.js';
import { archivePage, coinPage, leaveLive, nodePage } from './fatline.js';
import { loadMe } from './post.js';
import { castButton } from './castbutton.js';
import { cockpitPage, leaveCockpit } from './cockpit.js';
import { placePage } from './place.js';
import { birthPage } from './birth.js';
import { enterMiniApp, inMiniApp } from './miniapp.js';

// A link from the server's setup, https://<name>.fatline.ink/#key=<write token>: keep the token in this browser (so it
// can cast through this client), then take it out of the address bar and history.
const keyLink = location.hash.match(/^#key=([A-Za-z0-9_-]{16,128})$/);
if (keyLink) {
  store.set('writeToken', keyLink[1]);
  history.replaceState(null, '', `${location.pathname}${location.search}#/`);
}

// The day's planet, as in the iOS app: Steiner's sevenfold week, each day under its planet and color.
const PLANETS = [['☉', '#edba54'], ['☽', '#ad99db'], ['♂', '#c74a66'], ['☿', '#f2db66'], ['♃', '#f2944d'], ['♀', '#66b8a8'], ['♄', '#5c8cdb']];

function renderChrome() {
  document.documentElement.lang = state.lang;
  // The network tints everything: Snapchain warm, Hypersnap cool.
  document.documentElement.dataset.net = state.network === 'hypersnap' ? 'hypersnap' : 'snapchain';
  const [glyph, color] = PLANETS[new Date().getDay()];
  const planet = $('#planet');
  if (planet) { planet.textContent = glyph; planet.style.setProperty('--planet', color); }
  document.querySelectorAll('[data-t]').forEach((n) => { n.textContent = t(n.dataset.t); });
  $('#settings-link').setAttribute('aria-label', t('settings'));
  // Voices (long posts onchain) only where a Voices contract is configured; otherwise no tab at all.
  const voicesTab = document.querySelector('#tabs a[data-tab="voices"]');
  if (voicesTab) voicesTab.hidden = !state.config?.voices?.address;
}

const fail = (err) => $('#main').replaceChildren(el('p', { class: 'warn' }, err.message));

function route() {
  const hash = location.hash.slice(1) || '/';
  const tab = hash.startsWith('/archive') ? 'archive' : hash.startsWith('/voices') || hash.startsWith('/voice/') ? 'voices' : hash.startsWith('/people') ? 'people' : hash.startsWith('/settings') ? 'settings' : hash.startsWith('/apps') || hash.startsWith('/launch') || hash.startsWith('/coin') || hash.startsWith('/node') ? 'apps' : 'home';
  document.querySelectorAll('#tabs a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.tab === tab)));
  if (tab !== 'voices' && tab !== 'people') showSource(null);
  window.scrollTo(0, 0);
  leaveLive();
  leaveCockpit();
  $('#main').classList.remove('fatline-page', 'birth-page');

  // The canonical page of a coin (or of a coinless app's vault): #/coin/<chainId>/<address>.
  const coin = hash.match(/^\/coin\/([^/]+)\/([^/?#]+)/);
  if (coin) return coinPage(coin[1], coin[2]);
  const archive = hash.match(/^\/archive(?:\/(\d{1,12}))?/);
  if (archive) return archivePage(archive[1]);
  const node = hash.match(/^\/node\/([\w-]{1,64})/);
  if (node) return nodePage(node[1]);
  // Older links: #/app/<address> now lives at the coin route.
  const app = hash.match(/^\/app\/(0x[0-9a-fA-F]{40})/);
  if (app) { location.replace(`#/coin/${state.config.launchpad?.chainId ?? 8453}/${app[1]}`); return; }
  const voice = hash.match(/^\/voice\/(\d+)/);
  if (voice) return voicePage(voice[1]).catch(fail);
  // The birth: hatch, then the coin, from the holder's wallet. #/birth/<fid>, or #/birth/<fid>/demo to walk through it.
  const birth = hash.match(/^\/birth\/(\d{1,12})(\/demo)?/);
  if (birth) return birthPage(birth[1], { demo: Boolean(birth[2]) }).catch(fail);
  if (hash.startsWith('/launch')) return launchPage();
  if (hash.startsWith('/voices')) {
    if (!state.config.voices?.address) { location.replace('#/'); return; }
    return feedPage({ route }).catch(fail);
  }
  if (hash.startsWith('/people')) return peoplePage({ route });
  if (hash.startsWith('/settings')) return settingsPage({ onChange: () => { renderChrome(); route(); } }).catch(fail);
  if (hash.startsWith('/apps')) return appsPage().catch(fail);
  // Opened from a cast inside Farcaster, or at #/place: the place as a visitor sees it.
  if (hash.startsWith('/place') || inMiniApp()) return placePage().catch(fail);
  return cockpitPage().catch(fail);
}

async function boot() {
  await enterMiniApp();
  state.config = await api('/api/config');
  const saved = store.get('network', null);
  state.network = state.config.networks.some((n) => n.name === saved) ? saved : state.config.defaultNetwork;
  await loadMe();
  if (!inMiniApp() || state.me?.canWrite) document.body.append(castButton()); // visitors only look
  renderChrome();
  window.addEventListener('hashchange', route);
  route();
}

boot().catch(fail);
