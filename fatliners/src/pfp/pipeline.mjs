// FID → history (our nodes) → features → DNA → PFP traits → prompt → request manifest → (optional) portrait.
// Node only. Each stage writes its own file, so a stage can be re-run without the ones before it.
//
// Output: fatliners/out/pfp/fid-<N>/<key>/  where key = hash(fid, commitment, traits version, prompt version,
// reference sha256). Change any of them and you get a new directory; nothing accepted is overwritten.
//
//   traits.json              visual choices + the evidence (or seed) behind each
//   blueprint.json           the individual's fixed identity and directions
//   pfp.prompt.txt           the prompt, ready to use WITH the reference image attached
//   pfp.request.json         our local, provider-neutral request manifest (not OpenAI's HTTP schema)
//   provenance.private.json  coverage, per-network counts and roots, sources (labels only). Not public.
//   history.private.json     the text-free history snapshot used (message hashes). Not public.
//   portrait.png, metadata.json, generation.json   only after an accepted generation

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical } from '../canonical.mjs';
import { sha256Hex } from '../hash.mjs';
import { validateHistory, commitment as commit, provenance, HISTORY_SCHEMA } from '../history.mjs';
import { extractFeatures, FEATURES_VERSION } from '../features.mjs';
import { buildDna, DNA_VERSION } from '../dna.mjs';
import { visualTraits, networkEvidence, attributes, TRAITS_VERSION } from './traits.mjs';
import { buildPfpPrompt } from './prompt.mjs';
import { resolveReference, referenceRecord, REPO_ROOT, STYLE, FAMILY_SHEET, ASTER } from './reference.mjs';
import { beingName, NAME_VERSION } from './name.mjs';

export const PROMPTS = {
  'fatliners.pfp-prompt/1': 'pfp-1.prompt.md',  // the owner's wording
  'fatliners.pfp-prompt/2': 'pfp-2.prompt.md',  // + collection style, framing, soft light, flat backdrop
  'fatliners.pfp-prompt/3': 'pfp-3.prompt.md',  // + one fixed light, finer paths, near-black irises, muted backdrop
  'fatliners.pfp-prompt/4': 'pfp-4.prompt.md',  // + mouth a seam (no lips), basalt-dark irises, readable eye expression
  'fatliners.pfp-prompt/5': 'pfp-5.prompt.md',  // + five bold differences first, seeded pose (the canon)
  'fatliners.pfp-prompt/6': 'pfp-6.prompt.md',  // the being at rest (unlit veins, no network colour), living skin, varied faces
  'fatliners.pfp-prompt/7': 'pfp-7.prompt.md',  // the figurine look: the owner's Cloud Ruins image as the reference, a prop from the history
  'fatliners.pfp-prompt/8': 'pfp-8.prompt.md',  // the family: Aster's master sheet (the skeleton) + Aster (the photograph)
};
export const CALIBRATION = 'pfp-5';
// Prompts that use a different reference image than the species blueprint.
export const PROMPT_REFERENCE = { 'fatliners.pfp-prompt/7': STYLE, 'fatliners.pfp-prompt/8': FAMILY_SHEET };
// Prompts that attach more than one image, in order, each with its role. The first is PROMPT_REFERENCE's.
export const PROMPT_REFERENCES = {
  'fatliners.pfp-prompt/8': [[FAMILY_SHEET, 'reference image 1: the family sheet (the skeleton)'], [ASTER, 'reference image 2: Aster (how a member is photographed)']],
};

export function loadCalibration(name = CALIBRATION) {
  const text = readFileSync(join(REPO_ROOT, 'fatliners/calibration', `${name}.json`), 'utf8');
  return { ...JSON.parse(text), sha256: sha256Hex(text).slice(2) };
}
export const LATEST_PROMPT = Object.keys(PROMPTS).at(-1);
export const MODEL = 'gpt-image-2';
// The collection's default cutoff. The commitment (and so the seed, name and pose) depends on it, so a
// moving "now" would give a different being on every run. Changing it is a new collection snapshot.
export const COLLECTION_SNAPSHOT_AT = Date.UTC(2026, 9, 22);
export const OUT_ROOT = join(REPO_ROOT, 'fatliners/out/pfp');

const write = (p, obj) => writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) + '\n');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function loadTemplate(version = LATEST_PROMPT) {
  const file = PROMPTS[version];
  if (!file) throw new Error(`unknown prompt version ${version}. Known: ${Object.keys(PROMPTS).join(', ')}`);
  return readFileSync(join(REPO_ROOT, 'fatliners/prompts', file), 'utf8');
}

