// The life force: what flows through your own node right now, drawn as electricity moving into your egg.
// Every block your node takes in is one spark that travels a thread into the egg (cyan Snapchain, pink
// Hypersnap). While it catches up it beats faster; in sync, about once a second per shard; dead, it goes dark.
// Data: GET /api/lifeforce every 5 s. Drawing: one canvas, requestAnimationFrame, nothing else.
import { api } from './lib.js';

const COLORS = { farcaster: [61, 139, 255], hypersnap: [255, 95, 168] };
const MAX_SPARKS_PER_S = 14; // a node catching up can take in hundreds of blocks a second; the eye can't

export function lifeForce(stage, readout) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ck-lf';
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let lf = null; // the latest sample
  let threads = [];
  let sparks = [];
  let glow = 0; // the egg's flash, decays
  let debt = 0; // fractional sparks owed
  let last = performance.now();
  let raf = 0, poll = 0, stopped = false;

  const size = () => {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    canvas.style.width = `${r.width}px`; canvas.style.height = `${r.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    makeThreads(r.width, r.height);
  };

  // Threads come in from all around, bend like roots, and end at the egg's rim.
  function makeThreads(w, h) {
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.34, out = Math.max(w, h) * 0.62;
    threads = Array.from({ length: 11 }, (_, i) => {
      const a = (i / 11) * Math.PI * 2 + (i % 2 ? 0.17 : -0.11);
      const end = { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R };
      const start = { x: cx + Math.cos(a) * out, y: cy + Math.sin(a) * out };
      const bend = (i % 3 - 1) * 0.5;
      const mid = (t) => ({ x: cx + Math.cos(a + bend * t) * (out - (out - R) * t), y: cy + Math.sin(a + bend * t) * (out - (out - R) * t) });
      return { start, c1: mid(0.35), c2: mid(0.7), end };
    });
  }

  const at = (th, t) => {
    const u = 1 - t;
    return {
      x: u * u * u * th.start.x + 3 * u * u * t * th.c1.x + 3 * u * t * t * th.c2.x + t * t * t * th.end.x,
      y: u * u * u * th.start.y + 3 * u * u * t * th.c1.y + 3 * u * t * t * th.c2.y + t * t * t * th.end.y,
    };
  };

  function frame(now) {
    if (stopped) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const alive = lf?.alive;
    const rgb = COLORS[lf?.network] ?? COLORS.farcaster;

    // The threads: faint when idle, brighter with the current, grey when dead.
    const level = alive ? Math.min(1, 0.25 + sparks.length / 18) : 0.08;
    for (const th of threads) {
      ctx.beginPath(); ctx.moveTo(th.start.x, th.start.y);
      ctx.bezierCurveTo(th.c1.x, th.c1.y, th.c2.x, th.c2.y, th.end.x, th.end.y);
      ctx.strokeStyle = alive ? `rgba(${rgb.join(',')},${0.12 + level * 0.18})` : 'rgba(140,140,150,.12)';
      ctx.lineWidth = 1.2; ctx.stroke();
    }

    // New sparks: one per block, capped for the eye.
    if (alive && !reduce) {
      debt += Math.min(MAX_SPARKS_PER_S, Math.max(0, lf.blocksPerSecond ?? 0)) * dt;
      while (debt >= 1) {
        debt -= 1;
        const pink = lf.network === 'hypersnap' ? 0.85 : 0.15; // mostly its own colour, a little of the other
        sparks.push({ th: threads[(Math.random() * threads.length) | 0], t: 0, v: 0.55 + Math.random() * 0.5, c: Math.random() < pink ? COLORS.hypersnap : COLORS.farcaster });
      }
    }

    // Move them; each one that reaches the egg makes it flash.
    for (const s of sparks) {
      s.t += s.v * dt;
      const p = at(s.th, Math.min(1, s.t));
      const tail = at(s.th, Math.max(0, s.t - 0.09));
      const g = ctx.createLinearGradient(tail.x, tail.y, p.x, p.y);
      g.addColorStop(0, `rgba(${s.c.join(',')},0)`); g.addColorStop(1, `rgba(${s.c.join(',')},.95)`);
      ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = g; ctx.lineWidth = 2.4; ctx.shadowColor = `rgb(${s.c.join(',')})`; ctx.shadowBlur = 12; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.shadowBlur = 0;
      if (s.t >= 1) glow = Math.min(1, glow + 0.22);
    }
    sparks = sparks.filter((s) => s.t < 1);
    glow *= Math.pow(0.12, dt);
    stage.style.setProperty('--lf', alive ? (0.25 + glow * 0.75).toFixed(3) : '0');
    stage.classList.toggle('dark', lf ? !alive : false);
    raf = requestAnimationFrame(frame);
  }

  const words = (x) => {
    if (!x) return 'Listening for your node…';
    if (!x.alive) return `No life force: ${x.label ?? 'your node'} isn't answering${x.error ? ` (${x.error})` : ''}. If it stops for long, the egg dies.`;
    const beat = `${(x.blocksPerSecond ?? 0).toFixed(1)} blocks a second`;
    const net = x.network === 'hypersnap' ? 'Hypersnap' : 'Snapchain';
    if ((x.behindSeconds ?? 0) > 200) {
      const left = x.catchUpRate > 0 ? x.behindSeconds / x.catchUpRate : null;
      const eta = left == null ? 'Measuring how long until it is fully awake' : left < 5400 ? `Fully awake in about ${Math.max(1, Math.round(left / 60))} min` : `Fully awake in about ${Math.round(left / 3600)} h`;
      return `Life force rising: your ${net} node takes in ${beat} as it catches up. ${eta}.`;
    }
    return `Life force: ${beat} from your own ${net} node, flowing into your egg.`;
  };

  const refresh = async () => {
    try {
      const x = await api('/api/lifeforce');
      lf = x ? { ...x, network: x.network ?? (/4381/.test(x.node ?? '') ? 'hypersnap' : 'farcaster') } : null;
    } catch { lf = lf ? { ...lf, alive: false, error: 'this server did not answer' } : null; }
    readout.textContent = words(lf);
    poll = setTimeout(refresh, 5000);
  };

  const ro = new ResizeObserver(size);
  ro.observe(stage);
  size();
  refresh();
  raf = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(raf); clearTimeout(poll); ro.disconnect(); };
}
