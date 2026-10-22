#!/usr/bin/env node
// Renders every synthetic profile: SVGs, a contact sheet, and PNGs at 32 / 128 / 1024 px (needs rsvg-convert).
// Output goes to fatliners/out/ (gitignored, regenerate any time).
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/index.mjs';
import { allProfiles, history } from '../src/sources/synthetic.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out');
mkdirSync(join(out, 'svg'), { recursive: true });
mkdirSync(join(out, 'png'), { recursive: true });
const profiles = allProfiles();
const count = Number(process.argv[2] ?? profiles.length);
const results = profiles.slice(0, count).map((p) => ({ p, r: generate(history(p)) }));
let rsvg = true;
try { execFileSync('rsvg-convert', ['--version']); } catch { rsvg = false; }

for (const { p, r } of results) {
  writeFileSync(join(out, 'svg', `${p.id}.svg`), r.svg);
  writeFileSync(join(out, 'svg', `${p.id}.icon.svg`), r.icon);
  writeFileSync(join(out, 'svg', `${p.id}.atlas.json`), JSON.stringify(r.atlas, null, 2));
  if (rsvg) {
    execFileSync('rsvg-convert', ['-w', '1024', '-h', '1024', '-o', join(out, 'png', `${p.id}-1024.png`), join(out, 'svg', `${p.id}.svg`)]);
    execFileSync('rsvg-convert', ['-w', '128', '-h', '128', '-o', join(out, 'png', `${p.id}-128.png`), join(out, 'svg', `${p.id}.svg`)]);
    execFileSync('rsvg-convert', ['-w', '32', '-h', '32', '-o', join(out, 'png', `${p.id}-32.png`), join(out, 'svg', `${p.id}.icon.svg`)]);
  }
}

// Contact sheet: one SVG that nests every being, 6 per row, with a small caption.
const cols = 6, cell = 256, pad = 16, cap = 30;
const rows = Math.ceil(results.length / cols);
const W = cols * (cell + pad) + pad, H = rows * (cell + pad + cap) + pad;
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#0d0b14"/>`;
results.forEach(({ p, r }, i) => {
  const x = pad + (i % cols) * (cell + pad), y = pad + Math.floor(i / cols) * (cell + pad + cap);
  sheet += `<svg x="${x}" y="${y}" width="${cell}" height="${cell}" viewBox="0 0 256 256">${r.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>`;
  sheet += `<text x="${x + 4}" y="${y + cell + 19}" fill="#b8b0cc" font-family="Helvetica, Arial, sans-serif" font-size="13">${p.id.replace('syn-', '')} · ${r.dna.roots.material} · ${r.dna.orbit.form} · ${r.dna.bloom.form}</text>`;
});
sheet += '</svg>';
writeFileSync(join(out, 'contact-sheet.svg'), sheet);
if (rsvg) execFileSync('rsvg-convert', ['-o', join(out, 'contact-sheet.png'), join(out, 'contact-sheet.svg')]);

// A 32 px strip: every being as a real 32×32 icon, to check the species reads at PFP size.
const s = 32, gap = 8;
let strip = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${results.length / 3 * (s + gap) + gap} ${3 * (s + gap) + gap}"><rect width="100%" height="100%" fill="#f4f1ea"/>`;
results.forEach(({ r }, i) => {
  const per = results.length / 3;
  strip += `<svg x="${gap + (i % per) * (s + gap)}" y="${gap + Math.floor(i / per) * (s + gap)}" width="${s}" height="${s}" viewBox="0 0 256 256">${r.icon.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>`;
});
strip += '</svg>';
writeFileSync(join(out, 'icons-32.svg'), strip);
if (rsvg) execFileSync('rsvg-convert', ['-o', join(out, 'icons-32.png'), join(out, 'icons-32.svg')]);

console.log(`${results.length} Fatliners → ${out}${rsvg ? ' (PNG at 32/128/1024)' : ' (SVG only: rsvg-convert not found)'}`);
