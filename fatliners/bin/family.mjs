#!/usr/bin/env node
// The family sheet: the master sprite every Fatliner is drawn from. Made once, from Aster (the first Fatliner, the
// one the owner chose as the look): the same being shown as a model sheet, in plain base stone, with nothing that
// belongs to one individual. The pipeline (prompt v8) then attaches this sheet (the skeleton) and Aster's portrait
// (the photograph) to every Fatliner, so they all come out as one family.
//
//   node fatliners/bin/family.mjs --key-file /root/.fatline/openrouter.key --out <dir> [--model m] [--n 2]
//
// The key is read from a file and never printed. Each candidate is written as family-<i>.png with family.json (the
// prompt, the model, the cost). A person picks one and commits it as fatliners/assets/FATLINE_FAMILY_SHEET.png.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_ROOT, pngInfo, sha256File } from '../src/pfp/reference.mjs';

export const ASTER = 'fatliners/assets/FATLINE_ASTER.png';
export const FAMILY_MODEL = 'openai/gpt-image-2.5-sunburst'; // the model Aster was drawn with

export const FAMILY_PROMPT = `A character model sheet of the little being in the attached image (Aster, the first Fatliner). This sheet is the master sprite of its whole family: every future member will be built on exactly this body.

Draw the SAME being with exactly its proportions, shown five times on one sheet, evenly spaced on a plain warm light-grey studio backdrop with soft even light and a soft contact shadow under each:
1. front view, sitting cross-legged, hands resting in its lap;
2. three-quarter view, sitting the same way;
3. side profile, sitting;
4. back view, sitting;
5. a close-up of the head from the front.

Keep exactly from the attached image: the huge, smooth, slightly egg-shaped round head, about twice as wide as the body; no nose, no ears, no hair; two small, round, glossy dark eyes set low and wide apart; a tiny soft curved smile; one thin line running across the forehead from one side and ending at the temple on the viewer's right in a small round light; the small, soft, chubby body with short round arms, mitten-like hands without visible fingers, short round legs and round feet; the scale and finish of a hand-made collectible stone figurine, photographed as a real miniature.

Base form only: plain, smooth, warm pale ivory stone with no veins, no cracks, no kintsugi, no moss, no flowers, no crystals and nothing on the head; the forehead line glows soft pale white. No props, no clothes, no jewellery, no background scenery. Every figure identical in identity, only the viewing angle changes.

No text, letters, numbers, labels, arrows or logos anywhere.`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: a } = parseArgs({ options: { 'key-file': { type: 'string' }, out: { type: 'string' }, model: { type: 'string', default: FAMILY_MODEL }, n: { type: 'string', default: '2' } } });
  if (!a['key-file'] || !a.out) { console.error('usage: family.mjs --key-file <file> --out <dir> [--model m] [--n 2]'); process.exit(1); }
  const key = readFileSync(a['key-file'], 'utf8').trim();
  const aster = readFileSync(join(REPO_ROOT, ASTER));
  pngInfo(aster);
  mkdirSync(a.out, { recursive: true });
  const n = Math.min(4, Math.max(1, Number(a.n) || 1));
  const started = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/images', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Fatline' },
    body: JSON.stringify({ model: a.model, prompt: FAMILY_PROMPT, n, aspect_ratio: '3:2', quality: 'high',
      input_references: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${aster.toString('base64')}` } }] }),
    signal: AbortSignal.timeout(600_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`OpenRouter ${res.status}: ${String(out.error?.message ?? out.error ?? '').slice(0, 300)}`); process.exit(1); }
  const files = (out.data ?? []).map((d, i) => {
    const bytes = Buffer.from(d.b64_json, 'base64');
    const f = join(a.out, `family-${i + 1}.png`);
    writeFileSync(f, bytes);
    return { file: f, sha256: sha256File(bytes), ...pngInfo(bytes) };
  });
  writeFileSync(join(a.out, 'family.json'), JSON.stringify({ schema: 'fatliners.family/1', model: a.model, prompt: FAMILY_PROMPT, reference: { path: ASTER, sha256: sha256File(aster) }, ms: Date.now() - started, costUsd: out.usage?.cost ?? null, files }, null, 2) + '\n');
  console.log(`${files.length} candidates in ${a.out} (${Math.round((Date.now() - started) / 1000)} s, $${out.usage?.cost ?? '?'})`);
}
