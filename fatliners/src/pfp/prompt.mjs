// The one PFP prompt compiler. Pure: template text + traits in, prompt text + hash out. No I/O here
// (templates are loaded by prompt-files.mjs; the reference by reference.mjs).

import { sha256Hex } from '../hash.mjs';

export const BEGIN = '<!-- FATLINER_PFP_PROMPT_BEGIN -->';
export const END = '<!-- FATLINER_PFP_PROMPT_END -->';
const SLOT = /\{\{([A-Z_]+)\}\}/g;
const MAX_DIRECTIVE = 1200;

/** The text between the markers, markers excluded. Throws if they're missing or out of order. */
export function templateBody(text) {
  const a = text.indexOf(BEGIN), b = text.indexOf(END);
  if (a < 0 || b < 0 || b < a) throw new Error('prompt template: BEGIN/END markers missing or out of order');
  if (text.indexOf(BEGIN, a + 1) >= 0 || text.indexOf(END, b + 1) >= 0) throw new Error('prompt template: markers appear more than once');
  return text.slice(a + BEGIN.length, b).trim();
}

function clean(name, value, { optional = false } = {}) {
  if (value == null || value === '') {
    if (optional) return '';
    throw new Error(`prompt: ${name} is empty`);
  }
  if (typeof value !== 'string') throw new Error(`prompt: ${name} must be a string`);
  // Directives are our own generated text. Anything that looks like a template slot or markup is refused,
  // so retrieved text can never smuggle instructions or unresolved slots in.
  if (/\{\{|\}\}|<!--|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`prompt: ${name} contains forbidden characters`);
  if (value.length > MAX_DIRECTIVE) throw new Error(`prompt: ${name} is too long (${value.length})`);
  return value.trim();
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The identity paragraph: stable seeded cues. accepted = an accepted portrait already exists for this being. */
export function identityDirective(t, { accepted = false } = {}) {
  const i = t.identity;
  return [
    accepted ? 'Keep this individual recognizably the same being as its accepted portrait.' : 'This is a new individual of the species, painted for the first time.',
    `${cap(i.head)}, ${i.pose}.`,
    ...(i.face ? [`Its face: ${i.face}; ${i.eyes}. Its body: ${i.build}.`] : []),
    `Its forehead path runs across the brow and ends in the round temple node on the viewer's ${i.templeSide}.`,
    `Background: a flat, solid, muted ${i.backdrop}.`,
  ].join(' ');
}

/**
 * @param {object} o
 * @param {number} o.fid
 * @param {object} o.traits     visualTraits()
 * @param {string} o.template   the full template file text
 * @param {string} [o.honor]    a reviewed contributor honor, or empty
 * @param {boolean} [o.accepted]
 * @returns {{ text: string, sha256: string, slots: object }}
 */
export function buildPfpPrompt({ fid, traits: t, template, honor = '', accepted = false }) {
  if (!Number.isSafeInteger(fid) || fid <= 0) throw new Error('prompt: fid must be a positive safe integer');
  const slots = {
    FID: String(fid),
    IDENTITY_DIRECTIVE: clean('IDENTITY_DIRECTIVE', identityDirective(t, { accepted })),
    ROOTS_DIRECTIVE: clean('ROOTS_DIRECTIVE', cap(t.roots.text)),
    ORBIT_DIRECTIVE: clean('ORBIT_DIRECTIVE', cap(t.orbit.text)),
    VOICE_DIRECTIVE: clean('VOICE_DIRECTIVE', cap(t.voice.text)),
    PULSE_DIRECTIVE: clean('PULSE_DIRECTIVE', cap(t.pulse.text)),
    BLOOM_DIRECTIVE: clean('BLOOM_DIRECTIVE', cap(t.bloom.text)),
    NETWORK_DIRECTIVE: clean('NETWORK_DIRECTIVE', t.network.text),
    COVERAGE_DIRECTIVE: clean('COVERAGE_DIRECTIVE', t.coverage.text),
    ...(t.figurine ? Object.fromEntries(Object.entries({ MATERIAL: 'material', HEAD: 'head', EYES: 'eyes', LINE: 'line', CROWN: 'crown', PROP: 'prop', POSE: 'pose', SETTING: 'setting' })
      .map(([slot, k]) => [`FIG_${slot}`, clean(`FIG_${slot}`, t.figurine[k])])) : {}),
    OPTIONAL_HONOR_DIRECTIVE: clean('OPTIONAL_HONOR_DIRECTIVE', honor, { optional: true }),
  };
  const body = templateBody(template);
  const unknown = [...body.matchAll(SLOT)].map((m) => m[1]).filter((k) => !(k in slots));
  if (unknown.length) throw new Error(`prompt: template has unknown slots: ${[...new Set(unknown)].join(', ')}`);
  let text = body.replace(SLOT, (_, k) => slots[k]);
  // An empty optional slot leaves a blank paragraph: collapse runs of blank lines.
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  if (/\{\{|\}\}/.test(text)) throw new Error('prompt: unresolved slot left in the output');
  return { text, sha256: sha256Hex(text).slice(2), slots };
}