/** Accepts fatliners.input/1 (GENERATOR.md) or a bare fatliners.history/1. Returns { history, readNetworks, coverage }. */
export function fromInputFile(json) {
  const raw = json.schema === 'fatliners.input/1' ? json.history : json;
  if (raw?.schema !== HISTORY_SCHEMA) throw new Error('input must be fatliners.input/1 or fatliners.history/1');
  const history = validateHistory(raw);
  const readNetworks = json.readNetworks ?? [...new Set(history.messages.flatMap((m) => m.networks))];
  return { history, readNetworks, coverage: json.coverage ?? { state: history.messages.length ? 'ok' : 'known-no-messages', source: 'input-file' } };
}

/** Pure part: history → everything the prompt needs. */
export function derive({ history: rawHistory, readNetworks, coverage, promptVersion = LATEST_PROMPT, template, reference, calibration = loadCalibration(), accepted = false }) {
  const history = validateHistory(rawHistory);
  if (history.subject.kind !== 'fid') throw new Error('PFP prompts are for FIDs');
  const fid = history.subject.fid;
  const features = extractFeatures(history);
  const commitment = commit(history);
  const dna = buildDna(features, { subject: history.subject, commitment });
  const network = networkEvidence(history, readNetworks);
  const posts = history.messages.filter((m) => m.kind !== 'link').length;
  const traits = visualTraits({ features, dna, network, coverage: { state: coverage.state ?? 'ok', messages: posts }, calibration });
  const prompt = buildPfpPrompt({ fid, traits, template, accepted });
  const versions = { history: HISTORY_SCHEMA, features: FEATURES_VERSION, dna: DNA_VERSION, traits: TRAITS_VERSION, calibration: `${calibration.name}@${calibration.sha256.slice(0, 12)}`, prompt: promptVersion, name: NAME_VERSION };
  const key = sha256Hex(canonical({ fid, commitment, traits: TRAITS_VERSION, calibration: calibration.sha256, prompt: promptVersion, reference: reference.sha256 })).slice(2, 18);
  const name = beingName(dna.seed);
  return { fid, history, features, commitment, dna, network, traits, prompt, versions, key, name };
}

/**
 * Prepare (never generates). Returns { dir, status, files, ... }.
 * source: { kind: 'nodes', ... } uses our nodes; { kind: 'file', json } uses an exported input.
 */
