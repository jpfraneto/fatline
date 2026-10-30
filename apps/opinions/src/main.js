import { appsPage, launchPage } from './apps.js';
import { feedPage, voicePage } from './feed.js';
import { $, api, el, showSource, state, store, t } from './lib.js';
import { settingsPage } from './settings.js';
import { archivePage, coinPage, leaveLive, nodePage } from './fatline.js';
import { dayPage, leaveDay } from './day.js';
import { directoryPage } from './directory.js';
import { joinPage, nodeProfilePage, nodesPage } from './nodes.js';
import { loadMe } from './post.js';
import { castButton, openCast } from './castbutton.js';
import { cockpitPage, leaveCockpit } from './cockpit.js';
import { mePage } from './me.js';
import { personPage, searchPage } from './person.js';
import { snap } from './snap.js';
import { loggedIn, profileOf } from './fatline-login.js';
import { ARCH, RIPPLE, STAR, STREAM, VOICE } from './glyphs.js';
import { aroundPage, leaveAround } from './around.js';
import { forYouPage, leaveForYou } from './foryou.js';
import { startKeys } from './keys.js';
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
  const glyphs = { stream: STREAM, star: STAR, voice: VOICE, ripple: RIPPLE };
  document.querySelectorAll('[data-glyph]').forEach((n) => { if (!n.firstChild) n.innerHTML = glyphs[n.dataset.glyph]; });
  renderMe();
  // The network switch, always in sight: Snapchain warm, Hypersnap cool.
  const sw = $('#netswitch');
  if (sw && state.config?.networks?.length > 1) {
    sw.replaceChildren(...state.config.networks.map((n) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(n.name === state.network), 'data-net': n.name === 'hypersnap' ? 'hypersnap' : 'snapchain', title: n.about ?? '',
      onclick: () => {
        if (n.name === state.network) return;
        state.network = n.name; store.set('network', n.name);
        // The SNAP: the client reboots onto the other copy of Farcaster, and the current runs through it.
        snap(n.name === 'hypersnap' ? 'hypersnap' : 'snapchain', { done: () => { renderChrome(); route(); } });
      },
    }, n.name === 'hypersnap' ? 'Hypersnap' : 'Snapchain')));
  }
  // Voices (long posts onchain) only where a Voices contract is configured; otherwise no tab at all.
  const voicesTab = document.querySelector('#tabs a[data-tab="voices"]');
  if (voicesTab) voicesTab.hidden = !state.config?.voices?.address;
}

// The face in the bar: yours once signed in, else the Farcaster arch, glowing, asking you in.
async function renderMe() {
  const face = $('#me-face');
  if (!face) return;
  const who = loggedIn();
  $('#me-tab').setAttribute('aria-label', who ? t('you') : t('signIn'));
  if (!who) { face.className = 'me-face fc-glow'; face.innerHTML = ARCH; return; }
  face.className = 'me-face';
  face.replaceChildren(el('span', { class: 'me-dot' }));
  const p = await profileOf(who.fid);
  if (p.pfp && loggedIn()?.fid === who.fid) face.replaceChildren(el('img', { src: p.pfp, alt: '' }));
}

const fail = (err) => $('#main').replaceChildren(el('p', { class: 'warn' }, err.message));

