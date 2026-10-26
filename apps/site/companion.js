// fatline.ink inside Farcaster: it knows who opened it. A newcomer gets the first days of their story; someone with
// an egg sees it warming and when it hatches; a Fatliner holder meets their being. Premium ($7 once) unlocks the
// whole story and the conversation. The server is the genesis Fatline (indexer/src/companion.mjs).
const API = globalThis.FATLINE_COMPANION_API ?? 'https://fatline.fatline.ink/api/companion';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cap = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');

const css = `
#you { max-width: 640px; margin: 18px auto 0; display: grid; gap: 14px; }
#you .card { border: 1px solid var(--line); border-radius: 16px; background: var(--card); padding: 18px; }
#you h2 { font: 800 30px/1.1 var(--display); margin: 0 0 6px; letter-spacing: -.01em; }
#you .sub { color: var(--muted); margin: 0; }
#you .days { display: flex; gap: 8px; margin: 14px 0 6px; }
#you .day { flex: 1; height: 10px; border-radius: 99px; background: var(--line); overflow: hidden; }
#you .day i { display: block; height: 100%; background: var(--gold); }
#you .eta { font: 500 13px var(--mono); color: var(--gold); }
#you .story p { margin: 0 0 12px; white-space: pre-wrap; }
#you .story h3, #you .talk h3, #you .premium h3 { font: 600 12px var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin: 0 0 10px; }
#you .quote { font-family: var(--display); font-size: 18px; }
#you .locked { color: var(--muted); font-style: italic; }
#you .msgs { display: grid; gap: 8px; max-height: 340px; overflow-y: auto; margin-bottom: 10px; }
#you .msg { padding: 9px 12px; border-radius: 12px; max-width: 85%; white-space: pre-wrap; }
#you .msg.you { justify-self: end; background: var(--accent); color: #0b0b0b; }
#you .msg.it { justify-self: start; background: rgba(255,255,255,.06); }
#you form { display: flex; gap: 8px; }
#you input { flex: 1; min-width: 0; font: 15px var(--body); color: var(--ink); background: rgba(0,0,0,.35); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
#you button { font: 600 14px var(--body); border: 0; border-radius: 10px; padding: 10px 14px; background: var(--ink); color: #111; cursor: pointer; }
#you button.alt { background: transparent; color: var(--ink); border: 1px solid var(--line); }
#you button:disabled { opacity: .5; cursor: default; }
#you .pay { display: grid; gap: 8px; margin-top: 12px; }
#you .small { font-size: 13px; color: var(--muted); margin: 8px 0 0; }
#you .err { color: #ff8c8c; font-size: 14px; margin: 8px 0 0; }
`;