export async function prepare({ fid, source, referenceOverride = null, promptVersion = LATEST_PROMPT, outRoot = OUT_ROOT, snapshotAt = COLLECTION_SNAPSHOT_AT, log = () => {} }) {
  // Stage 1: the reference. If it fails, history can still be read, but no request is marked ready.
  let reference = null, referenceError = null, extra = [];
  try {
    reference = resolveReference({ override: referenceOverride ?? PROMPT_REFERENCE[promptVersion] ?? null });
    extra = referenceOverride ? [] : (PROMPT_REFERENCES[promptVersion] ?? []).slice(1).map(([path, role]) => ({ ...resolveReference({ override: path }), role }));
  } catch (err) { referenceError = err; }

  // Stage 2: history.
  let got;
  if (source.kind === 'file') got = { ...fromInputFile(source.json), sources: [] };
  else {
    const { historyFromNodes } = await import('../sources/node.mjs');
    const r = await historyFromNodes(fid, { ...source, snapshotAt, log });
    got = { history: r.history, readNetworks: Object.entries(r.coverage.networks).filter(([, c]) => c.read).map(([n]) => n), coverage: { ...r.coverage, state: r.state }, sources: r.sources };
    if (r.state !== 'ok' && r.state !== 'known-no-messages') {
      return { status: r.state, fid, coverage: got.coverage, message: stateMessage(r.state, fid) };
    }
  }
  if (referenceError) {
    return { status: 'reference-error', fid, coverage: got.coverage, message: `${referenceError.message} (expected at ${referenceError.expected}). History was read; the prompt was not written.` };
  }

  // Stage 3–5: traits, prompt, manifests.
  const template = loadTemplate(promptVersion);
  // Every attached image is part of the cache key: change one and it is a new request.
  const keyRef = extra.length ? { sha256: sha256Hex([reference.sha256, ...extra.map((r) => r.sha256)].join(':')).slice(2) } : reference;
  const d = derive({ history: got.history, readNetworks: got.readNetworks, coverage: got.coverage, promptVersion, template, reference: keyRef });
  const dir = join(outRoot, `fid-${d.fid}`, d.key);
  mkdirSync(dir, { recursive: true });
  const ref = referenceRecord(reference);

  write(join(dir, 'history.private.json'), d.history);
  write(join(dir, 'traits.json'), { schema: 'fatliners.pfp-traits-file/1', fid: d.fid, versions: d.versions, traits: d.traits, attributes: attributes(d.traits) });
  write(join(dir, 'blueprint.json'), {
    schema: 'fatliners.blueprint/1', fid: d.fid, name: d.name, nameStatus: 'provisional (uniqueness across the collection not checked)',
    seed: d.dna.seed, commitment: d.commitment, versions: d.versions,
    identity: d.traits.identity,
    directions: Object.fromEntries(['roots', 'orbit', 'voice', 'pulse', 'bloom', 'network'].map((k) => [k, d.traits[k].value])),
  });
  write(join(dir, 'pfp.prompt.txt'), d.prompt.text);
  write(join(dir, 'pfp.request.json'), {
    schema: 'fatliners.pfp-request/1',
    note: 'Our local contract. Not an OpenAI HTTP payload. The provider adapter attaches the reference image bytes.',
    status: 'ready',
    model: MODEL,
    fid: d.fid,
    key: d.key,
    prompt: { file: 'pfp.prompt.txt', sha256: d.prompt.sha256, version: promptVersion },
    reference: { ...ref, role: PROMPT_REFERENCES[promptVersion]?.[0][1] ?? (promptVersion in PROMPT_REFERENCE ? 'reference image 1: style' : 'reference image 1: species authority'), attach: 'required' },
    // All attached images, in order (the first is `reference`). The adapters attach every one.
    references: [{ ...ref, role: PROMPT_REFERENCES[promptVersion]?.[0][1] ?? 'reference image 1' }, ...extra.map((r) => ({ ...referenceRecord(r), role: r.role }))],
    snapshot: { commitment: d.commitment, snapshotAt: d.history.snapshotAt },
    versions: d.versions,
    output: { size: '1024x1024', format: 'png', count: 1, background: 'dark, opaque' },
  });
  write(join(dir, 'provenance.private.json'), {
    schema: 'fatliners.provenance/1', fid: d.fid, commitment: d.commitment,
    snapshotAt: d.history.snapshotAt, registeredAt: d.history.registeredAt,
    networks: provenance(d.history), evidence: d.network,
    coverage: got.coverage, sources: got.sources,
    caveats: [
      'A time cutoff is not an atomic cross-network snapshot.',
      'The commitment binds the message set we read; it does not prove that set is the complete history (pruning, deletes).',
      'Messages observed on both networks are history held by both, not proof of running two nodes.',
    ],
  });
  const portrait = existsSync(join(dir, 'portrait.png'));
  return { status: portrait ? 'generated' : 'prepared', fid: d.fid, dir, key: d.key, name: d.name, traits: d.traits, prompt: d.prompt, coverage: got.coverage, reference: ref };
}

export function stateMessage(state, fid) {
  return {
    'account-not-found': `FID ${fid}: no ID_REGISTER event on our node. This FID doesn't exist (yet).`,
    unavailable: `FID ${fid}: none of our nodes answered. Nothing was generated.`,
    untracked: `FID ${fid}: not in the local archive, and --offline forbids reading the nodes.`,
    'known-no-messages': `FID ${fid}: the account exists but holds no messages.`,
  }[state] ?? state;
}

/** NFT metadata, written only after a portrait exists. */
export function metadata({ dir, imageUri = 'portrait.png' }) {
  const traits = readJson(join(dir, 'traits.json'));
  const bp = readJson(join(dir, 'blueprint.json'));
  const req = readJson(join(dir, 'pfp.request.json'));
  const gen = readJson(join(dir, 'generation.json'));
  return {
    name: bp.name,
    description: `A Fatliner drawn from the Farcaster history of FID ${bp.fid}. Its traits are an artistic reading of activity patterns, not a biography. Not a proof of minting, funding or node operation.`,
    image: imageUri,
    attributes: traits.attributes,
    fatliner: {
      version: 'fatliners.metadata/1', fid: bp.fid, commitment: bp.commitment, versions: bp.versions,
      promptSha256: req.prompt.sha256, referenceSha256: req.reference.sha256,
      generation: { model: gen.model, provider: gen.provider, revision: gen.revision }, imageSha256: gen.imageSha256,
    },
  };
}
