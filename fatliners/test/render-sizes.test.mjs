// Rasterizes at 32, 128 and 1024 px with rsvg-convert (skipped when it isn't installed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generate } from '../src/index.mjs';
import { ARCHETYPES, history } from '../src/sources/synthetic.mjs';

let rsvg = true;
try { execFileSync('rsvg-convert', ['--version']); } catch { rsvg = false; }

test('renders as valid images at 32, 128 and 1024 px', { skip: !rsvg && 'rsvg-convert not installed' }, () => {
  for (const p of ARCHETYPES) {
    const r = generate(history(p));
    for (const [svg, px] of [[r.icon, 32], [r.svg, 128], [r.svg, 1024]]) {
      const png = execFileSync('rsvg-convert', ['-w', String(px), '-h', String(px)], { input: svg });
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      assert.equal(png.readUInt32BE(16), px); assert.equal(png.readUInt32BE(20), px);
    }
  }
});

test('svg is self-contained: no external references, no scripts, no text', () => {
  for (const p of ARCHETYPES) {
    const { svg, icon } = generate(history(p));
    for (const s of [svg, icon]) {
      assert.ok(!/href=|<script|<image|<text|@import|url\((?!#)/.test(s), p.id);
    }
  }
});
