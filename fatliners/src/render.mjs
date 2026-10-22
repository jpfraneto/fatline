// Visual DNA → SVG. Pure string building: same DNA, same bytes, in Node and in the browser.
// No filters except one blur for glow, no external assets, no fonts.
//
// Anatomy (viewBox 0 0 256 256), fixed for the whole species:
//   head    soft superellipse "pebble", centre (128,118), 172 wide: ~2/3 of the tile
//   line    the signal, across the forehead at y≈86, running out past both sides of the head
//   node    a bright bead on the line, at the brightest moment of the history
//   eyes    two large dark ovals with two catchlights, at y≈132
//   body    a small bell with two arm nubs and two feet, under the head
//   outline one dark ink line around everything: the silhouette reads at 32 px
// Everything else (glaze, material, orbit, bloom, eyes, mouth) varies inside that frame.

import { prng } from './prng.mjs';

export const RENDERER_VERSION = 'fatliners.render/1';

const CX = 128, CY = 118, A = 86, B_TOP = 78, B_BOT = 70, N = 2.6;
const f2 = (x) => (Math.round(x * 100) / 100).toString();

function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const c = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return '#' + [c(0), c(8), c(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Smooth closed or open path through points (Catmull-Rom → cubic Bézier). */
function smooth(pts, closed = false) {
  const n = pts.length;
  const P = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${f2(pts[0][0])} ${f2(pts[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f2(c1[0])} ${f2(c1[1])} ${f2(c2[0])} ${f2(c2[1])} ${f2(p2[0])} ${f2(p2[1])}`;
  }
  return closed ? d + 'Z' : d;
}

function geometry(dna) {
  const sq = 1 + dna.shape.squash;
  const bt = B_TOP * sq, bb = B_BOT * sq;
  const headPts = [];
  for (let i = 0; i < 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    headPts.push([CX + A * Math.sign(c) * Math.abs(c) ** (2 / N), CY + (s > 0 ? bb : bt) * Math.sign(s) * Math.abs(s) ** (2 / N)]);
  }
  const halfWidthAt = (y) => {
    const dy = y - CY, b = dy > 0 ? bb : bt;
    return A * Math.max(0, 1 - Math.abs(dy / b) ** N) ** (1 / N);
  };
  return { headPath: smooth(headPts, true), headTop: CY - bt, headBottom: CY + bb, halfWidthAt };
}

function colors(dna) {
  const h = dna.palette.skinHue;
  const harmony = { echo: [0, 0], kin: [35, -35], counter: [195, 165], split: [150, 210], triad: [120, 240] }[dna.palette.harmony];
  const glowH = h + harmony[1], bgH = h + harmony[0];
  return {
    ink: hsl(bgH, 38, 11),
    skin: hsl(h, 58, 80), skinLight: hsl(h, 70, 90), skinDark: hsl(h, 40, 66), body: hsl(h, 52, 74),
    bg: hsl(bgH, 30, 18), bgLight: hsl(bgH, 34, 26),
    glow: hsl(glowH, 100, 66), glowSoft: hsl(glowH, 100, 82), glowDeep: hsl(glowH, 70, 42),
    eye: hsl(glowH, 40, 10), bloom: hsl(bgH + 20, 62, 64), bloomDark: hsl(bgH + 20, 45, 44),
    moss: hsl(98, 34, 44), mossLight: hsl(90, 45, 66), gold: '#e9c46a', goldLight: '#fff2c4', blush: '#ff7f9c',
  };
}

// ------------------------------------------------------------------ parts

function pulsePath(dna, g, icon) {
  const y0 = CY - 32 + dna.shape.lineY;
  const hw = g.halfWidthAt(y0);
  const xL = CX - hw + 9, xR = CX + hw - 9;
  const amp = icon ? 16 : 26;
  let curve = dna.pulse.curve;
  if (dna.pulse.style === 'steady' || icon) curve = curve.filter((_, i) => i % 2 === 0);
  const pts = curve.map((c, i) => {
    const t = i / (curve.length - 1);
    const env = Math.sin(Math.PI * t) ** 0.6; // enters and leaves the head flat
    return [xL + (xR - xL) * t, y0 - (c - 0.5) * amp * env];
  });
  const tail = icon ? 14 : 24;
  const body = dna.pulse.style === 'spike' && !icon
    ? 'M' + pts.map((p) => `${f2(p[0])} ${f2(p[1])}`).join('L')
    : smooth(pts);
  const d = `M${f2(CX - hw - tail)} ${f2(y0)}L${f2(xL)} ${f2(y0)}` + body.replace(/^M/, 'L') + `L${f2(CX + hw + tail)} ${f2(y0)}`;
  const k = Math.round(dna.pulse.nodeAt * (pts.length - 1));
  return { d, node: pts[k], y0, x0: CX - hw - tail, x1: CX + hw + tail };
}

function eye(cx, cy, form, tilt, c, sw, icon, id) {
  const rx = form === 'wide' ? 19 : 17, ry = form === 'wide' ? 23 : 21;
  let s = `<g transform="rotate(${f2(tilt * 57.3)} ${f2(cx)} ${f2(cy)})">`;
  s += `<ellipse cx="${f2(cx)}" cy="${f2(cy)}" rx="${rx}" ry="${ry}" fill="${c.eye}" stroke="${c.ink}" stroke-width="${f2(sw * 0.8)}"/>`;
  if (!icon) s += `<ellipse cx="${f2(cx)}" cy="${f2(cy + ry * 0.45)}" rx="${f2(rx * 0.72)}" ry="${f2(ry * 0.4)}" fill="url(#${id}-iris)"/>`;
  if (form === 'bright') {
    const x = cx + 5, y = cy - 7, r = icon ? 7 : 8;
    s += `<path d="M${f2(x)} ${f2(y - r)}Q${f2(x + 1.4)} ${f2(y - 1.4)} ${f2(x + r)} ${f2(y)}Q${f2(x + 1.4)} ${f2(y + 1.4)} ${f2(x)} ${f2(y + r)}Q${f2(x - 1.4)} ${f2(y + 1.4)} ${f2(x - r)} ${f2(y)}Q${f2(x - 1.4)} ${f2(y - 1.4)} ${f2(x)} ${f2(y - r)}Z" fill="#fff"/>`;
  } else {
    s += `<ellipse cx="${f2(cx + 5.5)}" cy="${f2(cy - 7.5)}" rx="${icon ? 6.5 : 6}" ry="${icon ? 7 : 6.5}" fill="#fff"/>`;
  }
  s += `<circle cx="${f2(cx - 6)}" cy="${f2(cy + 7.5)}" r="${icon ? 3.2 : 2.6}" fill="#fff" opacity=".9"/>`;
  if (form === 'soft') {
    // A resting upper lid: skin over the top of the eye, with an ink edge.
    const ly = cy - ry * 0.12;
    const dx = rx * Math.sqrt(1 - ((ly - cy) / ry) ** 2);
    const lid = `M${f2(cx - dx)} ${f2(ly)}A${rx} ${ry} 0 0 1 ${f2(cx + dx)} ${f2(ly)}Q${f2(cx)} ${f2(ly + 8)} ${f2(cx - dx)} ${f2(ly)}Z`;
    s += `<path d="${lid}" fill="url(#${id}-skin)" stroke="${c.ink}" stroke-width="${f2(sw * 0.8)}" stroke-linejoin="round"/>`;
  }
  return s + '</g>';
}

function mouth(form, c, sw) {
  const x = CX, y = 167;
  const st = `fill="none" stroke="${c.ink}" stroke-width="${f2(sw * 0.85)}" stroke-linecap="round" stroke-linejoin="round"`;
  switch (form) {
    case 'dot': return `<ellipse cx="${x}" cy="${y}" rx="3.4" ry="2.8" fill="${c.ink}"/>`;
    case 'o': return `<ellipse cx="${x}" cy="${y + 1}" rx="5.2" ry="6.2" fill="${c.ink}"/><ellipse cx="${x}" cy="${y + 4}" rx="3" ry="2" fill="#e8768f"/>`;
    case 'cat': return `<path d="M${x - 10} ${y - 2}Q${x - 5} ${y + 5} ${x} ${y - 1}Q${x + 5} ${y + 5} ${x + 10} ${y - 2}" ${st}/>`;
    default: return `<path d="M${x - 8} ${y - 2}Q${x} ${y + 7} ${x + 8} ${y - 2}" ${st}/>`;
  }
}

function texture(dna, c, rnd, g) {
  let s = '';
  const m = dna.roots.material;
  if (m === 'stone') {
    for (let i = 0; i < 28; i++) {
      const x = CX + rnd.range(-80, 80), y = CY + rnd.range(-70, 70);
      s += `<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(rnd.range(0.8, 2.2))}" fill="${c.skinDark}" opacity=".45"/>`;
    }
  } else if (m === 'moss') {
    // tufts hugging the lower rim, two clumps (left and right of the chin)
    for (const side of [-1, 1]) {
      const centre = rnd.range(0.55, 0.85);
      for (let i = 0; i < 9; i++) {
        const t = Math.PI / 2 + side * (centre + rnd.range(-0.28, 0.28));
        const ca = Math.cos(t), sa = Math.sin(t);
        const x = CX + A * Math.sign(ca) * Math.abs(ca) ** (2 / N), y = CY + B_BOT * Math.abs(sa) ** (2 / N);
        s += `<circle cx="${f2(x - Math.sign(ca) * 2)}" cy="${f2(y - 2)}" r="${f2(rnd.range(3, 6.5))}" fill="${c.moss}"/>`;
        s += `<circle cx="${f2(x - Math.sign(ca) * 3)}" cy="${f2(y - 4)}" r="${f2(rnd.range(1, 2))}" fill="${c.mossLight}"/>`;
      }
    }
  } else if (m === 'kintsugi') {
    for (let k = 0; k < dna.roots.seams; k++) {
      const t = rnd.range(-0.5, 0.5) + (k % 2 ? Math.PI : 0) + rnd.range(0.2, 0.9) * (k % 2 ? -1 : 1);
      let x = CX + Math.cos(t) * (A + 4), y = CY + Math.sin(t) * (B_BOT + 4);
      const pts = [[x, y]];
      const dirx = (CX - x) / A, diry = (CY + 10 - y) / B_BOT;
      for (let i = 0; i < 8; i++) {
        x += dirx * rnd.range(8, 12) + rnd.range(-6, 6); y += diry * rnd.range(8, 12) + rnd.range(-6, 6);
        pts.push([x, y]);
      }
      const d = 'M' + pts.map((p) => `${f2(p[0])} ${f2(p[1])}`).join('L');
      s += `<path d="${d}" fill="none" stroke="${c.ink}" stroke-width="5.4" stroke-linejoin="round" stroke-linecap="round" opacity=".55"/>`;
      s += `<path d="${d}" fill="none" stroke="${c.gold}" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round"/>`;
      s += `<path d="${d}" fill="none" stroke="${c.goldLight}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
  } else if (m === 'dew') {
    for (let i = 0; i < 4; i++) {
      const x = CX + rnd.range(-60, 60), y = CY + rnd.range(10, 55);
      s += `<ellipse cx="${f2(x)}" cy="${f2(y)}" rx="2.6" ry="3.3" fill="${c.skinLight}" stroke="${c.skinDark}" stroke-width=".8"/><circle cx="${f2(x - 0.8)}" cy="${f2(y - 1.2)}" r=".9" fill="#fff"/>`;
    }
  } else { // clay: fine growth lines, like a thrown pot
    for (let i = 0; i < 4; i++) {
      const y = CY + 30 + i * 9, hw = g.halfWidthAt(y) - 6;
      s += `<path d="M${f2(CX - hw)} ${f2(y)}Q${CX} ${f2(y + 6)} ${f2(CX + hw)} ${f2(y)}" fill="none" stroke="${c.skinDark}" stroke-width="1.2" opacity=".4"/>`;
    }
  }
  return s;
}

function bloom(dna, c, g, sw, icon) {
  const b = dna.bloom;
  const x0 = CX, y0 = g.headTop + 6;
  const tx = x0 + b.lean * 34, ty = y0 - (b.form === 'seed' ? 20 : 28);
  const ink = `stroke="${c.ink}" stroke-width="${f2(sw * 0.8)}" stroke-linejoin="round"`;
  let s = `<path d="M${x0} ${f2(y0)}Q${f2(x0 + b.lean * 6)} ${f2((y0 + ty) / 2)} ${f2(tx)} ${f2(ty)}" fill="none" stroke="${c.ink}" stroke-width="${f2(sw * 1.9)}" stroke-linecap="round"/>`;
  s += `<path d="M${x0} ${f2(y0)}Q${f2(x0 + b.lean * 6)} ${f2((y0 + ty) / 2)} ${f2(tx)} ${f2(ty)}" fill="none" stroke="${c.bloomDark}" stroke-width="${f2(sw * 0.75)}" stroke-linecap="round"/>`;
  const leaf = (side, len, ang) => {
    const a = ang * side, mx = (x0 + tx) / 2, my = (y0 + ty) / 2 + 4;
    const ex = mx + Math.cos(a) * len * side, ey = my - Math.sin(Math.abs(a)) * len * 0.6;
    const nx = -(ey - my) * 0.35, ny = (ex - mx) * 0.35;
    return `<path d="M${f2(mx)} ${f2(my)}Q${f2((mx + ex) / 2 + nx)} ${f2((my + ey) / 2 + ny)} ${f2(ex)} ${f2(ey)}Q${f2((mx + ex) / 2 - nx)} ${f2((my + ey) / 2 - ny)} ${f2(mx)} ${f2(my)}Z" fill="${c.bloom}" ${ink}/>`;
  };
  switch (b.form) {
    case 'seed':
      s += `<ellipse cx="${f2(tx)}" cy="${f2(ty - 5)}" rx="7" ry="9" fill="${c.glow}" ${ink}/>`;
      s += `<ellipse cx="${f2(tx - 2)}" cy="${f2(ty - 8)}" rx="2.2" ry="3" fill="#fff" opacity=".8"/>`;
      break;
    case 'bud':
      s += `<path d="M${f2(tx)} ${f2(ty + 4)}C${f2(tx - 14)} ${f2(ty - 2)} ${f2(tx - 9)} ${f2(ty - 20)} ${f2(tx)} ${f2(ty - 24)}C${f2(tx + 9)} ${f2(ty - 20)} ${f2(tx + 14)} ${f2(ty - 2)} ${f2(tx)} ${f2(ty + 4)}Z" fill="${c.bloom}" ${ink}/>`;
      if (!icon) s += `<path d="M${f2(tx)} ${f2(ty + 2)}Q${f2(tx + 3)} ${f2(ty - 10)} ${f2(tx)} ${f2(ty - 22)}" fill="none" stroke="${c.bloomDark}" stroke-width="1.4"/>`;
      break;
    case 'sprout':
      s += leaf(-1, 22, 0.5) + leaf(1, 22, 0.5);
      s += `<circle cx="${f2(tx)}" cy="${f2(ty)}" r="4.5" fill="${c.bloom}" ${ink}/>`;
      break;
    case 'fern': {
      // a fiddlehead: an unrolling spiral, the shape of something still exploring
      const pts = [];
      for (let i = 0; i <= 26; i++) { const t = i / 26, a = -Math.PI / 2 + t * 4.2, r = 13 * (1 - t * 0.78); pts.push([tx + 7 + Math.cos(a + Math.PI) * r * (b.lean < 0 ? -1 : 1), ty - 6 + Math.sin(a + Math.PI) * r]); }
      s += leaf(-1, 16, 0.6) + leaf(1, 16, 0.6);
      s += `<path d="${smooth(pts)}" fill="none" stroke="${c.ink}" stroke-width="${f2(sw * 2.4)}" stroke-linecap="round"/>`;
      s += `<path d="${smooth(pts)}" fill="none" stroke="${c.bloom}" stroke-width="${f2(sw * 1.1)}" stroke-linecap="round"/>`;
      break;
    }
    case 'blossom': {
      for (let i = 0; i < b.petals; i++) {
        const a = (i / b.petals) * 360 + b.lean * 60;
        s += `<ellipse cx="${f2(tx)}" cy="${f2(ty - 10)}" rx="5.5" ry="10" transform="rotate(${f2(a)} ${f2(tx)} ${f2(ty)})" fill="${c.bloom}" ${ink}/>`;
      }
      s += `<circle cx="${f2(tx)}" cy="${f2(ty)}" r="5.5" fill="${c.glow}" ${ink}/>`;
      break;
    }
  }
  return s;
}

function orbit(dna, c, sw, icon, layer, id) {
  const o = dna.orbit;
  const ox = CX, oy = CY + 58, rx = 112, ry = 22;
  const rot = `rotate(${f2(o.tilt * 30)} ${ox} ${oy})`;
  const lower = (r1, r2) => `M${f2(ox - r1)} ${oy}A${f2(r1)} ${f2(r2)} 0 0 0 ${f2(ox + r1)} ${oy}`;
  let s = '';
  if (o.form === 'halo') {
    if (layer !== 'front') return '';
    const y = CY - B_TOP - 6;
    s += `<ellipse cx="${CX}" cy="${f2(y)}" rx="40" ry="8.5" fill="none" stroke="${c.ink}" stroke-width="${f2(icon ? 9 : 6.5)}" transform="rotate(${f2(o.tilt * 20)} ${CX} ${f2(y)})"/>`;
    s += `<ellipse cx="${CX}" cy="${f2(y)}" rx="40" ry="8.5" fill="none" stroke="${c.glow}" stroke-width="${f2(icon ? 4 : 3)}" transform="rotate(${f2(o.tilt * 20)} ${CX} ${f2(y)})"/>`;
    if (!icon) for (const [dx, dy, r] of [[-30, -8, 2.2], [34, -4, 1.8], [-6, -13, 1.5], [18, 9, 1.4]]) s += `<circle cx="${CX + dx}" cy="${f2(y + dy)}" r="${r}" fill="${c.glowSoft}"/>`;
    return s;
  }
  const rings = o.form === 'ring' ? (icon ? [rx] : [rx - 5, rx + 5]) : [rx];
  if (layer === 'back') {
    if (!icon) for (const r of rings) s += `<ellipse cx="${ox}" cy="${oy}" rx="${r}" ry="${f2(ry * r / rx)}" fill="none" stroke="${c.glow}" stroke-width="1.6" opacity=".35" transform="${rot}"/>`;
  } else {
    for (const r of rings) {
      s += `<path d="${lower(r, ry * r / rx)}" fill="none" stroke="${c.ink}" stroke-width="${f2(icon ? 6 : 4.4)}" stroke-linecap="round" transform="${rot}"/>`;
      s += `<path d="${lower(r, ry * r / rx)}" fill="none" stroke="${c.glow}" stroke-width="${f2(icon ? 3 : 1.9)}" stroke-linecap="round" transform="${rot}" opacity=".95"/>`;
    }
  }
  // satellites: in front of the head when on the near side of the orbit
  const pos = o.satellites.map((sat) => ({ ...sat, x: rx * Math.cos(sat.angle), y: ry * Math.sin(sat.angle), front: Math.sin(sat.angle) > 0 }));
  const place = (p) => {
    const t = o.tilt * 30 / 57.3, x = ox + p.x * Math.cos(t) - p.y * Math.sin(t), y = oy + p.x * Math.sin(t) + p.y * Math.cos(t);
    return [x, y];
  };
  if (layer === 'front' && pos.length > 1 && !icon) {
    const pts = pos.map(place);
    s += `<path d="M${pts.map((p) => `${f2(p[0])} ${f2(p[1])}`).join('L')}${pos.length > 2 ? 'Z' : ''}" fill="none" stroke="${c.glowSoft}" stroke-width="1" stroke-dasharray="2 3" opacity=".7"/>`;
  }
  for (const p of pos) {
    if (p.front !== (layer === 'front')) continue;
    const [x, y] = place(p);
    const r = icon ? p.size + 3 : p.size;
    s += `<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(r)}" fill="${c.glowSoft}" stroke="${c.ink}" stroke-width="${f2(sw * 0.8)}"/>`;
    if (!icon) s += `<circle cx="${f2(x - r * 0.3)}" cy="${f2(y - r * 0.3)}" r="${f2(r * 0.32)}" fill="#fff"/>`;
  }
  if (o.form === 'moon' && !icon && layer === 'front') { // a moon leaves a faint wake of two motes
    const p0 = pos[0];
    for (const [k, rr] of [[0.32, 1.8], [0.6, 1.3]]) {
      const [x, y] = place({ x: rx * Math.cos(p0.angle - k), y: ry * Math.sin(p0.angle - k) });
      s += `<circle cx="${f2(x)}" cy="${f2(y)}" r="${rr}" fill="${c.glowSoft}" opacity=".8"/>`;
    }
  }
  if (o.form === 'ring' && !icon && layer === 'front') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI + 0.3, r = rx - 12 + ((i * 7) % 24);
      const [x, y] = place({ x: r * Math.cos(a), y: ry * (r / rx) * Math.sin(a) });
      s += `<circle cx="${f2(x)}" cy="${f2(y)}" r="1.4" fill="${c.glowSoft}"/>`;
    }
  }
  return s;
}