function route() {
  const hash = location.hash.slice(1) || '/';
  const tab = hash.startsWith('/search') || hash.startsWith('/u/') ? 'search' : hash.startsWith('/archive') ? 'archive' : hash.startsWith('/voices') || hash.startsWith('/voice/') ? 'voices' : hash.startsWith('/people') ? 'me' : hash.startsWith('/around') ? 'around' : hash.startsWith('/settings') ? 'settings' : hash.startsWith('/fatline') || hash.startsWith('/here') || hash.startsWith('/apps') || hash.startsWith('/launch') || hash.startsWith('/coin') || hash.startsWith('/node') || hash.startsWith('/join') ? 'fatline' : 'home';
  document.querySelectorAll('#tabs a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.tab === tab)));
  if (tab !== 'voices' && tab !== 'search') showSource(null);
  window.scrollTo(0, 0);
  leaveLive();
  leaveCockpit();
  leaveAround();
  leaveForYou();
  leaveDay();
  $('#main').classList.remove('fatline-page', 'birth-page');

  // The canonical page of a coin (or of a coinless app's vault): #/coin/<chainId>/<address>.
  const coin = hash.match(/^\/coin\/([^/]+)\/([^/?#]+)/);
  if (coin) return coinPage(coin[1], coin[2]);
  // The lupa: anyone on Farcaster, as this node holds them.
  if (hash.startsWith('/search')) return searchPage();
  const person = hash.match(/^\/u\/([^/?#]{1,64})/);
  if (person) return personPage(decodeURIComponent(person[1])).catch(fail);
  const archive = hash.match(/^\/archive(?:\/(\d{1,12}))?/);
  if (archive) return archivePage(archive[1]);
  // The registry: every node and client that joined Fatline (nodes.js). #/nodes, #/nodes/<id>, #/join.
  const listed = hash.match(/^\/nodes\/([a-z0-9-]{1,64})/);
  if (listed) return nodeProfilePage(listed[1]).catch(fail);
  if (hash === '/nodes' || hash.startsWith('/nodes?')) return nodesPage().catch(fail);
  if (hash.startsWith('/join')) return joinPage().catch(fail);
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
  // Around: everything that happens around you (or around anyone: #/around/<fid or name>), newest first.
  const near = hash.match(/^\/around(?:\/([^/?#]{1,64}))?/);
  if (near) return aroundPage(near[1] ? decodeURIComponent(near[1]) : null).catch(fail);
  if (hash.startsWith('/people')) return mePage({ route }).catch(fail);
  if (hash.startsWith('/settings')) return settingsPage({ onChange: () => { renderChrome(); route(); } }).catch(fail);
  if (hash.startsWith('/apps')) return appsPage().catch(fail);
  if (hash.startsWith('/fatline')) return directoryPage().catch(fail);
  if (hash.startsWith('/here')) return cockpitPage().catch(fail);
  // Opened from a cast inside Farcaster, or at #/place: the place as a visitor sees it.
  if (hash.startsWith('/place') || inMiniApp()) return placePage().catch(fail);
  // The day, in order, through someone's eyes (day.js).
  if (hash.startsWith('/day')) return dayPage().catch(fail);
  // Home: For you, casts worth answering (foryou.js).
  return forYouPage().catch(fail);
}

async function boot() {
  // Opens at once from what this device knew last (the server's setup, who you are, this place), then checks quietly.
  const [, config] = await Promise.all([enterMiniApp(), (async () => {
    const fresh = api('/api/config').then((c) => { store.set('config', c); return c; });
    const kept = store.get('config', null);
    if (kept) { fresh.catch(() => {}); return kept; }
    return fresh;
  })()]);
  state.config = config;
  api('/api/place').then((p) => store.set('place', p)).catch(() => {});
  const saved = store.get('network', null);
  state.network = state.config.networks.some((n) => n.name === saved) ? saved : state.config.defaultNetwork;
  const keptMe = store.get('me', null);
  const meNow = loadMe();
  if (keptMe) {
    state.me = keptMe;
    meNow.then((m) => { if (m.fid !== keptMe.fid || m.canWrite !== keptMe.canWrite) { renderMe(); route(); } });
  } else await meNow;
  if (!inMiniApp() || state.me?.canWrite) document.body.append(castButton()); // visitors only look
  renderChrome();
  // Signed out, the face in the bar signs you in, right there (the pen does too).
  $('#me-tab').addEventListener('click', (e) => { if (!loggedIn()) { e.preventDefault(); openCast(); } });
  // Signed in or out: the face changes, and the page shows it (Today through your eyes).
  window.addEventListener('fatline:me', () => { renderMe(); route(); });
  window.addEventListener('hashchange', route);
  startKeys();
  route();
}

boot().catch(fail);
