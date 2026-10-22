// Volume must not buy beauty. Two checks:
//  1. Across all 36 synthetic beings, the number of drawn marks does not grow with message count.
//  2. The same person at 1/10th the volume (same habits, fewer messages) gets the same trait forms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/index.mjs';
import { allProfiles, ARCHETYPES, history } from '../src/sources/synthetic.mjs';

const marks = (svg) => (svg.match(/<(path|circle|ellipse|rect)\b/g) ?? []).length;
const corr = (xs, ys) => {
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
  return num / den;
};

test('ornament count does not correlate with activity volume', (t) => {
  const rows = allProfiles().map((p) => ({ n: Math.log10(1 + p.n), k: marks(generate(history(p)).svg) }));
  const r = corr(rows.map((x) => x.n), rows.map((x) => x.k));
  t.diagnostic(`correlation(log volume, marks) = ${r.toFixed(3)}`);
  assert.ok(Math.abs(r) < 0.35, `marks correlate with volume: r=${r}`);
  const quiet = rows.filter((x) => x.n < 2), loud = rows.filter((x) => x.n >= 2.5);
  const avg = (a) => a.reduce((s, x) => s + x.k, 0) / a.length;
  t.diagnostic(`quiet avg marks ${avg(quiet).toFixed(1)} vs loud ${avg(loud).toFixed(1)}`);
  assert.ok(avg(quiet) >= 0.85 * avg(loud));
});

test('same habits at 1/10 the volume → same species traits', () => {
  for (const p of ARCHETYPES.filter((x) => x.n >= 300)) {
    const loud = generate(history(p)).dna, quiet = generate(history({ ...p, n: Math.round(p.n / 10) })).dna;
    assert.equal(quiet.temperament, loud.temperament, `${p.id} temperament`);
    assert.equal(quiet.bloom.form, loud.bloom.form, `${p.id} bloom`);
    assert.equal(quiet.voice.finish, loud.voice.finish, `${p.id} finish`);
  }
});

test('the silent and the newcomer are complete beings (line, node, eyes, bloom)', () => {
  for (const id of ['syn-unwritten', 'syn-newcomer']) {
    const { svg } = generate(history(ARCHETYPES.find((p) => p.id === id)));
    assert.match(svg, /-line\)/); assert.match(svg, /-eyes/);
    assert.ok(marks(svg) > 30);
  }
});