// ------------------------------------------------------------------ the whole being

/**
 * @param dna     from buildDna()
 * @param opts.detail  'full' (default, ≥128 px) or 'icon' (≤64 px: no texture, heavier lines)
 * @param opts.living  adds the living layer: blinking, a signal travelling the line, orbiting satellites,
 *                     and one mark per network the history was seen on (opts.signal)
 * @param opts.signal  { farcaster: 'synced'|'behind'|null, hypersnap: … } (living only)
 */
export function renderSvg(dna, { detail = 'full', living = false, signal = null, size = null } = {}) {
  const icon = detail === 'icon';
  const id = 'f' + dna.seed.slice(2, 10) + (icon ? 'i' : '');
  const c = colors(dna);
  const g = geometry(dna);
  const sw = icon ? 6.5 : 3.6;
  const L = pulsePath(dna, g, icon);
  const tex = icon ? '' : texture(dna, c, prng(dna.seed, 'texture'), g);
  const finishOpacity = { matte: 0.08, satin: 0.22, gloss: 0.42, pearl: 0.5 }[dna.voice.finish];
  const eyeY = 132, gap = 31 + dna.shape.eyeGap;

  const defs = `<defs>
<radialGradient id="${id}-bg" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="${c.bgLight}"/><stop offset="1" stop-color="${c.bg}"/></radialGradient>
<radialGradient id="${id}-skin" gradientUnits="userSpaceOnUse" cx="${CX - 24}" cy="${f2(g.headTop + 38)}" r="160"><stop offset="0" stop-color="${c.skinLight}"/><stop offset=".55" stop-color="${c.skin}"/><stop offset="1" stop-color="${c.skinDark}"/></radialGradient>
<radialGradient id="${id}-core" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="${c.glow}" stop-opacity="${f2(dna.voice.translucency * 0.75)}"/><stop offset="1" stop-color="${c.glow}" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}-iris" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${c.glow}" stop-opacity=".55"/><stop offset="1" stop-color="${c.glow}" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}-line" x1="${f2(L.x0)}" x2="${f2(L.x1)}" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${c.glow}" stop-opacity="0"/><stop offset=".14" stop-color="${c.glow}"/><stop offset=".86" stop-color="${c.glow}"/><stop offset="1" stop-color="${c.glow}" stop-opacity="0"/></linearGradient>
<linearGradient id="${id}-ink" x1="${f2(L.x0)}" x2="${f2(L.x1)}" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${c.ink}" stop-opacity="0"/><stop offset=".14" stop-color="${c.ink}"/><stop offset=".86" stop-color="${c.ink}"/><stop offset="1" stop-color="${c.ink}" stop-opacity="0"/></linearGradient>
${dna.voice.finish === 'pearl' ? `<linearGradient id="${id}-pearl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd6f0"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#c8f4ff"/></linearGradient>` : ''}
<linearGradient id="${id}-hot" x1="${f2(L.x0)}" x2="${f2(L.x1)}" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".2" stop-color="#fff" stop-opacity=".8"/><stop offset=".8" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="${id}-head"><path d="${g.headPath}"/></clipPath>
<filter id="${id}-blur" filterUnits="userSpaceOnUse" x="0" y="0" width="256" height="256"><feGaussianBlur stdDeviation="${icon ? 5 : 4}"/></filter>
</defs>`;

  // body
  const bodyD = `M${CX - 34} 182C${CX - 40} 200 ${CX - 44} 222 ${CX - 38} 233Q${CX} 243 ${CX + 38} 233C${CX + 44} 222 ${CX + 40} 200 ${CX + 34} 182Z`;
  let body = `<ellipse cx="${CX}" cy="245" rx="52" ry="6" fill="#000" opacity=".28"/>`;
  for (const sx of [-1, 1]) body += `<ellipse cx="${CX + sx * 16}" cy="239" rx="13" ry="7" fill="${c.body}" stroke="${c.ink}" stroke-width="${f2(sw)}"/>`;
  body += `<path d="${bodyD}" fill="${c.body}" stroke="${c.ink}" stroke-width="${f2(sw)}" stroke-linejoin="round"/>`;
  if (!icon) for (let k = 0; k < dna.roots.rings; k++) {
    const r = 9 + k * 5.5;
    body += `<path d="M${f2(CX - r)} 236A${f2(r)} ${f2(r * 0.8)} 0 0 1 ${f2(CX + r)} 236" fill="none" stroke="${c.skinDark}" stroke-width="1.1" opacity=".55"/>`;
  }
  if (!icon && dna.roots.material === 'moss') body += `<circle cx="${CX - 22}" cy="230" r="4" fill="${c.moss}"/><circle cx="${CX - 15}" cy="233" r="3" fill="${c.moss}"/><circle cx="${CX + 25}" cy="228" r="3.2" fill="${c.moss}"/>`;
  for (const sx of [-1, 1]) body += `<ellipse cx="${CX + sx * 42}" cy="208" rx="9" ry="14" transform="rotate(${sx * -28} ${CX + sx * 42} 208)" fill="${c.body}" stroke="${c.ink}" stroke-width="${f2(sw)}"/>`;

  // head
  let head = `<path d="${g.headPath}" fill="url(#${id}-skin)"/>`;
  head += `<g clip-path="url(#${id}-head)"><ellipse cx="${CX}" cy="${CY + 6}" rx="70" ry="62" fill="url(#${id}-core)"/>${tex}</g>`;
  head += `<path d="${g.headPath}" fill="none" stroke="${c.ink}" stroke-width="${f2(sw * 1.1)}"/>`;
  head += `<ellipse cx="${CX - 38}" cy="${CY - 42}" rx="${icon ? 18 : 24}" ry="${icon ? 9 : 12}" transform="rotate(-24 ${CX - 38} ${CY - 42})" fill="${dna.voice.finish === 'pearl' ? `url(#${id}-pearl)` : '#fff'}" opacity="${f2(icon ? Math.max(finishOpacity, 0.3) : finishOpacity)}"/>`;

  // face: blush, eyes (own group, so the living layer can blink them), mouth
  let face = '';
  if (dna.voice.blush) for (const sx of [-1, 1]) face += `<ellipse cx="${CX + sx * 55}" cy="158" rx="12" ry="6.5" fill="${c.blush}" opacity=".38"/>`;
  face += `<g id="${id}-eyes">${eye(CX - gap, eyeY, dna.voice.eyes, -dna.shape.eyeTilt, c, sw, icon, id)}${eye(CX + gap, eyeY, dna.voice.eyes, dna.shape.eyeTilt, c, sw, icon, id)}</g>`;
  face += mouth(dna.voice.mouth, c, sw);

  // the signal line: glow, ink casing, light, hot core; then the node
  const lw = icon ? 7 : 5;
  let line = `<path d="${L.d}" fill="none" stroke="url(#${id}-line)" stroke-width="${f2(lw * 3)}" stroke-linecap="round" stroke-linejoin="round" opacity="${f2(0.35 + 0.35 * dna.pulse.steadiness)}" filter="url(#${id}-blur)"/>`;
  line += `<path d="${L.d}" fill="none" stroke="url(#${id}-ink)" stroke-width="${f2(lw + (icon ? 5 : 3.6))}" stroke-linecap="round" stroke-linejoin="round"/>`;
  line += `<path d="${L.d}" fill="none" stroke="url(#${id}-line)" stroke-width="${f2(lw)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (!icon) line += `<path d="${L.d}" fill="none" stroke="url(#${id}-hot)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const [nx, ny] = L.node;
  line += `<circle cx="${f2(nx)}" cy="${f2(ny)}" r="${icon ? 16 : 15}" fill="${c.glow}" opacity=".45" filter="url(#${id}-blur)"/>`;
  line += `<circle cx="${f2(nx)}" cy="${f2(ny)}" r="${icon ? 9 : 7.5}" fill="${c.glowSoft}" stroke="${c.ink}" stroke-width="${f2(sw * 0.8)}"/>`;
  line += `<circle cx="${f2(nx)}" cy="${f2(ny)}" r="${icon ? 4 : 3.2}" fill="#fff"/>`;

  let live = '';
  if (living) {
    live += `<circle r="3.4" fill="#fff"><animateMotion dur="3.2s" repeatCount="indefinite" path="${L.d}"/><animate attributeName="opacity" values="0;1;1;0" dur="3.2s" repeatCount="indefinite"/></circle>`;
    const states = signal ?? {};
    const NET = { farcaster: '#a98bff', hypersnap: '#4fe0b5' };
    let k = 0;
    for (const n of ['farcaster', 'hypersnap']) {
      if (!states[n]) continue;
      const a0 = k === 0 ? 200 : 20, r = 12;
      const p = (deg) => [nx + r * Math.cos((deg * Math.PI) / 180), ny + r * Math.sin((deg * Math.PI) / 180)];
      const [x1, y1] = p(a0), [x2, y2] = p(a0 + 140);
      live += `<path d="M${f2(x1)} ${f2(y1)}A${r} ${r} 0 0 1 ${f2(x2)} ${f2(y2)}" fill="none" stroke="${NET[n]}" stroke-width="2.6" stroke-linecap="round"${states[n] === 'behind' ? ' stroke-dasharray="2 3" opacity=".7"' : ''}><title>${n}: ${states[n]}</title></path>`;
      k++;
    }
  }

  const style = living ? `<style>
#${id}-eyes{animation:${id}-blink 5.2s infinite;transform-origin:${CX}px ${eyeY}px}
@keyframes ${id}-blink{0%,93%,100%{transform:scaleY(1)}95.5%{transform:scaleY(.08)}}
#${id}-orbit{animation:${id}-bob 6s ease-in-out infinite}
@keyframes ${id}-bob{50%{transform:translateY(-3px)}}
@media (prefers-reduced-motion:reduce){#${id}-eyes,#${id}-orbit{animation:none}}
</style>` : '';

  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"${dim} data-fatliner="${dna.seed}" data-renderer="${RENDERER_VERSION}">${style}${defs}`
    + `<rect width="256" height="256" fill="url(#${id}-bg)"/>`
    + `<ellipse cx="${CX}" cy="${CY}" rx="120" ry="104" fill="${c.glow}" opacity=".08"/>`
    + `<g id="${id}-orbitback">${orbit(dna, c, sw, icon, 'back', id)}</g>`
    + body + head + face + line
    + `<g id="${id}-orbit">${orbit(dna, c, sw, icon, 'front', id)}</g>`
    + bloom(dna, c, g, sw, icon)
    + live + '</svg>';
}
