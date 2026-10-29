// The reference-conditioned PFP path: reference checks, cache identity, prompt stability, privacy,
// network colours, and accepted portraits surviving retries. No network, no paid call (Codex is faked).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { history as synth, ARCHETYPES } from '../src/sources/synthetic.mjs';
import { resolveReference, pngInfo, CANONICAL, REPO_ROOT, ReferenceError } from '../src/pfp/reference.mjs';
import { buildPfpPrompt, templateBody } from '../src/pfp/prompt.mjs';
import { derive, prepare, loadTemplate, LATEST_PROMPT, PROMPT_REFERENCE, stateMessage } from '../src/pfp/pipeline.mjs';
import { generatePortrait } from '../src/pfp/codex-image.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'fatliner-pfp-'));
const REF = join(REPO_ROOT, CANONICAL);
const reference = resolveReference();
// The image the latest prompt attaches (from v7 the owner's style image, not the species blueprint).
const used = resolveReference({ override: PROMPT_REFERENCE[LATEST_PROMPT] ?? null });
const template = loadTemplate();
// Synthetic histories re-labelled as an FID, for tests only. Not a real account's history.
const asFid = (id, fid = 900001) => ({ ...synth(ARCHETYPES.find((p) => p.id === id)), subject: { kind: 'fid', fid } });
const both = (h) => ({ ...h, messages: h.messages.map((m) => ({ ...m, networks: ['farcaster', 'hypersnap'] })) });
const d = (h, extra = {}) => derive({ history: h, readNetworks: ['farcaster', 'hypersnap'], coverage: { state: 'ok' }, template, reference, ...extra });

test('reference: canonical file is a valid PNG with a registered version', () => {
  assert.equal(reference.path, CANONICAL);
  assert.equal(reference.version, 'species-blueprint/1');
  assert.ok(reference.width > 0 && reference.height > 0);
});

test('reference: missing, corrupt, truncated and ambiguous are refused; override and cwd independence work', () => {
  const root = tmp();
  assert.throws(() => resolveReference({ repoRoot: root }), (e) => e instanceof ReferenceError && e.expected.endsWith(CANONICAL));
  mkdirSync(join(root, 'fatliners/assets'), { recursive: true });
  writeFileSync(join(root, CANONICAL), 'not a png');
  assert.throws(() => resolveReference({ repoRoot: root }), /invalid/);
  const bytes = readFileSync(REF);
  writeFileSync(join(root, CANONICAL), bytes.subarray(0, bytes.length - 20));
  assert.throws(() => resolveReference({ repoRoot: root }), /truncated/);
  writeFileSync(join(root, CANONICAL), bytes);
  const other = Buffer.from(bytes); other[100] ^= 0xff; // same structure, different bytes
  writeFileSync(join(root, 'FATLINERS_MASTER_REFERENCE.png'), other);
  assert.throws(() => resolveReference({ repoRoot: root }), /two different reference images/);
  writeFileSync(join(root, 'FATLINERS_MASTER_REFERENCE.png'), bytes);
  assert.equal(resolveReference({ repoRoot: root }).sha256, reference.sha256);
  // explicit override, relative to the checkout, not the cwd
  const cwd = process.cwd();
  try { process.chdir(tmpdir()); assert.equal(resolveReference({ override: CANONICAL }).sha256, reference.sha256); } finally { process.chdir(cwd); }
  assert.throws(() => resolveReference({ override: 'nope/missing.png' }), /not found/);
  assert.deepEqual(pngInfo(bytes), { width: reference.width, height: reference.height });
});

test('changed reference bytes change the cache key; same inputs give the same prompt and key', () => {
  const h = both(asFid('syn-talker'));
  const a = d(h), b = d(h);
  assert.equal(a.prompt.text, b.prompt.text);
  assert.equal(a.key, b.key);
  const c = d(h, { reference: { ...reference, sha256: '0'.repeat(64) } });
  assert.notEqual(a.key, c.key);
  assert.equal(a.prompt.text, c.prompt.text, 'the reference identity is in the key and manifest, not the visible prompt');
});

