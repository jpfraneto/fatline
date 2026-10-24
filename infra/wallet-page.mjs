// The page a wallet connection opens in the browser: the Fatliners around, the QR code in the middle, and what is
// happening now ("Waiting for your wallet…", "Approve on your phone…"). Served on 127.0.0.1 only, for as long as
// the connection is open. Used when paying for a node, launching a coin, and logging in to the client.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { qrSvg } from '../indexer/src/qr.mjs';

const FATLINERS = ['pfp/fid-3.jpg', 'pfp/fid-18350.jpg', 'pfp/fid-299673.jpg', 'world/aster.jpg', 'pfp/fid-509202.jpg', 'pfp/fid-1721477.jpg']
  .map((p) => `https://fatline.ink/img/${p}`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function walletPageHtml({ uri, title, detail, tx, steps }) {
  const ring = FATLINERS.map((src, i) => `<img class="f f${i}" src="${src}" alt="">`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fatline · ${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,400..900,0..100,0..1&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
:root{--bg:#140d07;--ink:#f6ecd7;--muted:#d6bf95;--card:#fbf6ea;--cardInk:#2b1d10;--blue:#3d8bff;--pink:#ff5fa8}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{min-height:100vh;display:grid;place-items:center;overflow-x:hidden;color:var(--ink);font:16px/1.5 system-ui,sans-serif;
 background:radial-gradient(1100px 700px at 50% 40%,#4a3018 0%,#24170c 55%,var(--bg) 100%)}
.stage{position:relative;width:min(1100px,100vw);min-height:100vh;display:grid;place-items:center;padding:24px 16px}
.f{position:absolute;width:clamp(96px,15vw,190px);aspect-ratio:3/4;object-fit:cover;border-radius:999px 999px 18px 18px;
 box-shadow:0 0 0 3px rgba(246,236,215,.16),0 18px 60px rgba(0,0,0,.55),0 -6px 40px rgba(255,170,80,.18);opacity:.95;animation:float 7s ease-in-out infinite}
.f0{left:3%;top:8%}.f1{left:6%;bottom:6%;animation-delay:-2s}.f2{right:4%;top:6%;animation-delay:-4s}
.f3{right:7%;bottom:5%;animation-delay:-1s}.f4{left:22%;top:-4%;width:clamp(70px,10vw,120px);animation-delay:-3s}.f5{right:23%;bottom:-6%;width:clamp(70px,10vw,120px);animation-delay:-5s}
@keyframes float{50%{transform:translateY(-10px)}}
@media (prefers-reduced-motion:reduce){.f{animation:none}}
@media (max-width:700px){.f4,.f5{display:none}.f{opacity:.45}}
.card{position:relative;z-index:2;width:min(420px,92vw);background:var(--card);color:var(--cardInk);border-radius:28px;padding:26px 26px 22px;text-align:center;
 box-shadow:0 30px 90px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.4) inset}
.mark{font:500 13px 'JetBrains Mono',monospace;letter-spacing:.42em;color:#8a6b44}
h1{font:800 34px/1.05 Fraunces,Georgia,serif;font-variation-settings:'opsz' 144,'SOFT' 100,'WONK' 1;margin:8px 0 4px;letter-spacing:-.01em}
.line{height:4px;width:140px;margin:10px auto 16px;border-radius:4px;background:linear-gradient(90deg,var(--blue),#fff 50%,var(--pink));box-shadow:0 0 12px var(--pink)}
.qr{border-radius:16px;overflow:hidden;box-shadow:0 0 0 1px rgba(43,29,16,.12)}
p{margin:12px 0 0;color:#5b4630}
.status{margin-top:14px;font:500 14px 'JetBrains Mono',monospace;color:#2b1d10;background:#efe2c6;border-radius:999px;padding:8px 14px;display:inline-block}
.status.done{background:#cfe9d4}
.tx{margin-top:12px;text-align:left;background:#efe2c6;border-radius:14px;padding:10px 14px;font-size:14px;color:#2b1d10}
.tx code{font:600 14px 'JetBrains Mono',monospace}.tx a{color:#7a3fbf}.txl{font:500 11px 'JetBrains Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#8a6b44}.txn{font-size:12px;color:#8a6b44;margin-top:2px}
.steps{list-style:none;margin:14px 0 0;padding:0;text-align:left;font-size:14px;border:1px solid rgba(43,29,16,.14);border-radius:14px;overflow:hidden}
.steps li{display:grid;grid-template-columns:auto 1fr auto auto;gap:10px;align-items:center;padding:9px 12px;border-top:1px solid rgba(43,29,16,.1)}
.steps li:first-child{border-top:0}.steps .n{font:500 11px 'JetBrains Mono',monospace;color:#8a6b44;white-space:nowrap}
.steps .a{font:600 14px 'JetBrains Mono',monospace;white-space:nowrap}.steps .st{font:500 11px 'JetBrains Mono',monospace;color:#8a6b44;text-transform:uppercase;letter-spacing:.08em}
.steps li.now{background:#fff1c9}.steps li.now .st{color:#a8661a}.steps li.paid .st{color:#2f7a4a}.steps li.total{background:#efe2c6;font-weight:600}
.uri{margin-top:12px;font:12px 'JetBrains Mono',monospace;color:#8a6b44;word-break:break-all;max-height:3.2em;overflow:hidden}
</style></head><body><div class="stage">${ring}
<main class="card"><div class="mark">FATLINE</div><h1>${esc(title)}</h1><div class="line"></div>
<div class="qr">${qrSvg(uri)}</div>
<p>${esc(detail)}</p>
${tx ? `<div class="tx"><div class="txl">The transaction</div><code>${esc(tx.fn)}</code> on <a href="https://basescan.org/address/${esc(tx.contract)}#code" target="_blank" rel="noopener">${esc(tx.contract.slice(0, 8))}…${esc(tx.contract.slice(-6))}</a>${tx.name ? ` (${esc(tx.name)})` : ''}<div class="txn">Base · read its code on Basescan before you approve</div></div>` : ''}
${steps?.length ? `<ol class="steps" id="steps">${steps.map((s, i) => `<li data-i="${i}"><span class="n">${i + 1} of ${steps.length}</span><span class="l">${esc(s.label)}</span><span class="a">${esc(s.amount)} USDC</span><span class="st">waiting</span></li>`).join('')}<li class="total"><span class="n"></span><span class="l">Total, in ${steps.length} approval${steps.length === 1 ? '' : 's'} in your wallet</span><span class="a">${esc(steps.reduce((a, s) => a + Number(s.amount), 0).toFixed(2))} USDC</span><span class="st"></span></li></ol>` : ''}
<div class="status" id="status">Waiting for your wallet…</div>
<div class="uri">${esc(uri)}</div></main></div>
<script>
const s=document.getElementById('status');
(async function poll(){try{const r=await fetch('/status');const j=await r.json();s.textContent=j.text;s.classList.toggle('done',!!j.done);
(j.steps||[]).forEach((st,i)=>{const li=document.querySelector('#steps li[data-i="'+i+'"]');if(!li)return;li.className=st;li.querySelector('.st').textContent=st==='now'?'approve now':st;});
if(j.closed)return;}catch(e){return}setTimeout(poll,1000)})();
</script></body></html>`;
}

/** Serves the page and opens it. Returns { url, status(text, done), close }. */
export async function openWalletPage({ uri, title = 'Scan with your wallet', detail = 'Open your wallet app (Rainbow, MetaMask, Coinbase Wallet, Trust…), scan this, and approve. Nothing moves until you do.', tx = null, steps = null, open = true }) {
  let state = { text: 'Waiting for your wallet…', done: false, closed: false, steps: (steps ?? []).map(() => 'waiting') };
  const html = walletPageHtml({ uri, title, detail, tx, steps });
  const server = createServer((req, res) => {
    if (req.url === '/status') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(JSON.stringify(state)); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  if (open && !process.env.FATLINE_NO_BROWSER) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).on('error', () => {}).unref();
  }
  return {
    url,
    status(text, done = false) { state = { ...state, text, done }; },
    /** Marks payment i: 'now' (approve it), 'paid' or 'failed'. */
    step(i, st) { const s = [...state.steps]; s[i] = st; state = { ...state, steps: s }; },
    close() { state = { ...state, closed: true }; setTimeout(() => server.close(), 2500).unref(); },
  };
}
