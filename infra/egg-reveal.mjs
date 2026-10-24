// The moment after a mint: a page that tells what just happened. Your history (your own casts) drifts in from the
// edges and is pulled into the light; the egg wakes out of it, wobbling, with the network's current running into it;
// then its name, its stone, the token and the transaction. Saved as .fatline/egg-<fid>.html: fatline egg show reopens it.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Recent casts of `fid`, plain text, from a node. */
export async function castsOf(nodeUrl, fid, n = 14) {
  const r = await fetch(`${nodeUrl}/v1/castsByFid?fid=${fid}&reverse=true&pageSize=40`, { signal: AbortSignal.timeout(10_000) }).then((x) => x.json()).catch(() => null);
  return (r?.messages ?? []).map((m) => m.data?.castAddBody?.text?.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length > 8).slice(0, n);
}

export function revealHtml(d) {
  const casts = JSON.stringify((d.casts ?? []).map((t) => (t.length > 110 ? `${t.slice(0, 107)}…` : t)));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.name)} · your egg</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,400..900,0..100,0..1&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
:root{--bg:#0d0905;--ink:#f6ecd7;--muted:#cdb68e;--blue:#3d8bff;--pink:#ff5fa8;--gold:#ffc65c}
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
#sky{position:fixed;inset:0;background:radial-gradient(900px 700px at 50% 45%,#3a2512 0%,#1a110a 55%,var(--bg) 100%);transition:background 3s}
body.awake #sky{background:radial-gradient(900px 700px at 50% 45%,#5a3a16 0%,#24170c 55%,var(--bg) 100%)}
canvas{position:fixed;inset:0;width:100%;height:100%}
.cast{position:fixed;max-width:min(320px,70vw);padding:10px 14px;border-radius:14px;background:rgba(246,236,215,.08);border:1px solid rgba(246,236,215,.18);
 font:15px/1.35 system-ui,sans-serif;color:var(--ink);backdrop-filter:blur(2px);box-shadow:0 0 30px rgba(255,198,92,.12);opacity:0;pointer-events:none;
 transition:transform 2.6s cubic-bezier(.6,0,.2,1),opacity .6s,filter 2.6s}
.cast.in{opacity:1}.cast.go{transform:translate(var(--dx),var(--dy)) scale(.05) rotate(var(--r));opacity:0;filter:blur(6px)}
#egg{position:fixed;left:50%;top:44%;width:min(46vh,70vw);aspect-ratio:1;transform:translate(-50%,-50%) scale(0);border-radius:50%;overflow:hidden;
 box-shadow:0 0 0 3px rgba(255,198,92,.35),0 0 80px 20px rgba(255,170,60,.35),0 0 200px 60px rgba(255,95,168,.12)}
#egg img{width:100%;height:100%;object-fit:cover;display:block}
#egg.wob{transform:translate(-50%,-50%) scale(1);animation:wobble 3.2s ease-in-out infinite}
@keyframes wobble{0%,100%{transform:translate(-50%,-50%) scale(1) rotate(0)}20%{transform:translate(-50%,-50%) scale(1.02) rotate(-3deg)}40%{transform:translate(-50%,-50%) scale(.99) rotate(2.5deg)}60%{transform:translate(-50%,-50%) scale(1.015) rotate(-1.5deg)}80%{transform:translate(-50%,-50%) scale(1) rotate(1deg)}}
#core{position:fixed;left:50%;top:44%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#fff;box-shadow:0 0 30px 12px var(--gold),0 0 80px 30px rgba(255,95,168,.5);
 transform:scale(.4);transition:transform .4s}
body.egg #core{transform:scale(0);transition:transform 1.5s}
#line{position:fixed;left:0;right:0;top:12%;text-align:center;font:700 clamp(26px,4.6vw,48px)/1.1 Fraunces,Georgia,serif;font-variation-settings:'opsz' 144,'SOFT' 100,'WONK' 1;
 opacity:0;transition:opacity 1s;text-shadow:0 0 40px rgba(255,170,60,.4);padding:0 16px}
