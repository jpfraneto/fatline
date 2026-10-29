// Image adapter: Codex CLI's built-in image tool, with the reference attached as an image input (`-i`).
// Node only. This is the ONLY place that knows about the provider.
//
// Why Codex: it runs on the owner's ChatGPT login, so no API key is needed. Codex's imagegen skill names
// its built-in tool as gpt-image-2, but the tool does not report a model per call; generation.json says so.
//
// Rules: a ready request only; the reference on disk must still match the request's hash; the prompt
// file must match its hash. An accepted portrait.png is never replaced: a re-run returns it, and
// --revise writes revisions/<n>/ beside it.

import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from '../hash.mjs';
import { pngInfo, sha256File, REPO_ROOT } from './reference.mjs';
import { metadata } from './pipeline.mjs';

export const PROVIDER = 'codex-cli/built-in-image_gen';
const MODEL_NOTE = 'gpt-image-2, as named by Codex\'s imagegen skill; not reported by the tool per call';

export function wrapperText(promptText, n = 1) {
  const attached = Array.from({ length: n }, (_, i) => `reference-${i + 1}.png as reference image ${i + 1}`).join(', ');
  return [
    'Generate exactly one image with your built-in image generation tool, then stop.',
    `Use the attached ${n === 1 ? 'image' : 'images'} (${attached}) as described in the prompt.`,
    'Pass the prompt between the PROMPT markers to the image tool verbatim. Do not rewrite, shorten or add to it.',
    'Output: one square image.',
    'When the image is generated, copy the generated PNG file to ./portrait.png in the current directory, then print only the absolute path of the original generated file. Do not create or edit any other file.',
    '',
    'PROMPT BEGIN',
    promptText.trim(),
    'PROMPT END',
  ].join('\n');
}

function run(cmd, args, { cwd, input, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => { p.kill('SIGTERM'); reject(new Error(`codex timed out after ${timeoutMs / 1000}s`)); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(`codex exited ${code}: ${out.slice(-400)}`)); });
    p.stdin.end(input);
  });
}

/** Generate (or return the accepted) portrait for a prepared directory. */
export async function generatePortrait(dir, { revise = false, timeoutMs = 600_000, log = () => {}, runner = run, version = () => execFileSync('codex', ['--version']).toString().trim() } = {}) {
  const req = JSON.parse(readFileSync(join(dir, 'pfp.request.json'), 'utf8'));
  if (req.status !== 'ready') throw new Error(`request is not ready (${req.status})`);
  const accepted = join(dir, 'portrait.png');
  if (existsSync(accepted) && !revise) return { status: 'cached', dir, portrait: accepted };

  const prompt = readFileSync(join(dir, 'pfp.prompt.txt'), 'utf8');
  if (sha256Hex(prompt).slice(2) !== req.prompt.sha256) throw new Error('pfp.prompt.txt does not match the request hash');
  if (req.references && req.references[0]?.sha256 !== req.reference.sha256) throw new Error('reference changed: the request\'s references disagree');
  const refs = req.references ?? [req.reference];
  for (const r of refs) {
    if (sha256File(readFileSync(join(REPO_ROOT, r.path))) !== r.sha256) throw new Error(`reference changed on disk since the request was prepared: ${r.path}`);
  }

  const revDir = join(dir, 'revisions');
  const revision = existsSync(accepted) ? 1 + (existsSync(revDir) ? readdirSync(revDir).length : 0) : 0;
  const work = join(dir, `.work-${revision}`);
  mkdirSync(work, { recursive: true });
  refs.forEach((r, i) => copyFileSync(join(REPO_ROOT, r.path), join(work, `reference-${i + 1}.png`)));
  const wrapper = wrapperText(prompt, refs.length);
  const codexVersion = version();
  const started = Date.now();
  log(`FID ${req.fid}: generating with ${PROVIDER} (revision ${revision})…`);
  const out = await runner('codex', ['exec', '--skip-git-repo-check', '-s', 'workspace-write', ...refs.flatMap((_, i) => ['-i', `reference-${i + 1}.png`]), '-'], { cwd: work, input: wrapper, timeoutMs });
  writeFileSync(join(work, 'codex.log'), out);
  const made = join(work, 'portrait.png');
  if (!existsSync(made)) throw new Error(`codex finished but wrote no portrait.png (log: ${join(work, 'codex.log')})`);
  const bytes = readFileSync(made);
  const info = pngInfo(bytes);

  const target = revision === 0 ? dir : join(revDir, String(revision));
  mkdirSync(target, { recursive: true });
  renameSync(made, join(target, 'portrait.original.png'));
  // Normalize to the collection's 1024 × 1024 (sips on macOS). The original is kept beside it.
  try { execFileSync('sips', ['-z', '1024', '1024', join(target, 'portrait.original.png'), '--out', join(target, 'portrait.png')], { stdio: 'ignore' }); }
  catch { copyFileSync(join(target, 'portrait.original.png'), join(target, 'portrait.png')); }
  const final = readFileSync(join(target, 'portrait.png'));
  renameSync(join(work, 'codex.log'), join(target, 'codex.log'));
  const gen = {
    schema: 'fatliners.generation/1', live: true, provider: PROVIDER, codex: codexVersion, model: MODEL_NOTE,
    revision, fid: req.fid, key: req.key, startedAt: started, ms: Date.now() - started,
    promptSha256: req.prompt.sha256, referenceSha256: req.reference.sha256, wrapperSha256: sha256Hex(wrapper).slice(2),
    original: { sha256: sha256File(bytes), ...info }, imageSha256: sha256File(final), size: pngInfo(final),
    caveat: 'Image models are not byte-reproducible. This file is the accepted output; re-running returns it instead of regenerating.',
  };
  writeFileSync(join(target, 'generation.json'), JSON.stringify(gen, null, 2) + '\n');
  if (revision === 0) writeFileSync(join(dir, 'metadata.json'), JSON.stringify(metadata({ dir }), null, 2) + '\n');
  return { status: revision === 0 ? 'generated' : 'revision', dir: target, portrait: join(target, 'portrait.png'), generation: gen };
}
