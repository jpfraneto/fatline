#!/usr/bin/env node
// Calibrate the PFP trait thresholds on real histories, so traits spread across the people who will
// actually mint, instead of absolute cut-offs set on synthetic data (where every power user lands on
// the same side). Writes fatliners/calibration/<name>.json: the sample, and the quantiles of each ratio.
//
//   node --experimental-sqlite fatliners/bin/pfp-calibrate.mjs --name pfp-3 --sample 60 --max-fid 20000 --fids 2,3,8 --jobs 4
//
// The sample: --fids (named) + --sample N FIDs drawn by a seeded PRNG from 1..max-fid. Accounts with fewer than
// --min-active posts + reactions are left out (a quiet account's ratios are noise). Reads our nodes like
// `prompt` does (resumable backfill, no tail list). Only quantiles of ratios are stored, never histories.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../../indexer/src/config.mjs';
import { defaultDbPath } from '../src/sources/archive.mjs';
import { historyFromNodes } from '../src/sources/node.mjs';
import { validateHistory } from '../src/history.mjs';
import { extractFeatures } from '../src/features.mjs';
import { prng } from '../src/prng.mjs';
import { REPO_ROOT } from '../src/pfp/reference.mjs';
import { COLLECTION_SNAPSHOT_AT } from '../src/pfp/pipeline.mjs';
import { CALIBRATED_FEATURES } from '../src/pfp/traits.mjs';

const { values: a } = parseArgs({ options: {
  name: { type: 'string', default: 'pfp-3' }, sample: { type: 'string', default: '60' }, 'max-fid': { type: 'string', default: '20000' },
  fids: { type: 'string', default: '' }, jobs: { type: 'string', default: '4' }, 'min-active': { type: 'string', default: '500' },
  seed: { type: 'string', default: 'fatliners-calibration-1' },
} });
const r = prng(a.seed, 'sample');
const named = a.fids.split(',').filter(Boolean).map(Number);
const drawn = new Set();
while (drawn.size < Number(a.sample)) drawn.add(r.int(1, Number(a['max-fid'])));
const queue = [...new Set([...named, ...drawn])];
const config = loadConfig(), dbPath = defaultDbPath(REPO_ROOT);
const rows = [], skipped = [];

await Promise.all(Array.from({ length: Number(a.jobs) }, async () => {
  for (let fid; (fid = queue.shift()) != null;) {
    try {
      const got = await historyFromNodes(fid, { config, dbPath, snapshotAt: COLLECTION_SNAPSHOT_AT });
      const h = validateHistory(got.history);
      const active = h.messages.filter((m) => m.kind !== 'link').length;
      if (got.state !== 'ok' || active < Number(a['min-active'])) { skipped.push({ fid, state: got.state, active }); continue; }
      const f = extractFeatures(h);
      rows.push({ fid, f });
      console.error(`FID ${fid}: ${active} active · ${rows.length} kept`);
    } catch (err) { skipped.push({ fid, error: String(err.message).slice(0, 100) }); console.error(`FID ${fid}: ${err.message}`); }
  }
}));

const pick = (f, path) => path.split('.').reduce((o, k) => o[k], f);
const q = (xs, p) => { const s = [...xs].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i); return Math.round((s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)) * 1e4) / 1e4; };
const quantiles = Object.fromEntries(CALIBRATED_FEATURES.map((path) => {
  const xs = rows.map((x) => pick(x.f, path));
  return [path, { q20: q(xs, 0.2), q33: q(xs, 1 / 3), q50: q(xs, 0.5), q67: q(xs, 2 / 3), q80: q(xs, 0.8) }];
}));
const out = {
  schema: 'fatliners.calibration/1', name: a.name, snapshotAt: COLLECTION_SNAPSHOT_AT,
  sample: { how: `named FIDs + ${a.sample} drawn from 1..${a['max-fid']} with prng("${a.seed}"), kept if ≥ ${a['min-active']} posts + reactions`, named, kept: rows.map((x) => x.fid).sort((x, y) => x - y), skipped: skipped.length },
  note: 'A proxy for the minting population until ranking.tsv exists. Recalibrate on the real top 777 (a new name and traits version).',
  quantiles,
};
mkdirSync(join(REPO_ROOT, 'fatliners/calibration'), { recursive: true });
const path = join(REPO_ROOT, 'fatliners/calibration', `${a.name}.json`);
writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
console.log(`${path}: ${rows.length} accounts kept, ${skipped.length} skipped`);
