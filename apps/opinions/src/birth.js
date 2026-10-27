// The birth: an egg hatches, then its coin comes into the world. Both from the holder's own wallet (inside Farcaster,
// the Farcaster wallet; in a browser, theirs), both watched as they happen. #/birth/<fid>; #/birth/<fid>/demo plays it
// with no wallet and no transaction, to walk through it.
//
// What it shows comes from /api/birth/<fid> (indexer/src/birth.mjs): the hatch transaction once every node has signed,
// the coin's launch transaction once it has hatched, and the art.
import { $, api, el, short } from './lib.js';
import { ethProvider, openUrl, viewCoin } from './miniapp.js';

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
const cap = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');
const BASE = '0x2105';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- the sky: threads of the network running into the egg, sparks pulled to the centre

function sky(canvas) {
  const x = canvas.getContext('2d');
  let W = 0, H = 0, sparks = [], stop = false;
  const s = { current: 0.3, cx: 0.5, cy: 0.42, gold: 0 };
  const size = () => { W = canvas.width = canvas.clientWidth * devicePixelRatio; H = canvas.height = canvas.clientHeight * devicePixelRatio; };
  size(); addEventListener('resize', size);
  const frame = () => {
    if (stop) return;
    x.clearRect(0, 0, W, H);
    const cx = W * s.cx, cy = H * s.cy, R = Math.max(W, H) * 0.75, dpr = devicePixelRatio;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + performance.now() / 11000;
      x.beginPath(); x.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      for (let k = 1; k <= 14; k++) {
        const f = k / 14, j = (Math.random() - 0.5) * 22 * dpr * (1 - f) * s.current;
        x.lineTo(cx + Math.cos(a) * R * (1 - f) + j, cy + Math.sin(a) * R * (1 - f) + j);
      }
      const hue = s.gold ? `255,198,92` : i % 2 ? '61,139,255' : '255,95,168';
      x.strokeStyle = `rgba(${hue},${0.05 + 0.16 * s.current})`; x.lineWidth = 1.3 * dpr; x.stroke();
    }
    if (Math.random() < 0.5 * s.current) {
      const a = Math.random() * Math.PI * 2;
      sparks.push({ x: cx + Math.cos(a) * R * 0.8, y: cy + Math.sin(a) * R * 0.8, t: 0, life: 50 + Math.random() * 40, hue: s.gold ? 42 : Math.random() < 0.5 ? 215 : 330 });
    }
    sparks = sparks.filter((p) => p.t < p.life);
    for (const p of sparks) {
      p.t++; const f = p.t / p.life, e = f * f;
      x.beginPath(); x.arc(p.x + (cx - p.x) * e, p.y + (cy - p.y) * e, (2.4 - 1.8 * f) * dpr, 0, 7);
      x.fillStyle = `hsla(${p.hue},100%,70%,${1 - f * 0.6})`; x.shadowBlur = 14; x.shadowColor = `hsl(${p.hue},100%,60%)`; x.fill();
    }
    x.shadowBlur = 0;
    requestAnimationFrame(frame);
  };
  if (!reduced()) frame();
  return Object.assign(s, { end: () => { stop = true; } });
}

// ---- holding a button: a ring fills, then it fires. Holding is the choice.

function holdButton(label, onFire) {
  const ring = el('i', { class: 'bt-ring' });
  const b = el('button', { type: 'button', class: 'bt-hold' }, ring, el('span', {}, label));
  let t0 = 0, raf = 0, fired = false;
  const HOLD = reduced() ? 1 : 1100;
  const tick = () => {
    const f = Math.min(1, (performance.now() - t0) / HOLD);
    ring.style.setProperty('--f', f);
    if (f >= 1 && !fired) { fired = true; b.disabled = true; onFire(); return; }
    raf = requestAnimationFrame(tick);
  };
  const down = (e) => { if (fired) return; e.preventDefault(); t0 = performance.now(); tick(); };
  const up = () => { if (fired) return; cancelAnimationFrame(raf); ring.style.setProperty('--f', 0); };
  b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up);
  b.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) down(e); });
  b.addEventListener('keyup', up);
  return b;
}