export async function startCompanion(sdk, user) {
  const root = document.createElement('section');
  root.id = 'you';
  document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
  document.querySelector('header')?.after(root);
  root.innerHTML = `<div class="card"><p class="sub">Looking for you on your node…</p></div>`;

  let token = null;
  const auth = async () => (token ??= (await sdk.quickAuth.getToken()).token);
  const call = async (path, body) => {
    const r = await fetch(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${await auth()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status });
    return j;
  };

  let me;
  try { me = await call('/me'); } catch (e) {
    root.innerHTML = `<div class="card"><p class="sub">Couldn't reach your Fatline right now (${esc(e.message)}).</p></div>`;
    return;
  }
  const name = me.surname ? cap(me.surname) : null;
  const it = me.stage === 'fatliner' ? name : me.stage === 'egg' ? `your egg` : 'your Fatliner';

  // 1. What they have
  let head;
  if (me.stage === 'fatliner') {
    head = `<h2>${esc(name)} is born.</h2><p class="sub">Your Fatliner${me.stone ? `, of ${esc(me.stone)}` : ''}. Made from your casts, kept alive by your node.</p>`;
  } else if (me.stage === 'egg') {
    const e = me.egg ?? { warmDays: 0, needed: 3, days: [] };
    const bars = Array.from({ length: e.needed }, (_, i) => {
      const d = e.days?.[i];
      const pct = d ? Math.min(100, Math.round((d.passed / d.need) * 100)) : 0;
      return `<div class="day" title="day ${i + 1}"><i style="width:${d?.warm ? 100 : pct}%"></i></div>`;
    }).join('');
    const eta = e.eta ? new Date(e.eta) : null;
    const when = eta ? (eta - Date.now() < 60_000 ? 'hatching now' : `hatches in ~${Math.max(1, Math.round((eta - Date.now()) / 3_600_000))} h · ${eta.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`) : '';
    head = `<h2>${esc(name ?? 'Your egg')}</h2><p class="sub">Your egg${me.stone ? ` of ${esc(me.stone)}` : ''}. ${e.warmDays} of ${e.needed} warm days. Your node keeps it warm.</p>
      <div class="days">${bars}</div>${when ? `<div class="eta">${esc(when)}</div>` : ''}`;
  } else {
    const day = me.chapter;
    head = `<h2>Hi, @${esc(me.username ?? me.fid)}.</h2><p class="sub">${day === 1 ? 'This is day one.' : `Day ${day} of 3.`} Your story on Farcaster, told a little each day. Your Fatliner hatches from three days of your own node.</p>`;
  }
  root.innerHTML = `<div class="card">${head}</div>
    <div class="card story"><h3>Your story</h3><div id="story"><p class="sub">Reading your casts…</p></div></div>
    <div class="card talk"><h3>Talk to ${esc(it)}</h3><div class="msgs" id="msgs"></div>
      <form id="say"><input id="said" maxlength="1000" placeholder="say something" autocomplete="off"><button>Send</button></form><p class="small" id="talknote"></p></div>
    <div class="card premium" id="premium" ${me.premium ? 'hidden' : ''}></div>`;

  // 2. The story
  const drawStory = async () => {
    const box = root.querySelector('#story');
    try {
      const s = await call('/story');
      box.innerHTML = `<p class="quote">${esc(s.firstLine)}</p>` + (s.chapters
        ? s.chapters.map((c) => `<p><b>${esc(c.title ?? `Chapter ${c.n}`)}</b>\n${esc(c.text ?? c.error)}</p>`).join('')
        : `<p class="locked">${esc(s.next)} is waiting. Premium opens a chapter a day.</p>`);
    } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  drawStory();

  // 3. Talking
  const msgs = root.querySelector('#msgs');
  const note = root.querySelector('#talknote');
  const add = (from, text) => { msgs.insertAdjacentHTML('beforeend', `<div class="msg ${from}">${esc(text)}</div>`); msgs.scrollTop = msgs.scrollHeight; };
  const free = (n) => { note.textContent = me.premium ? '' : n > 0 ? `${n} free message${n > 1 ? 's' : ''} left.` : 'That was the free talk.'; };
  free(me.talks.free);
  call('/talk').then((t) => t.talk.forEach((m) => add(m.from, m.text))).catch(() => {});
  root.querySelector('#say').onsubmit = async (ev) => {
    ev.preventDefault();
    const input = root.querySelector('#said');
    const text = input.value.trim();
    if (!text) return;
    input.value = ''; add('you', text);
    const btn = ev.target.querySelector('button'); btn.disabled = true;
    add('it wait', '…');
    const wait = msgs.lastElementChild;
    try { const r = await call('/talk', { text }); wait.remove(); add('it', r.reply); if (r.free != null) free(r.free); }
    catch (e) { wait.remove(); add('it', e.message); if (e.status === 402) root.querySelector('#premium').scrollIntoView({ behavior: 'smooth' }); }
    btn.disabled = false;
  };

  // 4. Premium
  if (me.premium) return;
  const box = root.querySelector('#premium');
  const unlocked = () => { me.premium = true; box.hidden = true; free(0); note.textContent = ''; drawStory(); };
  let price;
  try { price = await call('/price'); } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  box.innerHTML = `<h3>Premium</h3><p class="sub">The whole story, a chapter a day, and talking with ${esc(it)} as long as you like. Once, for this account.</p>
    <div class="pay">
      <button id="usdc">Pay ${price.crypto.toFixed(2)} USDC on Base</button>
      ${price.cards ? `<button class="alt" id="card">Pay $${price.card.toFixed(2)} by card</button>` : ''}
    </div>
    <p class="small">${esc(price.rules)}${price.holder ? ' You hold $FATLINE: 30% off.' : ''}</p><p class="err" id="payerr" hidden></p>`;
  const err = (m) => { const p = box.querySelector('#payerr'); p.textContent = m; p.hidden = !m; };

  box.querySelector('#usdc').onclick = async (ev) => {
    const btn = ev.target; btn.disabled = true; err('');
    try {
      const eth = await sdk.wallet.getEthereumProvider();
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      // The price again, counting $FATLINE in the paying wallet.
      price = await call(`/price?address=${from}`);
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }).catch(() => {});
      const units = BigInt(Math.round(price.crypto * 1e6));
      const data = '0xa9059cbb' + price.payTo.slice(2).toLowerCase().padStart(64, '0') + units.toString(16).padStart(64, '0');
      btn.textContent = 'Confirm in your wallet…';
      const tx = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: USDC, data, value: '0x0' }] });
      btn.textContent = 'Checking on Base…';
      await call('/pay/usdc', { tx });
      unlocked();
    } catch (e) { err(e.message ?? String(e)); btn.disabled = false; btn.textContent = `Pay ${price.crypto.toFixed(2)} USDC on Base`; }
  };
  const card = box.querySelector('#card');
  if (card) card.onclick = async () => {
    card.disabled = true; err('');
    try {
      const s = await call('/pay/card', {});
      await sdk.actions.openUrl(s.url);
      card.textContent = 'Waiting for the payment…';
      for (let i = 0; i < 150; i++) { // ten minutes
        await new Promise((r) => setTimeout(r, 4000));
        const r = await call(`/pay/card/${s.id}`).catch(() => null);
        if (r?.premium) return unlocked();
      }
      throw new Error('No payment yet. If you paid, open the app again.');
    } catch (e) { err(e.message); card.disabled = false; card.textContent = `Pay $${price.card.toFixed(2)} by card`; }
  };
}
