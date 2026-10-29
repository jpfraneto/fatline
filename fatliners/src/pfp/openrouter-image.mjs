// Image adapter: OpenRouter's image API (POST /api/v1/images), with the reference attached as an input reference.
// Runs anywhere with a key (a server, when a Fatliner hatches): no Codex, no ChatGPT login. The other adapter,
// codex-image.mjs, does the same on the owner's computer.
//
// Same rules as codex-image.mjs: a ready request only; the reference on disk and the prompt must match their hashes;
// an accepted portrait.png is never replaced (a re-run returns it). A failed generation is not charged (OpenRouter
// returns 502); the cost of a good one is kept in generation.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from '../hash.mjs';
import { pngInfo, sha256File, REPO_ROOT } from './reference.mjs';
import { metadata } from './pipeline.mjs';

export const PROVIDER = 'openrouter/api/v1/images';
export const DEFAULT_MODEL = 'openai/gpt-image-2.5-sunburst'; // the model Aster, the family sheet and its members are drawn with
const ENDPOINT = 'https://openrouter.ai/api/v1/images';

/** Generate (or return the accepted) portrait for a prepared directory. key: an OpenRouter API key, never logged. */
export async function generatePortrait(dir, { key, model = DEFAULT_MODEL, fetchImpl = fetch, timeoutMs = 300_000, log = () => {} } = {}) {
  if (!key) throw new Error('No OpenRouter key.');
  const req = JSON.parse(readFileSync(join(dir, 'pfp.request.json'), 'utf8'));
  if (req.status !== 'ready') throw new Error(`request is not ready (${req.status})`);
  const accepted = join(dir, 'portrait.png');
  if (existsSync(accepted)) return { status: 'cached', dir, portrait: accepted };

  const prompt = readFileSync(join(dir, 'pfp.prompt.txt'), 'utf8');
  if (sha256Hex(prompt).slice(2) !== req.prompt.sha256) throw new Error('pfp.prompt.txt does not match the request hash');
  // Every attached image, in the order the prompt names them; each must still be the bytes the request recorded.
  if (req.references && req.references[0]?.sha256 !== req.reference.sha256) throw new Error('reference changed: the request\'s references disagree');
  const refs = (req.references ?? [req.reference]).map((r) => {
    const bytes = readFileSync(join(REPO_ROOT, r.path));
    if (sha256File(bytes) !== r.sha256) throw new Error(`reference changed on disk since the request was prepared: ${r.path}`);
    return bytes;
  });

  const started = Date.now();
  log(`FID ${req.fid}: generating with ${PROVIDER} (${model})…`);
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Fatline' },
    body: JSON.stringify({
      model, prompt: prompt.trim(), n: 1, aspect_ratio: '1:1', quality: 'high',
      // The prompt calls them "reference image 1", "2"…: attached here in that order.
      input_references: refs.map((b) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b.toString('base64')}` } })),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${String(out.error?.message ?? out.error ?? '').slice(0, 300)}`);
  const b64 = out.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenRouter answered without an image.');
  const bytes = Buffer.from(b64, 'base64');
  const info = pngInfo(bytes); // throws if it is not a PNG

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'portrait.original.png'), bytes);
  writeFileSync(accepted, bytes);
  const gen = {
    schema: 'fatliners.generation/1', live: true, provider: PROVIDER, model,
    revision: 0, fid: req.fid, key: req.key, startedAt: started, ms: Date.now() - started,
    promptSha256: req.prompt.sha256, referenceSha256: req.reference.sha256, referencesSha256: (req.references ?? [req.reference]).map((r) => r.sha256),
    original: { sha256: sha256File(bytes), ...info }, imageSha256: sha256File(bytes), size: info,
    costUsd: out.usage?.cost ?? null,
    caveat: 'Image models are not byte-reproducible. This file is the accepted output; re-running returns it instead of regenerating.',
  };
  writeFileSync(join(dir, 'generation.json'), JSON.stringify(gen, null, 2) + '\n');
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify(metadata({ dir }), null, 2) + '\n');
  return { status: 'generated', dir, portrait: accepted, generation: gen };
}