// ---- the wallet: send one transaction as the holder, on Base, and wait for it

async function send(tx, holder, say) {
  const p = await ethProvider();
  if (!p) throw new Error('No wallet here. Open this inside Farcaster, or in a browser with a wallet.');
  const [from] = await p.request({ method: 'eth_requestAccounts' });
  if (from.toLowerCase() !== holder.toLowerCase()) throw new Error(`This wallet is ${short(from)}. The egg is held by ${short(holder)}: switch to that one.`);
  if ((await p.request({ method: 'eth_chainId' })) !== BASE) await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE }] });
  say('Approve it in your wallet.');
  const hash = await p.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: `0x${BigInt(tx.value ?? 0).toString(16)}` }] });
  say('Base is writing it…');
  for (let i = 0; i < 120; i++) {
    const r = await p.request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null);
    if (r) { if (r.status !== '0x1') throw new Error(`The transaction failed on Base (${short(hash)}).`); return hash; }
    await wait(1500);
  }
  throw new Error(`Still waiting for Base. It may land: ${short(hash)}.`);
}

// A walk-through with nothing sent.
const fake = async (say) => { say('Approve it in your wallet.'); await wait(1600); say('Base is writing it…'); await wait(2600); return `0x${'d3m0'.repeat(16)}`; };

// ---- the page

