// New things never move what you are reading. They wait behind a pill at the top, and come in when you tap it or
// scroll back to the top yourself. At the top already, they come in at once.
import { el } from './lib.js';

const TOP = 40;
const atTop = () => scrollY < TOP;

/**
 * home: an element of the page (the pill lives in it, so it goes when the page goes). offer(n, apply, label?):
 * n new things; apply() puts them in. A later offer replaces the earlier one (apply should include everything).
 */
export function newPill(home) {
  let pending = null;
  const pill = el('button', { type: 'button', class: 'new-pill', hidden: true });
  home.prepend(pill);
  const take = () => {
    if (!pending) return;
    const apply = pending;
    pending = null;
    pill.hidden = true;
    apply();
  };
  const onScroll = () => {
    if (!pill.isConnected) { removeEventListener('scroll', onScroll); return; }
    if (pending && atTop()) take();
  };
  addEventListener('scroll', onScroll, { passive: true });
  pill.addEventListener('click', () => {
    take();
    scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  return {
    offer(n, apply, label = `↑ ${n} new`) {
      if (!n) return;
      pending = apply;
      if (atTop()) { take(); return; }
      pill.textContent = label;
      // Over the middle of the column the page reads in.
      const r = home.getBoundingClientRect();
      pill.style.left = `${r.left + r.width / 2}px`;
      pill.hidden = false;
    },
  };
}