#line.on{opacity:1}
#card{position:fixed;left:50%;bottom:4%;transform:translate(-50%,30px);width:min(560px,92vw);text-align:center;opacity:0;transition:opacity 1.2s,transform 1.2s}
body.named #card{opacity:1;transform:translate(-50%,0)}
.name{font:800 clamp(34px,6vw,64px)/1 Fraunces,Georgia,serif;font-variation-settings:'opsz' 144,'SOFT' 100,'WONK' 1;letter-spacing:-.01em}
.tick{font:500 14px 'JetBrains Mono',monospace;letter-spacing:.3em;color:var(--gold);margin-top:6px}
.rules{color:var(--muted);margin:12px auto 0;max-width:46ch}
.row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px}
.row a{font:500 13px 'JetBrains Mono',monospace;color:var(--ink);text-decoration:none;border:1px solid rgba(246,236,215,.25);border-radius:999px;padding:8px 14px}
.row a.main{background:var(--ink);color:#1a110a;border-color:var(--ink)}
#again{position:fixed;right:16px;top:14px;font:500 12px 'JetBrains Mono',monospace;color:var(--muted);background:none;border:0;cursor:pointer;opacity:0;transition:opacity 1s}
body.named #again{opacity:1}
@media (prefers-reduced-motion:reduce){.cast,#egg,#line,#card{transition:none!important;animation:none!important}}
</style></head><body>
<div id="sky"></div><canvas id="c"></canvas><div id="core"></div>
<div id="egg"><img src="${esc(d.image)}" alt="${esc(d.name)}'s egg, ${esc(d.stoneName)}"></div>
<div id="line"></div>
<div id="card"><div class="name">${esc(d.name)}</div><div class="tick">$${esc(d.surname)} · ${esc(d.stoneName.toUpperCase())} · #${esc(d.fid)}</div>
<p class="rules">An egg, in your wallet${d.holder ? ` (${esc(d.holder.slice(0, 6))}…${esc(d.holder.slice(-4))})` : ''}. Your node keeps it warm: three warm days and it hatches. If the node stops, it dies.</p>
<div class="row"><a class="main" href="http://localhost:8787/">Open your Fatline</a>${d.tx ? `<a href="https://basescan.org/tx/${esc(d.tx)}" target="_blank" rel="noopener">The transaction ↗</a>` : ''}<a href="https://basescan.org/token/${esc(d.contract)}?a=${esc(d.fid)}" target="_blank" rel="noopener">Token #${esc(d.fid)} ↗</a></div></div>
<button id="again" type="button">see it again</button>
<script>
const CASTS = ${casts};
const WHO = ${JSON.stringify(d.who ?? 'you')};
const c = document.getElementById('c'), x = c.getContext('2d');
let W, H, sparks = [], current = 0;
const size = () => { W = c.width = innerWidth * devicePixelRatio; H = c.height = innerHeight * devicePixelRatio; };
size(); addEventListener('resize', size);
const center = () => [W / 2, H * 0.44];
function spark(x0, y0, hue) { const [cx, cy] = center(); sparks.push({ x: x0, y: y0, cx, cy, t: 0, hue, life: 60 + Math.random() * 40 }); }
function draw() {
  x.clearRect(0, 0, W, H);
  // the current: threads from the edges into the egg, brighter as it wakes
  const [cx, cy] = center();
  if (current > 0) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + performance.now() / 9000, r = Math.max(W, H) * 0.7;
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      for (let k = 1; k <= 12; k++) { const f = k / 12, j = (Math.random() - .5) * 26 * devicePixelRatio * (1 - f);
        x.lineTo(cx + Math.cos(a) * r * (1 - f) + j, cy + Math.sin(a) * r * (1 - f) + j); }
      x.strokeStyle = i % 2 ? 'rgba(61,139,255,' + (0.10 * current) + ')' : 'rgba(255,95,168,' + (0.10 * current) + ')';
      x.lineWidth = 1.4 * devicePixelRatio; x.stroke();
    }
    if (Math.random() < 0.35 * current) { const a = Math.random() * Math.PI * 2, r = Math.max(W, H) * 0.6; spark(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.random() < .5 ? 215 : 330); }
  }
  sparks = sparks.filter((s) => s.t < s.life);
  for (const s of sparks) { s.t++; const f = s.t / s.life, e = f * f; const px = s.x + (s.cx - s.x) * e, py = s.y + (s.cy - s.y) * e;
    x.beginPath(); x.arc(px, py, (2.6 - 2 * f) * devicePixelRatio, 0, 7); x.fillStyle = 'hsla(' + s.hue + ',100%,70%,' + (1 - f * .6) + ')'; x.shadowBlur = 16; x.shadowColor = 'hsl(' + s.hue + ',100%,60%)'; x.fill(); }
  x.shadowBlur = 0; requestAnimationFrame(draw);
}
draw();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const say = async (t, ms = 2200) => { const l = document.getElementById('line'); l.classList.remove('on'); await wait(500); l.textContent = t; l.classList.add('on'); await wait(ms); };
async function run() {
  document.body.className = ''; current = 0;
  await say('You just signed something.', 1800);
  await say('This is ' + WHO + ', as Farcaster remembers.', 1200);
  // the history drifts in and is pulled into the light
  const list = CASTS.length ? CASTS : ['(a quiet history)'];
  for (let i = 0; i < list.length; i++) {
    const el = document.createElement('div'); el.className = 'cast'; el.textContent = list[i];
    const a = Math.random() * Math.PI * 2, rx = innerWidth * 0.36, ry = innerHeight * 0.32;
    const left = innerWidth / 2 + Math.cos(a) * rx - 140, top = innerHeight * 0.44 + Math.sin(a) * ry - 30;
    el.style.left = Math.max(12, Math.min(innerWidth - 300, left)) + 'px'; el.style.top = Math.max(70, Math.min(innerHeight - 90, top)) + 'px';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { const r = el.getBoundingClientRect(); el.style.setProperty('--dx', (innerWidth / 2 - r.left - r.width / 2) + 'px'); el.style.setProperty('--dy', (innerHeight * .44 - r.top - r.height / 2) + 'px'); el.style.setProperty('--r', (Math.random() * 40 - 20) + 'deg'); el.classList.add('go');
      for (let k = 0; k < 6; k++) spark((r.left + r.width / 2) * devicePixelRatio, (r.top + r.height / 2) * devicePixelRatio, 40); }, 1400);
    setTimeout(() => el.remove(), 4500);
    current = Math.min(1, (i + 1) / list.length);
    await wait(i < 3 ? 900 : 480);
  }
  await say('Every word becomes warmth.', 1600);
  document.body.classList.add('egg', 'awake'); current = 1;
  const egg = document.getElementById('egg');
  egg.classList.remove('wob');
  egg.animate([{ transform: 'translate(-50%,-50%) scale(0) rotate(-20deg)' }, { transform: 'translate(-50%,-50%) scale(1.12) rotate(6deg)', offset: .7 }, { transform: 'translate(-50%,-50%) scale(1) rotate(0)' }],
    { duration: 2200, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'forwards' }).finished.then(() => egg.classList.add('wob'));
  await say('Something is alive in there.', 2600);
  await say('It runs on your node now.', 2000);
  document.getElementById('line').classList.remove('on');
  document.body.classList.add('named');
}
document.getElementById('again').onclick = () => { document.querySelectorAll('.cast').forEach((e) => e.remove()); const egg = document.getElementById('egg'); egg.getAnimations().forEach((a) => a.cancel()); egg.classList.remove('wob'); run(); };
if (location.hash === '#end') { document.body.classList.add('egg', 'awake', 'named'); current = 1; document.getElementById('egg').classList.add('wob'); } else run();
</script></body></html>`;
}

/** Writes the page and opens it in the browser. */
export function openReveal(file, d) {
  writeFileSync(file, revealHtml(d));
  if (process.env.FATLINE_NO_BROWSER) return file;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [file], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).on('error', () => {}).unref();
  return file;
}