export async function birthPage(fid, { demo = false } = {}) {
  const main = $('#main');
  main.classList.add('birth-page');
  main.replaceChildren(el('section', { class: 'bt' }, el('p', { class: 'bt-line on' }, '…')));
  let b;
  try { b = await api(`/api/birth/${fid}`); } catch (err) { main.replaceChildren(el('p', { class: 'warn' }, err.message)); return; }
  if (demo) b = demoState(b);

  const canvas = el('canvas', { class: 'bt-sky' });
  const art = el('div', { class: 'bt-art' },
    el('img', { class: 'bt-egg', src: b.art.egg, alt: '' }),
    b.art.being ? el('img', { class: 'bt-being', src: b.art.being, alt: '' }) : null,
    crack(), el('div', { class: 'bt-flash' }));
  const line = el('p', { class: 'bt-line' });
  const name = el('div', { class: 'bt-name' });
  const act = el('div', { class: 'bt-act' });
  const card = el('div', { class: 'bt-card' });
  main.replaceChildren(el('section', { class: 'bt' }, canvas, art, line, name, act, card));
  const s = sky(canvas);
  const say = async (text, ms = 0) => { line.classList.remove('on'); await wait(250); line.textContent = text; line.classList.add('on'); if (ms) await wait(ms); };
  const surname = cap(b.surname);
  const fail = (err, retry) => { s.current = 0.3; say(err.message); act.replaceChildren(el('button', { type: 'button', class: 'bt-again', onclick: retry }, 'Try again')); };

  // 1. The egg, ready to hatch
  async function hatchStep() {
    art.className = 'bt-art egg';
    if (!b.hatch?.ready) {
      // Not ready to hatch: its coin can still come first (an egg has the right to its coin).
      if (b.coin || b.launch) return coinStep();
      const signed = (b.hatch?.attesters ?? []).filter((a) => a.signed).length;
      await say(`${(b.name ?? surname).split(' ')[0]} is warming. ${signed} of ${b.hatch?.threshold ?? '…'} nodes have signed its birth.`);
      return;
    }
    await say(`${(b.name ?? surname).split(' ')[0]} is ready.`);
    act.replaceChildren(holdButton('Hold to hatch', async () => {
      art.classList.add('shake'); s.current = 0.8;
      try {
        await (demo ? fake : (say) => send(b.hatch.tx, b.holder, say))((t) => say(t));
      } catch (err) { art.classList.remove('shake'); return fail(err, hatchStep); }
      act.replaceChildren();
      await hatched();
    }));
  }

  // 2. It hatches: cracks of light, a flash, the being
  async function hatched() {
    s.current = 1;
    art.classList.add('cracking');
    await wait(reduced() ? 0 : 1500);
    art.classList.add('open');
    s.gold = 1; s.current = 0.5;
    name.replaceChildren(el('b', {}, b.name ?? surname), el('small', {}, `$${b.surname} · #${b.fid}`));
    name.classList.add('on');
    await say('Born.', 2200);
    if (!demo) { try { b = await api(`/api/birth/${fid}`); } catch { /* the next step says so */ } } else b = demoState(b, 'fatliner');
    coinStep();
  }

  // 3. Its coin
  async function coinStep() {
    art.className = b.stage === 'egg' ? 'bt-art egg' : 'bt-art open';
    if (!name.firstChild) name.replaceChildren(el('b', {}, b.name ?? surname), el('small', {}, `$${b.surname} · #${b.fid}`));
    name.classList.add('on');
    if (b.coin) return done(b.coin.address, b.coin.vault);
    if (!b.launch) { await say(b.launchError ?? 'Its coin is not ready to launch yet.'); return; }
    await say(`Bring $${b.surname} into the world.`);
    act.replaceChildren(holdButton(`Launch $${b.surname}`, async () => {
      s.current = 0.9; art.classList.add('coining');
      try {
        await (demo ? fake : (say) => send(b.launch, b.holder, say))((t) => say(t));
      } catch (err) { art.classList.remove('coining'); return fail(err, coinStep); }
      act.replaceChildren();
      done(b.launch.coin, b.launch.vault);
    }));
  }

  // 4. The coin exists
  async function done(coin, vault) {
    art.classList.add('coined');
    s.current = 0.25;
    await say(`$${b.surname}`, 400);
    const img = b.images ?? {};
    const link = (text, url) => el('a', { href: url, onclick: (e) => { e.preventDefault(); openUrl(url); } }, text);
    card.replaceChildren(
      el('p', { class: 'bt-rule' }, 'Its trading fees pay for its node, a month ahead.'),
      el('dl', {},
        el('dt', {}, 'Coin'), el('dd', {}, coin ? short(coin) : '…'),
        el('dt', {}, 'Vault'), el('dd', {}, vault ? short(vault) : '…')),
      el('div', { class: 'bt-links' },
        coin && !demo ? el('button', { type: 'button', class: 'bt-main', onclick: () => viewCoin(b.chainId, coin) }, `See $${b.surname}`) : null,
        img.icon ? link('Icon', img.icon) : link('Icon', b.art.being ?? b.art.egg),
        img.banner ? link('Banner 3:1', img.banner) : null,
        img['banner-3x2'] ? link('Banner 3:2', img['banner-3x2']) : null,
        img.launch ? link('Art', img.launch) : null));
    card.classList.add('on');
  }

  if (b.stage === 'egg') hatchStep();
  else if (b.stage === 'fatliner') coinStep();
  else say('No egg here.');
}

function crack() {
  // Lines of light that draw themselves across the shell.
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'bt-crack');
  for (const d of ['M50 12 L46 26 L53 34 L47 47 L55 58', 'M53 34 L64 38 L70 50', 'M47 47 L36 52 L30 64', 'M55 58 L52 72 L58 84', 'M46 26 L36 24']) {
    const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('pathLength', '1'); svg.append(p);
  }
  return svg;
}

/** The demo: the real art and names, with whatever the chain says swapped for the next step. */
function demoState(b, stage = b.stage === 'fatliner' && b.coin ? 'fatliner' : b.stage) {
  const out = { ...b, stage, coin: null };
  if (stage === 'egg') out.hatch = { ready: true, signatures: 2, threshold: 2, attesters: [], tx: {} };
  else out.launch = { ticker: b.surname, coin: '0x000000000000000000000000000000000000c014', vault: b.launch?.vault ?? b.vault ?? null };
  return out;
}
