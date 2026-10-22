#!/usr/bin/env node
// Generate a Fatliner from a real FID's history in the Fatline archive (read-only).
//   node --experimental-sqlite bin/atlas.mjs --fid 18350 [--registered-at <ms>] [--db <path>] [--owner]
// --registered-at: the FID's onchain ID_REGISTER time (GET /v1/onChainEventsByFid?fid=N&event_type=EVENT_TYPE_ID_REGISTER,
//   blockTimestamp × 1000). Without it, age is a lower bound: the oldest message the node still holds.
// Writes to fatliners/out/fid-<N>.* (gitignored). Nothing is sent anywhere.
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { generate } from '../src/index.mjs';
import { readArchive, defaultDbPath } from '../src/sources/archive.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values: a } = parseArgs({ options: {
  fid: { type: 'string' }, db: { type: 'string', default: defaultDbPath(join(here, '../..')) },
  'registered-at': { type: 'string' }, 'snapshot-at': { type: 'string' }, owner: { type: 'boolean', default: false },
} });
const fid = Number(a.fid);
if (!Number.isSafeInteger(fid) || fid <= 0) { console.error('usage: --fid <n>'); process.exit(1); }
const snapshotAt = a['snapshot-at'] ? Number(a['snapshot-at']) : Date.now();
const { history, sources } = await readArchive(a.db, fid, { snapshotAt, registeredAt: a['registered-at'] ? Number(a['registered-at']) : null });
if (!history.messages.length) console.warn(`FID ${fid}: no merged messages in the archive. It will be an "unwritten" Fatliner.`);
const r = generate(history, { view: a.owner ? 'owner' : 'public' });
const out = join(here, '../out');
mkdirSync(out, { recursive: true });
const base = join(out, `fid-${fid}`);
writeFileSync(`${base}.svg`, r.svg);
writeFileSync(`${base}.icon.svg`, r.icon);
writeFileSync(`${base}.atlas.json`, JSON.stringify({ ...r.atlas, sources }, null, 2));
try {
  execFileSync('rsvg-convert', ['-w', '1024', '-h', '1024', '-o', `${base}-1024.png`, `${base}.svg`]);
  execFileSync('rsvg-convert', ['-w', '32', '-h', '32', '-o', `${base}-32.png`, `${base}.icon.svg`]);
} catch { /* PNGs are optional */ }
const d = r.atlas.dimensions;
console.log(`FID ${fid} · ${history.messages.length} messages used · networks ${Object.entries(r.atlas.snapshot.networks).map(([n, v]) => `${n}:${v ? v.count : '—'}`).join(' ')}`);
console.log(`commitment ${r.commitment}`);
for (const k of Object.keys(d)) console.log(`${k.padEnd(6)} ${String(d[k].trait).padEnd(12)} ${d[k].reading}`);
console.log(`→ ${base}.svg / .atlas.json`);
