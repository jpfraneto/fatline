#!/usr/bin/env node
// Contact sheet of every accepted PFP (newest prompt version per FID): fatliners/out/pfp/contact-sheet.png
//   node fatliners/bin/pfp-sheet.mjs [--prompt-version fatliners.pfp-prompt/2] [--cols 4]
// Needs sips (macOS) to shrink tiles and rsvg-convert to rasterize. Read-only on the portraits.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { OUT_ROOT, LATEST_PROMPT } from '../src/pfp/pipeline.mjs';

const { values: a } = parseArgs({ options: { 'prompt-version': { type: 'string', default: LATEST_PROMPT }, cols: { type: 'string', default: '4' }, out: { type: 'string' } } });
const rj = (p) => JSON.parse(readFileSync(p, 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const tiles = [];
for (const f of readdirSync(OUT_ROOT).filter((x) => /^fid-\d+$/.test(x))) {
  const dirs = readdirSync(join(OUT_ROOT, f)).map((k) => join(OUT_ROOT, f, k))
    .filter((d) => existsSync(join(d, 'portrait.png')) && rj(join(d, 'pfp.request.json')).prompt.version === a['prompt-version'])
    .sort((x, y) => statSync(join(y, 'portrait.png')).mtimeMs - statSync(join(x, 'portrait.png')).mtimeMs);
  if (dirs.length) tiles.push({ dir: dirs[0], bp: rj(join(dirs[0], 'blueprint.json')) });
}
if (!tiles.length) { console.error(`no portraits for ${a['prompt-version']}`); process.exit(1); }
tiles.sort((x, y) => x.bp.fid - y.bp.fid);

const T = 256, PAD = 14, CAP = 46, cols = Math.min(Number(a.cols) || 4, tiles.length), rows = Math.ceil(tiles.length / cols);
const W = PAD + cols * (T + PAD), H = 56 + rows * (T + CAP + PAD);
const tmp = mkdtempSync(join(tmpdir(), 'pfp-sheet-'));
const cells = tiles.map((t, i) => {
  const small = join(tmp, `${i}.png`);
  execFileSync('sips', ['-z', String(T * 2), String(T * 2), join(t.dir, 'portrait.png'), '--out', small], { stdio: 'ignore' });
  const x = PAD + (i % cols) * (T + PAD), y = 56 + Math.floor(i / cols) * (T + CAP + PAD);
  const d = t.bp.directions;
  return `<image x="${x}" y="${y}" width="${T}" height="${T}" href="data:image/png;base64,${readFileSync(small).toString('base64')}"/>
  <text x="${x}" y="${y + T + 17}" class="n">${esc(t.bp.name)} <tspan class="d">· FID ${t.bp.fid}</tspan></text>
  <text x="${x}" y="${y + T + 34}" class="d">${esc(`${d.roots} · ${d.orbit} · ${d.bloom}`)}</text>`;
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>.t{font:600 20px Georgia,serif;fill:#efe7dc}.n{font:600 14px Georgia,serif;fill:#efe7dc}.d{font:400 11px Helvetica,Arial,sans-serif;fill:#a39684}</style>
<rect width="100%" height="100%" fill="#14110e"/>
<text x="${PAD}" y="34" class="t">Fatliners · ${esc(a['prompt-version'])} · ${tiles.length} beings from real Farcaster histories</text>
${cells.join('\n')}
</svg>`;
const svgPath = join(tmp, 'sheet.svg');
writeFileSync(svgPath, svg);
const out = a.out ?? join(OUT_ROOT, `contact-sheet-${a['prompt-version'].split('/').pop()}.png`);
execFileSync('rsvg-convert', ['-o', out, svgPath]);
console.log(out);
