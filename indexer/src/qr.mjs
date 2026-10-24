// A QR code drawn in the terminal, in the Fatline's colours, with the Farcaster arch at its heart.
//   - dark modules in Farcaster purple; the three corner squares hold a blue (Snapchain), a pink (Hypersnap)
//     and a purple centre;
//   - the middle is cleared and the arch is drawn there (error correction H keeps it readable);
//   - when it appears, the modules grow outward from the arch, sparking blue and pink before they settle.
// Square modules: one character wide and half a character tall (the ▀ half block), so 41 modules ≈ 45 columns.
import qrcode from 'qrcode-generator';
import { mix, paint, sample } from '../../infra/arch.mjs';

const LIGHT = [251, 246, 234];
const PURPLE_A = [98, 60, 186];
const PURPLE_B = [62, 34, 128];
const BLUE = [31, 95, 214];
const PINK = [205, 52, 128];
const WHITE = [255, 255, 255];
const QUIET = 3;

/** The module grid of a QR code for this text, with the arch in the middle. */
export function qrArt(text) {
  const q = qrcode(0, 'H');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const size = n + QUIET * 2;
  // The arch: an odd square of about a fifth of the code, with a one-module light border.
  let L = Math.round(n * 0.3); if (L % 2 === 0) L += 1;
  const l0 = (n - L) >> 1;
  const logo = sample(L - 2);
  const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const finderCore = (r, c) => {
    for (const [r0, c0, color] of [[0, 0, PURPLE_B], [0, n - 7, BLUE], [n - 7, 0, PINK]]) {
      if (r >= r0 + 2 && r <= r0 + 4 && c >= c0 + 2 && c <= c0 + 4) return color;
    }
    return null;
  };
  const cells = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = y - QUIET, c = x - QUIET;
      let color = LIGHT, kind = 'quiet';
      if (r >= 0 && c >= 0 && r < n && c < n) {
        const inLogo = r >= l0 && r < l0 + L && c >= l0 && c < l0 + L;
        if (inLogo) {
          kind = 'logo';
          const lr = r - l0 - 1, lc = c - l0 - 1;
          const p = lr >= 0 && lc >= 0 && lr < L - 2 && lc < L - 2 ? logo[lr * (L - 2) + lc] : null;
          color = p && p.tile > 0.5 ? (p.arch > 0.5 ? WHITE : mix([143, 104, 216], [118, 82, 196], lr / L)) : LIGHT;
        } else if (q.isDark(r, c)) {
          kind = finder(r, c) ? 'finder' : 'data';
          color = finderCore(r, c) ?? mix(PURPLE_A, PURPLE_B, (r + c) / (2 * n));
        } else kind = 'light';
      }
      cells.push({ x, y, color, kind, d: Math.hypot(x - size / 2, y - size / 2) / (size / 2), seed: ((x * 73856093) ^ (y * 19349663)) % 1000 / 1000 });
    }
  }
  return { size, n, cells, at: (x, y) => cells[y * size + x].color };
}

/** The finished code as lines of text. */
export function qrLines(text, indent = '  ') {
  const art = qrArt(text);
  return paint(art.size, art.size, art.at, indent);
}

/** Draws the code, growing outward from the arch. Without a terminal it just prints it. */
export async function showQr(text, { out = process.stdout, indent = '  ', animate = out.isTTY && !process.env.FATLINE_NO_ANIMATION } = {}) {
  const art = qrArt(text);
  const h = Math.ceil(art.size / 2);
  if (!animate) { out.write(paint(art.size, art.size, art.at, indent).join('\n') + '\n'); return; }
  const T = 1.1;
  const colorAt = (t) => (x, y) => {
    const cell = art.cells[y * art.size + x];
    if (cell.kind === 'logo') return t > 0.05 ? cell.color : LIGHT;
    const at = 0.1 + cell.d * 0.75 + cell.seed * 0.15;
    if (t >= at) return cell.color;
    if (t >= at - 0.12 && (cell.kind === 'data' || cell.kind === 'finder')) return (x + y) % 2 ? BLUE : PINK;
    return LIGHT;
  };
  out.write('\x1b[?25l' + '\n'.repeat(h));
  const start = Date.now();
  try {
    for (;;) {
      const t = (Date.now() - start) / 1000;
      out.write(`\x1b[${h}A\r` + paint(art.size, art.size, colorAt(Math.min(t, T)), indent).join('\n') + '\n');
      if (t >= T) break;
      await new Promise((r) => setTimeout(r, 33));
    }
  } finally { out.write('\x1b[0m\x1b[?25h'); }
}

/** The same code as an SVG (the arch in the middle, the coloured corners), for a page. */
export function qrSvg(text, { cell = 8 } = {}) {
  const art = qrArt(text);
  const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`;
  const rects = art.cells.filter((c) => c.color !== LIGHT).map((c) => `<rect x="${c.x * cell}" y="${c.y * cell}" width="${cell + 0.5}" height="${cell + 0.5}" fill="${rgb(c.color)}"/>`).join('');
  const s = art.size * cell;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="100%" role="img" aria-label="QR code"><rect width="${s}" height="${s}" fill="${rgb(LIGHT)}"/>${rects}</svg>`;
}
