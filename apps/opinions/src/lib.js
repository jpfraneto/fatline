import { createPublicClient, createWalletClient, custom, defineChain } from 'viem';
import { base, baseSepolia, foundry } from 'viem/chains';
import { strings } from './i18n.js';

const CHAINS = { 8453: base, 84532: baseSepolia, 31337: foundry };

export const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};

export const state = {
  config: null,
  network: null,
  lang: store.get('lang', navigator.language?.startsWith('es') ? 'es' : 'en'),
  people: store.get('people', []), // [{fid, username}]
};

export const t = (key, ...args) => { const v = strings[state.lang][key]; return typeof v === 'function' ? v(...args) : v; };
export const $ = (sel) => document.querySelector(sel);
export const label = (name) => state.config.networks.find((n) => n.name === name)?.label ?? name;
export const short = (addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
export const usdc = (units) => (Number(units) / 1e6).toLocaleString(state.lang, { maximumFractionDigits: 2 });

export async function api(path, params = {}, body) {
  const url = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

export function showSource(source) {
  const node = $('#source');
  node.textContent = source ? t('reading', source.node.replace(/^https?:\/\//, ''), source.own) : '';
  node.classList.toggle('own', Boolean(source?.own));
  node.hidden = !source;
}

export function timeAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  const rtf = new Intl.RelativeTimeFormat(state.lang, { numeric: 'auto' });
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (s >= size) return rtf.format(-Math.floor(s / size), unit);
  }
  return rtf.format(-s, 'second');
}

export function duration(ms) {
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return state.lang === 'es' ? `${days} días` : `${days} days`;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return state.lang === 'es' ? `${hours} horas` : `${hours} hours`;
}

export const date = (ms) => new Date(ms).toLocaleDateString(state.lang, { year: 'numeric', month: 'short', day: 'numeric' });

/** The browser wallet, switched to the chain this system runs on. */
export async function wallet(chainId) {
  if (!window.ethereum) throw new Error(t('noWallet'));
  const chain = CHAINS[chainId]
    ?? defineChain({ id: chainId, name: 'chain', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [] } } });
  const client = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [account] = await client.requestAddresses();
  if ((await client.getChainId()) !== chain.id) await client.switchChain({ id: chain.id });
  const reader = createPublicClient({ chain, transport: custom(window.ethereum) });
  return { client, reader, account, chain };
}
