#!/usr/bin/env node
// Fatliner PFPs, reference-conditioned. Any FID; no rank, tier or mint check.
//
//   node --experimental-sqlite fatliners/bin/pfp.mjs prompt --fid 18350
//   node --experimental-sqlite fatliners/bin/pfp.mjs prompt --fid 2,3,5650 --generate
//   node --experimental-sqlite fatliners/bin/pfp.mjs prompt --input 18350.input.json        (offline, no node)
//   node --experimental-sqlite fatliners/bin/pfp.mjs export --fid 18350 > 18350.input.json
//
// prompt     prepare traits, prompt and request. No image call unless --generate.
//   --reference <png>    override the species reference (default fatliners/assets/FATLINERS_MASTER_REFERENCE.png)
//   --offline            use only the local archive; never read the nodes
//   --only <network>     read one network only (farcaster | hypersnap); the result says so
//   --prompt-version v   default: the latest in src/pfp/pipeline.mjs PROMPTS
//   --generate           also make the image (Codex's built-in image tool, the owner's ChatGPT login)
//   --revise             with --generate: make a new revision even if a portrait was accepted
//   --jobs n             parallel generations (default 3)
//   --snapshot-at ms     cutoff (default: the collection snapshot, 2026-10-22 00:00 UTC)
// export     write a fatliners.input/1 file (text-free history + coverage) to stdout, for offline use.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { relative } from 'node:path';
import { loadConfig } from '../../indexer/src/config.mjs';
import { defaultDbPath } from '../src/sources/archive.mjs';
import { prepare, LATEST_PROMPT, stateMessage, COLLECTION_SNAPSHOT_AT } from '../src/pfp/pipeline.mjs';
import { REPO_ROOT } from '../src/pfp/reference.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const { values: a } = parseArgs({ args: rest, options: {
  fid: { type: 'string' }, input: { type: 'string' }, reference: { type: 'string' }, offline: { type: 'boolean', default: false },
  only: { type: 'string' }, 'prompt-version': { type: 'string', default: LATEST_PROMPT }, generate: { type: 'boolean', default: false },
  revise: { type: 'boolean', default: false }, jobs: { type: 'string', default: '3' }, 'snapshot-at': { type: 'string' },
  'node-farcaster': { type: 'string' }, 'node-hypersnap': { type: 'string' }, quiet: { type: 'boolean', default: false },
} });
const rel = (p) => relative(process.cwd(), p) || '.';
const die = (m) => { console.error(m); process.exit(1); };

function parseFids(s) {
  const fids = String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean).map(Number);
  if (!fids.length || fids.some((f) => !Number.isSafeInteger(f) || f <= 0)) die('--fid must be a positive integer (or a comma list)');
  return fids;
}

function nodeSource() {
  const config = loadConfig();
  return {
    kind: 'nodes', config, dbPath: defaultDbPath(REPO_ROOT), offline: a.offline,
    networks: a.only ? [a.only] : ['farcaster', 'hypersnap'],
    overrides: { farcaster: a['node-farcaster'], hypersnap: a['node-hypersnap'] },
  };
}

if (cmd === 'export') {
  const [fid] = parseFids(a.fid);
  const { historyFromNodes } = await import('../src/sources/node.mjs');
  const src = nodeSource();
  const r = await historyFromNodes(fid, { ...src, snapshotAt: a['snapshot-at'] ? Number(a['snapshot-at']) : COLLECTION_SNAPSHOT_AT });
  if (r.state !== 'ok' && r.state !== 'known-no-messages') die(stateMessage(r.state, fid));
  const readNetworks = Object.entries(r.coverage.networks).filter(([, c]) => c.read).map(([n]) => n);
  process.stdout.write(JSON.stringify({ schema: 'fatliners.input/1', fid, history: r.history, readNetworks, coverage: { ...r.coverage, state: r.state } }) + '\n');
  process.exit(0);
}

if (cmd !== 'prompt') die('usage: pfp.mjs prompt --fid <n>[,<n>…] [--generate] | prompt --input <file> | export --fid <n>');

const snapshotAt = a['snapshot-at'] ? Number(a['snapshot-at']) : COLLECTION_SNAPSHOT_AT;
const jobs = [];
if (a.input) {
  const json = JSON.parse(readFileSync(a.input, 'utf8'));
  jobs.push({ fid: json.fid ?? json.history?.subject?.fid ?? json.subject?.fid, source: { kind: 'file', json } });
} else {
  const src = nodeSource();
  for (const fid of parseFids(a.fid)) jobs.push({ fid, source: src });
}

const results = [];
for (const j of jobs) {
  const r = await prepare({ ...j, referenceOverride: a.reference, promptVersion: a['prompt-version'], snapshotAt, log: a.quiet ? () => {} : (m) => console.error(m) });
  results.push(r);
  if (!r.dir) { console.error(`✗ ${r.message ?? r.status}`); continue; }
  const t = r.traits;
  console.log(`✓ FID ${r.fid} · ${r.name} · ${r.status} · ${t.coverage.messages} posts+reactions · ${t.network.value}`);
  console.log(`  roots ${t.roots.value} · orbit ${t.orbit.value} · voice ${t.voice.value} (${t.voice.temperament}) · pulse ${t.pulse.value} · bloom ${t.bloom.value}`);
  console.log(`  reference ${r.reference.path} (${r.reference.sha256.slice(0, 12)}, ${r.reference.version})`);
  console.log(`  prompt    ${rel(`${r.dir}/pfp.prompt.txt`)}  (sha256 ${r.prompt.sha256.slice(0, 12)})`);
  console.log(`  request   ${rel(`${r.dir}/pfp.request.json`)}`);
}

if (a.generate) {
  const { generatePortrait } = await import('../src/pfp/codex-image.mjs');
  const queue = results.filter((r) => r.dir);
  const n = Math.max(1, Number(a.jobs) || 1);
  let failed = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    for (let r; (r = queue.shift());) {
      try {
        const g = await generatePortrait(r.dir, { revise: a.revise, log: (m) => console.error(m) });
        console.log(`${g.status === 'cached' ? '=' : '★'} FID ${r.fid} ${g.status}: ${rel(g.portrait)}${g.generation ? ` (${Math.round(g.generation.ms / 1000)} s)` : ''}`);
      } catch (err) { failed++; console.error(`✗ FID ${r.fid}: ${err.message}`); }
    }
  }));
  if (failed) process.exit(1);
} else if (results.some((r) => r.dir)) {
  console.log('No image was generated (add --generate). To use a prompt by hand, attach the reference PNG too: a filename in the text is not an attachment.');
}
if (results.some((r) => !r.dir)) process.exit(1);
