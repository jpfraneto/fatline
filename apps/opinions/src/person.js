// The lupa: look anyone up on Farcaster, as this node holds them. #/search asks; #/u/<@name or FID> answers with
// what the node keeps: who they are, the wallets that own and can recover the account, since when, verified
// addresses, storage and how much of it the node holds, which apps hold keys, and their latest casts.
// A node finds an exact @username or FID; it has no search by part of a name.
import { $, api, date, el, showSource, state, store } from './lib.js';
import { followButton } from './post.js';
import { loggedIn } from './fatline-login.js';
import { openPlace } from './miniapp.js';

const RECENT = 'lupa:recent';
const titled = (s) => s.charAt(0) + s.slice(1).toLowerCase();
const n = (x) => Number(x).toLocaleString(state.lang);
const hhmm = (ms) => new Date(ms).toLocaleString(state.lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function remember(user) {
  const list = store.get(RECENT, []).filter((u) => u.fid !== user.fid);
  store.set(RECENT, [{ fid: user.fid, username: user.username, pfp: user.pfp }, ...list].slice(0, 8));
}

export function searchPage() {
  const main = $('#main');
  showSource(null);
  const input = el('input', { type: 'search', placeholder: '@username or FID', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'search' });
  const go = (q) => { q = String(q).trim().replace(/^@/, ''); if (q) location.hash = `#/u/${encodeURIComponent(q)}`; };
  const recent = store.get(RECENT, []);
  main.replaceChildren(el('section', { class: 'lupa' },
    el('form', { class: 'lupa-form', onsubmit: (e) => { e.preventDefault(); go(input.value); } },
      el('span', { class: 'lupa-glass', 'aria-hidden': 'true' }, '⌕'), input),
    el('p', { class: 'muted small' }, 'Anyone on Farcaster, read from this node. An exact @username or FID.'),
    recent.length ? el('div', { class: 'lupa-recent' }, ...recent.map((u) => el('a', { href: `#/u/${u.fid}`, class: 'lupa-chip' },
      u.pfp ? el('img', { src: u.pfp, alt: '' }) : null, u.username ? `@${u.username}` : `FID ${u.fid}`))) : null));
  input.focus();
}

function fact(label, ...value) {
  return el('div', { class: 'pf-fact' }, el('dt', {}, label), el('dd', {}, ...value));
}

const wallet = (a) => el('code', { title: a }, `${a.slice(0, 6)}…${a.slice(-4)}`);

function held(s, word) {
  if (!s) return null;
  return el('span', {}, `${n(s.used)} ${word}`, s.used >= s.limit ? el('span', { class: 'muted' }, ' (full: the oldest give way)') : el('span', { class: 'muted' }, ` of ${n(s.limit)}`));
}

export async function personPage(q) {
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'ck-loading' }, '…'));
  let p;
  try { p = await api('/api/person', { q, network: state.network }); } catch (err) {
    main.replaceChildren(el('section', { class: 'lupa' }, el('p', { class: 'warn' }, err.message), el('p', {}, el('a', { href: '#/search' }, 'Look up someone else'))));
    return;
  }
  showSource(p.source);
  remember(p.user);
  const u = p.user;
  const where = u.location?.startsWith('geo:') ? null : u.location;
  const fatline = el('div', { class: 'pf-fatline' });
  main.replaceChildren(el('section', { class: 'person' },
    el('header', { class: 'me-head' },
      u.pfp ? el('img', { class: 'me-pfp', src: u.pfp, alt: '' }) : el('span', { class: 'me-pfp' }),
      el('div', {},
        el('h1', {}, u.displayName || (u.username ? `@${u.username}` : `FID ${u.fid}`)),
        el('p', { class: 'muted' }, [u.username ? `@${u.username}` : null, `FID ${u.fid}`, where].filter(Boolean).join(' · ')))),
    u.bio ? el('p', { class: 'pf-bio' }, u.bio) : null,
    u.url ? el('p', { class: 'pf-url' }, el('a', { href: u.url, target: '_blank', rel: 'noopener' }, u.url.replace(/^https?:\/\//, ''))) : null,
    loggedIn() && loggedIn().fid !== u.fid ? el('div', { class: 'pf-follow' }, followButton(u.fid)) : null,
    fatline,
    el('h2', {}, 'What this node holds'),
    el('dl', { class: 'pf-facts' },
      p.since ? fact('On Farcaster since', date(p.since)) : null,
      p.custody ? fact('Owned by', wallet(p.custody)) : null,
      p.recovery ? fact('Can be recovered by', wallet(p.recovery)) : null,
      p.addresses.length ? fact('Verified', ...p.addresses.map((a) => el('span', { class: 'pf-addr' }, wallet(a.address), el('span', { class: 'muted' }, ` ${a.chain}`)))) : null,
      p.storage?.units != null ? fact('Storage', `${n(p.storage.units)} units`) : null,
      p.storage?.casts ? fact('Casts', held(p.storage.casts, 'casts')) : null,
      p.storage?.links ? fact('Follows', held(p.storage.links, 'follows')) : null,
      p.storage?.reactions ? fact('Reactions', held(p.storage.reactions, 'likes and recasts')) : null,
      p.apps.length ? fact('Apps with a key', ...p.apps.map((a) => (a.fid
        ? el('a', { href: `#/u/${a.fid}`, class: 'pf-app' }, a.username ? `@${a.username}` : `FID ${a.fid}`, a.keys > 1 ? ` ×${a.keys}` : '')
        : el('span', { class: 'pf-app muted' }, `unknown${a.keys > 1 ? ` ×${a.keys}` : ''}`)))) : null),
    el('h2', {}, 'Latest'),
    p.casts.length
      ? el('div', { class: 'pf-casts' }, ...p.casts.map((c) => el('article', { class: 'mo' },
        el('div', { class: 'mo-when' }, el('time', {}, hhmm(c.timestamp)), c.parent ? el('span', { class: 'mo-ch' }, 'reply') : null),
        c.text ? el('p', { class: 'mo-text' }, c.text) : el('p', { class: 'muted' }, '(no text)'))))
      : el('p', { class: 'muted' }, 'Nothing on this node yet.')));
  // Their place in the Fatline world, if they have one.
  fetch('https://fatline.ink/world').then((r) => r.json()).then((w) => {
    const tk = (w.tokens ?? []).find((t) => t.surname && (t.fid === u.fid || t.linkedFid === u.fid) && (t.stage === 'egg' || t.stage === 'fatliner'));
    if (!tk) return;
    const name = tk.fid === w.genesisFid ? `Aster ${titled(tk.surname)}` : titled(tk.surname);
    fatline.replaceChildren(el('button', { type: 'button', class: 'pf-place', onclick: () => openPlace(`https://${tk.surname.toLowerCase()}.fatline.ink`) },
      el('span', {}, tk.stage === 'fatliner' ? 'Keeps a Fatline: ' : 'Keeps an egg: '), el('b', {}, name), ' →'));
  }).catch(() => {});
}