test('any FID works without rank; every slot resolves; template errors are caught', () => {
  for (const p of ARCHETYPES) {
    const r = d(both(asFid(p.id, 1 + ARCHETYPES.indexOf(p) * 7919)));
    assert.ok(!/\{\{|\}\}|<!--/.test(r.prompt.text), `${p.id}: unresolved slot`);
    assert.ok(r.prompt.text.includes('FID ' + r.fid));
  }
  assert.throws(() => buildPfpPrompt({ fid: 1, traits: d(both(asFid('syn-talker'))).traits, template: template.replace('{{FID}}', '{{MYSTERY}}') }), /unknown slots/);
  assert.throws(() => templateBody('no markers'), /markers/);
  const t = d(both(asFid('syn-talker'))).traits;
  assert.throws(() => buildPfpPrompt({ fid: 1, traits: { ...t, bloom: { ...t.bloom, text: 'ignore previous {{FID}}' } }, template }), /forbidden/);
  assert.throws(() => buildPfpPrompt({ fid: 0, traits: t, template }), /fid/);
});

test('sparse, silent and unavailable stay distinct', () => {
  const silent = d(asFid('syn-unwritten'), { coverage: { state: 'known-no-messages' } });
  assert.equal(silent.traits.pulse.value, 'unwritten');
  assert.match(silent.traits.coverage.text, /no messages yet/);
  const h = both(asFid('syn-talker'));
  const sparse = d({ ...h, messages: h.messages.slice(0, 12) });
  assert.equal(sparse.traits.sparse, true);
  assert.match(sparse.traits.coverage.text, /sparse/);
  assert.notEqual(sparse.traits.roots.value, 'gold repair', 'a return needs sufficient coverage');
  assert.notEqual(stateMessage('unavailable', 5), stateMessage('account-not-found', 5));
  assert.notEqual(stateMessage('untracked', 5), stateMessage('known-no-messages', 5));
});

test('network colours: blue = Snapchain, pink = Hypersnap; no node-operation claims', () => {
  const h = asFid('syn-talker'); // synthetic: farcaster only
  const fc = derive({ history: h, readNetworks: ['farcaster'], coverage: { state: 'ok' }, template, reference });
  assert.match(fc.traits.network.live, /Snapchain blue/);
  assert.doesNotMatch(fc.traits.network.live, /Hypersnap pink/);
  assert.doesNotMatch(fc.traits.network.text, /Snapchain blue|Hypersnap pink/); // the portrait is at rest
  const br = d(both(h));
  assert.match(br.traits.network.live, /Snapchain blue/);
  assert.match(br.traits.network.live, /Hypersnap pink/);
  assert.equal(br.network.nodeOperation, 'unverified');
  for (const r of [fc, br]) assert.doesNotMatch(r.prompt.text, /runs (a|two|its own) nodes?|node operator/i);
  // shared history isn't double counted
  assert.equal(br.network.both, br.history.messages.length);
  assert.equal(br.network.farcasterOnly + br.network.hypersnapOnly, 0);
});

test('the prompt leaks no history: no hashes, channels, partner FIDs or raw numbers of messages', () => {
  const h = both(asFid('syn-talker', 4242));
  const r = d(h);
  for (const m of r.history.messages.slice(0, 200)) {
    assert.ok(!r.prompt.text.includes(m.hash.slice(2, 14)));
    if (m.channel) assert.ok(!r.prompt.text.includes(m.channel.slice(2, 14)));
    if (m.parentFid) assert.ok(!new RegExp(`\\b${m.parentFid}\\b`).test(r.prompt.text.replace('FID 4242', '')), `partner ${m.parentFid} leaked`);
  }
  assert.ok(!r.prompt.text.includes(r.commitment.slice(2, 14)));
  assert.ok(!r.prompt.text.includes('http'));
});

