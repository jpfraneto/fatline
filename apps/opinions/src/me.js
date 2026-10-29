// You (#/people, the face in the bar): who is signed in on this client. Signed out, one thing: Sign in with Farcaster.
import { $, el, t } from './lib.js';
import { castComposer, loadMe } from './post.js';
import { loggedIn, logOut, profileOf } from './fatline-login.js';
import { openCast } from './castbutton.js';
import { ARCH, glyph } from './glyphs.js';

export async function mePage({ route }) {
  const main = $('#main');
  const who = loggedIn();
  if (!who) {
    return main.replaceChildren(el('section', { class: 'me-in' },
      glyph(ARCH, 'fc-badge big'),
      el('h1', {}, t('signIn')),
      el('p', {}, t('signInWhy')),
      el('button', { type: 'button', class: 'fc-button', onclick: () => openCast() }, glyph(ARCH, 'fc-mark'), t('signIn')),
      el('p', { class: 'muted small' }, t('signInNote'))));
  }
  main.replaceChildren(el('p', { class: 'ck-loading' }, '…'));
  const p = await profileOf(who.fid);
  main.replaceChildren(
    el('header', { class: 'me-head' },
      p.pfp ? el('img', { class: 'me-pfp', src: p.pfp, alt: '' }) : el('span', { class: 'me-pfp' }),
      el('div', {},
        el('h1', {}, p.displayName || (p.username ? `@${p.username}` : `FID ${who.fid}`)),
        el('p', { class: 'muted' }, [p.username ? `@${p.username}` : null, `FID ${who.fid}`].filter(Boolean).join(' · ')))),
    castComposer({ onDone: () => setTimeout(route, 1500) }),
    el('p', { class: 'me-foot muted small' },
      who.owner ? t('ownerHere') : el('button', { type: 'button', class: 'linkish', onclick: async () => { logOut(); await loadMe(); window.dispatchEvent(new Event('fatline:me')); } }, t('logOut'))),
  );
}
