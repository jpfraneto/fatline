// Five dimensions → visual DNA. This file IS the species' rulebook: every trait a Fatliner can have,
// and which part of a history picks it. Changing a rule means a new DNA_VERSION; minted characters
// keep rendering with the version they were born with.
//
// Fairness rule: each trait picks a FORM from a short list, and every form costs the renderer about
// the same number of marks. Volume never buys more ornament (test/fairness.test.mjs checks this).

import { canonical, round6 } from './canonical.mjs';
import { sha256Hex } from './hash.mjs';
import { prng } from './prng.mjs';
import { subjectKey } from './history.mjs';

export const DNA_VERSION = 'fatliners.dna/1';

// Twelve skin glazes. Hue is the only trait chosen by the seed alone: it's what makes two
// near-identical quiet histories look like two different beings.
export const GLAZES = [
  { name: 'coral', h: 8 }, { name: 'peach', h: 24 }, { name: 'apricot', h: 38 }, { name: 'butter', h: 50 },
  { name: 'pistachio', h: 84 }, { name: 'mint', h: 142 }, { name: 'seafoam', h: 170 }, { name: 'sky', h: 198 },
  { name: 'periwinkle', h: 224 }, { name: 'lilac', h: 262 }, { name: 'orchid', h: 292 }, { name: 'rose', h: 336 },
];

// VOICE temperament → color relationship between skin, background and signal glow.
export const HARMONIES = {
  echo:    { bg: 0,   glow: 0,   note: 'one hue throughout: someone who mostly listens' },
  kin:     { bg: 35,  glow: -35, note: 'neighbouring hues: a balanced voice' },
  counter: { bg: 195, glow: 165, note: 'opposite hues: a visual voice (images, video)' },
  split:   { bg: 150, glow: 210, note: 'split hues: a storyteller (long or long-form casts)' },
  triad:   { bg: 120, glow: 240, note: 'three-way hues: a linker (shares the web)' },
};

const TEMPERAMENT_HARMONY = { listener: 'echo', balanced: 'kin', visual: 'counter', storyteller: 'split', linker: 'triad', unwritten: 'echo' };
const TEMPERAMENT_MOUTH = { listener: 'dot', balanced: 'smile', visual: 'smile', storyteller: 'o', linker: 'cat', unwritten: 'dot' };

export function temperament(f) {
  const v = f.voice;
  if (f.pulse.silent) return 'unwritten';
  const scores = {
    listener: v.listening / 0.7,
    visual: v.mediaShare / 0.35,
    storyteller: Math.max(v.length / 0.45, v.longShare / 0.1),
    linker: v.linkShare / 0.35,
  };
  const [best, score] = Object.entries(scores).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return score >= 1 ? best : 'balanced';
}

function rootsMaterial(r) {
  if (r.returns >= 1) return 'kintsugi';                       // long silences, and returns: gold seams
  if (r.ageDays < 120) return 'dew';                           // newly arrived
  if (r.continuity >= 0.75 && r.ageDays >= 730) return 'stone'; // long, unbroken presence
  if (r.continuity < 0.35 && r.ageDays >= 365) return 'moss';   // a long, quiet life
  return 'clay';
}

const ageRings = (days) => (days < 180 ? 1 : days < 365 ? 2 : days < 730 ? 3 : days < 1460 ? 4 : 5);

function orbitForm(o) {
  if (o.replyShare < 0.12) return 'halo';                         // speaks to the room, not to one
  if (o.bonds >= 0.5) return o.circle <= 3 ? 'binary' : 'constellation'; // conversation keeps returning: to one or two, or to a circle
  if (o.spread >= 0.85) return 'ring';                            // even, light contact with many
  return 'moon';
}
const SATELLITES = { halo: 0, moon: 1, binary: 2, constellation: 3, ring: 0 };

function bloomForm(b) {
  if (b.makerShare >= 0.35) return 'blossom';                       // makes images and video
  if (b.channels === 0 || b.rootedShare < 0.05) return 'seed';      // belongs to no channel (yet)
  if (b.channels <= 2 || b.evenness < 0.35) return 'bud';           // one deep home
  if (b.channels >= 7 && b.evenness >= 0.6) return 'fern';          // wanders many gardens evenly
  return 'sprout';                                                  // a few homes
}