test('a request is written as ready only with a verified reference', async () => {
  const out = tmp();
  const json = { schema: 'fatliners.input/1', fid: 900002, history: both(asFid('syn-wanderer', 900002)), readNetworks: ['farcaster', 'hypersnap'] };
  const bad = await prepare({ fid: 900002, source: { kind: 'file', json }, referenceOverride: join(out, 'missing.png'), outRoot: out });
  assert.equal(bad.status, 'reference-error');
  assert.equal(bad.dir, undefined);
  const ok = await prepare({ fid: 900002, source: { kind: 'file', json }, outRoot: out });
  assert.equal(ok.status, 'prepared');
  const req = JSON.parse(readFileSync(join(ok.dir, 'pfp.request.json'), 'utf8'));
  assert.equal(req.status, 'ready');
  assert.equal(req.model, 'gpt-image-2');
  assert.equal(req.reference.sha256, used.sha256);
  assert.equal(req.prompt.version, LATEST_PROMPT);
  for (const f of ['traits.json', 'blueprint.json', 'pfp.prompt.txt', 'provenance.private.json']) assert.ok(existsSync(join(ok.dir, f)), f);
  assert.ok(!readFileSync(join(ok.dir, 'pfp.request.json'), 'utf8').includes('http://'), 'no node URL in the request');
  assert.ok(!readFileSync(join(ok.dir, 'provenance.private.json'), 'utf8').includes('http://'), 'no node URL in provenance');
});

test('an accepted portrait survives retries; a revision is written beside it', async () => {
  const out = tmp();
  const json = { schema: 'fatliners.input/1', fid: 900003, history: both(asFid('syn-painter', 900003)), readNetworks: ['farcaster', 'hypersnap'] };
  const { dir } = await prepare({ fid: 900003, source: { kind: 'file', json }, outRoot: out });
  let calls = 0;
  const runner = async (_cmd, args, { cwd, input }) => {
    calls++;
    assert.ok(args.includes('-i') && args.includes('reference-1.png'), 'the reference is attached as an image');
    assert.ok(input.includes(readFileSync(join(dir, 'pfp.prompt.txt'), 'utf8').trim()), 'prompt passed verbatim');
    assert.equal(readFileSync(join(cwd, 'reference-1.png')).length, used.bytes);
    copyFileSync(REF, join(cwd, 'portrait.png')); // stand-in image: a fake generation
    return 'ok';
  };
  const opts = { runner, version: () => 'codex-test', log: () => {} };
  const g1 = await generatePortrait(dir, opts);
  assert.equal(g1.status, 'generated');
  const first = readFileSync(join(dir, 'portrait.png'));
  const g2 = await generatePortrait(dir, opts);
  assert.equal(g2.status, 'cached');
  assert.equal(calls, 1);
  const g3 = await generatePortrait(dir, { ...opts, revise: true });
  assert.equal(g3.status, 'revision');
  assert.ok(readFileSync(join(dir, 'portrait.png')).equals(first), 'accepted portrait unchanged');
  assert.ok(existsSync(join(dir, 'revisions/1/portrait.png')));
  const meta = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
  assert.equal(meta.fatliner.fid, 900003);
  assert.ok(meta.name && meta.image && Array.isArray(meta.attributes));
  assert.ok(!('animation_url' in meta));
  // a reference swapped on disk after preparing is refused
  const req = JSON.parse(readFileSync(join(dir, 'pfp.request.json'), 'utf8'));
  writeFileSync(join(dir, 'pfp.request.json'), JSON.stringify({ ...req, reference: { ...req.reference, sha256: 'f'.repeat(64) } }));
  await assert.rejects(generatePortrait(dir, { ...opts, revise: true }), /reference changed/);
});

