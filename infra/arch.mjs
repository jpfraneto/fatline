#!/usr/bin/env node
// The Farcaster arch, drawn in the terminal. Played once when ./fatline setup starts.
// Preview it on its own:  node infra/arch.mjs
//
// How it draws: the icon (a purple rounded square with a white arch, 400×400 units) is sampled into a grid
// of "pixels", two per character cell (the ▀ half block: top pixel in the foreground colour, bottom pixel in
// the background colour), with 3×3 supersampling so the edges are smooth. Then it animates:
//   1. the tile opens from the centre,
//   2. the arch rises from the ground, each pixel sparking blue (Snapchain) or pink (Hypersnap) before it settles,
//   3. a shine crosses the tile,
//   4. the name types itself out underneath.
// Any key skips it. FATLINE_NO_ANIMATION=1 or NO_COLOR turns it off; it never runs without a terminal.

const PURPLE_TOP = [143, 104, 216];
const PURPLE_BOTTOM = [118, 82, 196];
const WHITE = [255, 255, 255];
const BLUE = [59, 160, 255]; // Snapchain
const PINK = [255, 111, 181]; // Hypersnap

// ---------------------------------------------------------------- the shape (icon units, 0..400)
const inTile = (x, y) => {
  const r = 88;
  const cx = Math.min(Math.max(x, r), 400 - r);
  const cy = Math.min(Math.max(y, r), 400 - r);
  return x >= 0 && x <= 400 && y >= 0 && y <= 400 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inOpening = (x, y) => Math.abs(x - 200) <= 53 && (y >= 205 || (x - 200) ** 2 + (y - 205) ** 2 <= 53 * 53);
export function inArch(x, y) {
  if (y >= 62 && y < 102) return x >= 100 && x <= 300; // the cap
  if (y >= 102 && y < 140) { const k = (y - 102) * 0.4; return x >= 50 + k && x <= 350 - k; } // the slab, narrowing down
  if (y >= 140 && y < 292) return x >= 70 && x <= 330 && !inOpening(x, y); // the pillars
  if (y >= 292 && y < 312) return (x >= 62 && x <= 148) || (x >= 252 && x <= 338); // first step of the base
  if (y >= 312 && y <= 336) return (x >= 50 && x <= 150) || (x >= 250 && x <= 350); // the foot
  return false;
}

/** Coverage of the tile and the arch for each pixel of an n×n grid, 0..1. */
export function sample(n) {
  const px = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let tile = 0, arch = 0;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        const x = ((i + (a + 0.5) / 3) / n) * 400, y = ((j + (b + 0.5) / 3) / n) * 400;
        if (inTile(x, y)) tile++;
        if (inArch(x, y)) arch++;
      }
      px.push({ i, j, tile: tile / 9, arch: arch / 9, seed: hash(i, j) });
    }
  }
  return px;
}
function hash(i, j) { let h = (i * 374761393 + j * 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// ---------------------------------------------------------------- colour
export const mix = (a, b, t) => a.map((v, k) => Math.round(v + (b[k] - v) * t));
const clamp = (t) => Math.min(1, Math.max(0, t));
const ease = (t) => 1 - (1 - clamp(t)) ** 3;
const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM ?? '') || ['iTerm.app', 'WezTerm', 'vscode', 'ghostty'].includes(process.env.TERM_PROGRAM ?? '');
export function sgr(rgb, bg) {
  if (truecolor) return `\x1b[${bg ? 48 : 38};2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  const c = rgb.map((v) => Math.round((v / 255) * 5));
  return `\x1b[${bg ? 48 : 38};5;${16 + 36 * c[0] + 6 * c[1] + c[2]}m`;
}

// ---------------------------------------------------------------- one frame
const T_TILE = 0.5, T_ARCH = 0.35, D_ARCH = 1.5, T_SHINE = 2.05, D_SHINE = 0.6, T_END = 2.75;

/** Colour of one pixel at time t, or null where nothing is drawn yet. */
function color(p, n, t) {
  if (p.tile === 0) return null;
  const dx = Math.abs((p.i + 0.5) / n - 0.5) * 2, dy = Math.abs((p.j + 0.5) / n - 0.5) * 2;
  if (Math.max(dx, dy) > ease(t / T_TILE) * 1.08) return null;
  let c = mix(PURPLE_TOP, PURPLE_BOTTOM, p.j / n);
  if (p.arch > 0) {
    const rise = 1 - p.j / n; // 0 at the ground, 1 at the top
    const at = T_ARCH + rise * (D_ARCH - 0.35) + p.seed * 0.3;
    if (t >= at) c = mix(c, WHITE, p.arch);
    else if (t >= at - 0.28) {
      const spark = (p.i + Math.floor(t * 24)) % 2 ? BLUE : PINK;
      c = mix(c, p.seed > 0.5 ? spark : WHITE, p.arch * (0.55 + 0.45 * Math.sin(t * 40 + p.seed * 9) ** 2));
    }
  }
  const band = T_SHINE <= t && t <= T_SHINE + D_SHINE ? -0.3 + ((t - T_SHINE) / D_SHINE) * 1.6 : null;
  if (band !== null) {
    const d = Math.abs((p.i / n + p.j / n) / 2 - band);
    if (d < 0.07) c = mix(c, WHITE, 0.35 * (1 - d / 0.07));
  }
  return p.tile < 1 ? mix(c, [40, 30, 60], (1 - p.tile) * 0.6) : c;
}

/** The text of one frame: n/2 lines, each n cells wide, with an indent. */
export function frame(px, n, t, indent = '  ') {
  const lines = [];
  for (let j = 0; j < n; j += 2) {
    let line = indent;
    for (let i = 0; i < n; i++) {
      const top = color(px[j * n + i], n, t), bottom = color(px[(j + 1) * n + i], n, t);
      if (!top && !bottom) line += '\x1b[0m ';
      else if (top && !bottom) line += `\x1b[0m${sgr(top)}▀`;
      else if (!top) line += `\x1b[0m${sgr(bottom)}▄`;
      else line += `${sgr(top)}${sgr(bottom, true)}▀`;
    }
    lines.push(line + '\x1b[0m');
  }
  return lines;
}

/** Paints any w×h pixel grid (colorAt(x, y) → [r,g,b] or null) as text, two pixels per character cell. */
export function paint(w, h, colorAt, indent = '  ') {
  const lines = [];
  for (let y = 0; y < h; y += 2) {
    let line = indent;
    for (let x = 0; x < w; x++) {
      const top = colorAt(x, y), bottom = y + 1 < h ? colorAt(x, y + 1) : null;
      if (!top && !bottom) line += '\x1b[0m ';
      else if (top && !bottom) line += `\x1b[0m${sgr(top)}▀`;
      else if (!top) line += `\x1b[0m${sgr(bottom)}▄`;
      else line += `${sgr(top)}${sgr(bottom, true)}▀`;
    }
    lines.push(line + '\x1b[0m');
  }
  return lines;
}

// ---------------------------------------------------------------- play
export function animationAllowed(out = process.stdout) {
  return Boolean(out.isTTY) && !process.env.NO_COLOR && !process.env.FATLINE_NO_ANIMATION && (out.columns ?? 80) >= 40 && (out.rows ?? 24) >= 20;
}

/** Plays the arch, then the name. Resolves when done or skipped. */
export async function playArch({ out = process.stdout, input = process.stdin, title = 'F A T L I N E', subtitle = 'your own Farcaster node, your own client' } = {}) {
  if (!animationAllowed(out)) return;
  const n = Math.min(48, Math.floor(((out.rows ?? 30) - 6) / 2) * 2, Math.floor(((out.columns ?? 80) - 4) / 2) * 2);
  const px = sample(n);
  const indent = ' '.repeat(Math.max(2, Math.floor(((out.columns ?? 80) - n) / 2)));
  const h = n / 2;

  let skipped = false;
  const raw = input.isTTY && typeof input.setRawMode === 'function';
  const onKey = (b) => { if (b[0] === 3) { cleanup(); process.exit(130); } skipped = true; };
  const cleanup = () => {
    out.write('\x1b[0m\x1b[?25h');
    if (raw) { input.setRawMode(false); input.off('data', onKey); input.pause(); }
  };
  if (raw) { input.setRawMode(true); input.resume(); input.on('data', onKey); }
  out.write('\x1b[?25l' + '\n'.repeat(h + 3));

  const draw = (t, caption) => {
    out.write(`\x1b[${h + 3}A\r` + frame(px, n, t, indent).join('\n') + '\n\n' + caption + '\x1b[K\n\n');
  };
  const center = (s) => ' '.repeat(Math.max(0, Math.floor(((out.columns ?? 80) - s.length) / 2)));
  const start = Date.now();
  for (;;) {
    const t = skipped ? T_END : (Date.now() - start) / 1000;
    draw(Math.min(t, T_END), '');
    if (t >= T_END) break;
    await new Promise((r) => setTimeout(r, 33));
  }
  // The name types itself out, then the subtitle fades in.
  for (let k = 0; k <= title.length; k++) {
    draw(T_END, center(title) + `\x1b[1m${title.slice(0, k)}\x1b[0m`);
    if (!skipped) await new Promise((r) => setTimeout(r, 45));
  }
  out.write(`\x1b[1A\r${center(subtitle)}\x1b[2m${subtitle}\x1b[0m\n`);
  if (!skipped) await new Promise((r) => setTimeout(r, 500));
  cleanup();
}

if (import.meta.url === `file://${process.argv[1]}`) await playArch();