function eyeForm(f) {
  if (f.orbit.replyShare > 0.6) return 'wide';     // attentive: mostly answering others
  if (f.voice.listening > 0.75) return 'soft';     // half-lidded: mostly listening
  if (f.voice.mediaShare > 0.35) return 'bright';  // a star in the eye: a maker of images
  return 'round';
}

function finish(v) {
  if (v.length < 0.15) return 'matte';
  if (v.length < 0.35) return 'satin';
  if (v.length < 0.6) return 'gloss';
  return 'pearl';
}

export function seedOf(subject, commitmentHex) {
  return sha256Hex(canonical({ dna: DNA_VERSION, subject: subjectKey(subject), commitment: commitmentHex }));
}

export function buildDna(features, { subject, commitment: commit }) {
  const seed = seedOf(subject, commit);
  const R = (label) => prng(seed, label);
  const f = features;
  const temp = temperament(f);
  const harmony = TEMPERAMENT_HARMONY[temp];
  const glaze = R('glaze').pick(GLAZES);

  const material = rootsMaterial(f.roots);
  const oForm = orbitForm(f.orbit);
  const ro = R('orbit');
  const nSat = SATELLITES[oForm];
  const start = ro.range(0, Math.PI * 2);
  const satellites = Array.from({ length: nSat }, (_, i) => ({
    angle: round6(start + (i * Math.PI * 2) / Math.max(nSat, 1) + ro.range(-0.35, 0.35)),
    size: round6(ro.range(4.5, 7.5)),
  }));

  // PULSE: the curve itself. A history with no messages gets an "unwritten" signal: a calm wave from its seed.
  const rp = R('pulse');
  const phase = rp.range(0, Math.PI * 2), freq = rp.range(2.4, 4.2);
  // Drawn curve: centred on its own mean, stretched until its biggest swing fills the line (gain capped
  // at 2.5, so near-uniform activity stays a calm, nearly straight line instead of amplified noise).
  const raw = f.pulse.curve;
  const mean = raw.reduce((s, v) => s + v, 0) / raw.length;
  const dev = Math.max(...raw.map((v) => Math.abs(v - mean)));
  const gain = dev > 0 ? Math.min(2.5, 0.5 / dev) : 0;
  const curve = f.pulse.silent
    ? Array.from({ length: raw.length }, (_, i) => round6(0.5 + 0.22 * Math.sin(i / freq + phase)))
    : raw.map((v) => round6(0.5 + (v - mean) * gain));
  const style = f.pulse.burstiness > 0.35 ? 'spike' : f.pulse.burstiness < -0.1 ? 'steady' : 'wave';

  const rb = R('bloom');
  const rs = R('shape');
  return {
    version: DNA_VERSION,
    seed,
    temperament: temp,
    palette: { glaze: glaze.name, skinHue: glaze.h, harmony },
    shape: { // tiny seed-driven variation inside one fixed silhouette
      squash: round6(rs.range(-0.035, 0.035)),
      eyeGap: round6(rs.range(-3, 3)),
      eyeTilt: round6(rs.range(-0.04, 0.04)),
      lineY: round6(rs.range(-2, 2)),
    },
    roots: { material, rings: ageRings(f.roots.ageDays), seams: Math.min(f.roots.returns, 3) },
    orbit: { form: oForm, tilt: round6(ro.range(-0.32, 0.32)), satellites },
    voice: {
      translucency: round6(0.12 + 0.55 * f.voice.listening),
      finish: finish(f.voice),
      eyes: eyeForm(f),
      mouth: TEMPERAMENT_MOUTH[temp],
      blush: f.voice.mentionShare > 0.25,
    },
    pulse: { curve, style, nodeAt: round6(f.pulse.silent ? 0.5 : f.pulse.peakAt), steadiness: round6(f.pulse.activeWeekShare) },
    bloom: {
      form: bloomForm(f.bloom),
      lean: round6(rb.range(-0.28, 0.28)),
      petals: rb.int(5, 7),
    },
  };
}