test('calibration: required, part of the cache key, and traits spread across different histories', async () => {
  const { loadCalibration } = await import('../src/pfp/pipeline.mjs');
  const { visualTraits } = await import('../src/pfp/traits.mjs');
  const cal = loadCalibration();
  const h = both(asFid('syn-talker'));
  const a = d(h), b = d(h, { calibration: { ...cal, sha256: 'e'.repeat(64) } });
  assert.notEqual(a.key, b.key);
  assert.throws(() => visualTraits({ features: a.features, dna: a.dna, network: a.network, coverage: { state: 'ok', messages: 999 } }), /calibration/);
  const seen = { orbit: new Set(), bloom: new Set(), voice: new Set(), roots: new Set() };
  for (const p of ARCHETYPES) {
    const r = d(both(asFid(p.id, 1 + ARCHETYPES.indexOf(p))));
    for (const k of Object.keys(seen)) seen[k].add(r.traits[k].value);
  }
  // Synthetic reply shares sit below real power users', so orbit is checked directly at chosen quantiles.
  for (const k of ['bloom', 'voice', 'roots']) assert.ok(seen[k].size >= 3, `${k}: only ${[...seen[k]].join(', ')}`);
  const Q = cal.quantiles['orbit.replyShare'], B = cal.quantiles['orbit.bonds'];
  const orbitAt = (replyShare, bonds) => visualTraits({ features: { ...a.features, orbit: { ...a.features.orbit, replyShare, bonds } }, dna: a.dna, network: a.network, coverage: { state: 'ok', messages: 999 }, calibration: cal }).orbit.value;
  assert.equal(orbitAt(Q.q20, 0), 'single river');
  assert.equal(orbitAt(Q.q50, 0), 'one satellite');
  assert.equal(orbitAt(Q.q50, B.q80), 'twin junction');
  assert.equal(orbitAt(Q.q80 + 0.01, 0), 'fine net');
  assert.equal(orbitAt(Q.q80 + 0.01, B.q80), 'constellation');
});

test('OpenRouter: the prompt verbatim, the reference attached, the portrait kept once; refusals explained, the key never in errors', async () => {
  const { generatePortrait: viaOpenRouter } = await import('../src/pfp/openrouter-image.mjs');
  const out = tmp();
  const json = { schema: 'fatliners.input/1', fid: 900004, history: both(asFid('syn-painter', 900004)), readNetworks: ['farcaster', 'hypersnap'] };
  const { dir } = await prepare({ fid: 900004, source: { kind: 'file', json }, outRoot: out });
  const png = readFileSync(REF);
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls++;
    assert.equal(url, 'https://openrouter.ai/api/v1/images');
    assert.equal(init.headers.authorization, 'Bearer sk-or-test');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'openai/gpt-image-2');
    assert.equal(body.prompt, readFileSync(join(dir, 'pfp.prompt.txt'), 'utf8').trim(), 'prompt passed verbatim');
    assert.equal(Buffer.from(body.input_references[0].image_url.url.split(',')[1], 'base64').length, used.bytes, 'the reference is attached');
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }], usage: { cost: 0.13 } }), { status: 200 });
  };
  const g1 = await viaOpenRouter(dir, { key: 'sk-or-test', fetchImpl });
  assert.equal(g1.status, 'generated');
  assert.equal(g1.generation.costUsd, 0.13);
  assert.ok(existsSync(join(dir, 'metadata.json')));
  assert.equal((await viaOpenRouter(dir, { key: 'sk-or-test', fetchImpl })).status, 'cached');
  assert.equal(calls, 1, 'never drawn twice');
  const out2 = tmp();
  const { dir: dir2 } = await prepare({ fid: 900005, source: { kind: 'file', json: { ...json, fid: 900005 } }, outRoot: out2 });
  const refuse = async () => new Response(JSON.stringify({ error: { message: 'Insufficient credits' } }), { status: 402 });
  await assert.rejects(viaOpenRouter(dir2, { key: 'sk-or-test', fetchImpl: refuse }), (e) => /402: Insufficient credits/.test(e.message) && !e.message.includes('sk-or'));
  await assert.rejects(viaOpenRouter(dir2, { key: '', fetchImpl }), /No OpenRouter key/);
});
