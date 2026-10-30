// Keys, on a keyboard: 1 to 5 open the tabs, / looks someone up, ? shows every key. A page may add its own
// (setPageKeys); they are dropped when the page changes. Nothing fires while you are typing.
import { el } from './lib.js';

let page = null; // { keys: { key: fn }, help: [[keys, what], ...] }
let sheet = null;

export function setPageKeys(def) { page = def; }

const typing = (t) => t?.closest?.('input, textarea, select, [contenteditable="true"]');

function help() {
  if (sheet) { sheet.remove(); sheet = null; return; }
  const rows = [...(page?.help ?? []), ['1 – 5', 'Tabs'], ['/', 'Look someone up'], ['?', 'These keys'], ['Esc', 'Close']];
  sheet = el('div', { class: 'keys-sheet', role: 'dialog', 'aria-label': 'Keys', onclick: (e) => { if (e.target === sheet) help(); } },
    el('div', { class: 'keys-card' }, el('p', { class: 'en-kind' }, 'Keys'),
      el('dl', {}, ...rows.flatMap(([k, what]) => [el('dt', {}, ...String(k).split(' ').map((x) => (x === '·' || x === '–' ? ` ${x} ` : el('kbd', {}, x)))), el('dd', {}, what)]))));
  document.body.append(sheet);
}

export function startKeys() {
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || typing(e.target)) return;
    if (e.metaKey || e.ctrlKey) return; // the browser's own
    const k = e.key;
    if (k === 'Escape' && sheet) { help(); e.preventDefault(); return; }
    if (k === '?') { help(); e.preventDefault(); return; }
    if (sheet) return;
    const fn = page?.keys?.[k];
    if (fn) { e.preventDefault(); fn(e); return; }
    if (/^[1-5]$/.test(k)) {
      const tabs = [...document.querySelectorAll('#tabs a')].filter((a) => !a.hidden);
      const a = tabs[Number(k) - 1];
      if (a) { e.preventDefault(); a.click(); }
      return;
    }
    if (k === '/') { e.preventDefault(); location.hash = '#/search'; }
  });
}
