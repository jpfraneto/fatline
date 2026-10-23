// The species reference image: find it, check it's a real PNG, hash its bytes. Node only.
//
// Resolution (paths relative to the checkout, never the process's cwd):
//   1. --reference <path>                                   explicit override
//   2. fatliners/assets/FATLINERS_MASTER_REFERENCE.png      canonical
//   3. FATLINERS_MASTER_REFERENCE.png at the repo root      where the handoff dropped it
// If 2 and 3 both exist with different bytes, that's ambiguous: we stop and say so.
// No other directory is searched.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const CANONICAL = 'fatliners/assets/FATLINERS_MASTER_REFERENCE.png';
export const ROOT_COPY = 'FATLINERS_MASTER_REFERENCE.png';
export const STYLE = 'fatliners/assets/FATLINERS_STYLE_REFERENCE.png';

// Known references. Replacing the image means a new entry here (a new reference version), never an edit.
export const REFERENCE_VERSIONS = {
  '354bee988e0ec602b5b5d46f2e1c1f0ec24ad8b978bfeb0cccd2fb6c9571ce56': 'species-blueprint/1',
  // The owner's "Sunset Gathering in the Cloud Ruins": the figurine look, from prompt v7 on.
  'c92ecdb2dd138d4837996371cbf3bc834f7e876063960057002fdcb400abf7e4': 'style-cloud-ruins/1',
};

export class ReferenceError extends Error {
  constructor(message, expected) { super(message); this.name = 'ReferenceError'; this.expected = expected; }
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's IHDR, or throws. Also checks the file ends with IEND (not truncated). */
export function pngInfo(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG (bad signature)');
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') throw new Error('not a PNG (no IHDR)');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height) throw new Error('PNG has zero dimensions');
  if (bytes.toString('latin1', bytes.length - 8, bytes.length - 4) !== 'IEND') throw new Error('PNG is truncated (no IEND)');
  return { width, height };
}

export function sha256File(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function load(abs, repoRoot) {
  let bytes;
  try { bytes = readFileSync(abs); } catch (err) { throw new ReferenceError(`reference not readable: ${err.code ?? err.message}`, abs); }
  let info;
  try { info = pngInfo(bytes); } catch (err) { throw new ReferenceError(`reference invalid: ${err.message}`, abs); }
  const sha256 = sha256File(bytes);
  const rel = relative(repoRoot, abs);
  return {
    path: rel.startsWith('..') ? abs : rel, absPath: abs, sha256, bytes: bytes.length, ...info, mime: 'image/png',
    version: REFERENCE_VERSIONS[sha256] ?? `unregistered/${sha256.slice(0, 12)}`,
  };
}

/** Resolve and validate. Throws ReferenceError with the expected path when missing, invalid or ambiguous. */
export function resolveReference({ override = null, repoRoot = REPO_ROOT } = {}) {
  if (override) {
    const abs = isAbsolute(override) ? override : resolve(repoRoot, override);
    if (!existsSync(abs)) throw new ReferenceError(`reference not found: ${override}`, abs);
    return { ...load(abs, repoRoot), selectedBy: 'override' };
  }
  const canon = join(repoRoot, CANONICAL), root = join(repoRoot, ROOT_COPY);
  const hasCanon = existsSync(canon), hasRoot = existsSync(root);
  if (hasCanon && hasRoot) {
    const a = load(canon, repoRoot), b = load(root, repoRoot);
    if (a.sha256 !== b.sha256) {
      throw new ReferenceError(`two different reference images: ${CANONICAL} (${a.sha256.slice(0, 12)}) and ${ROOT_COPY} (${b.sha256.slice(0, 12)}). Remove one or pass --reference.`, canon);
    }
    return { ...a, selectedBy: 'canonical' };
  }
  if (hasCanon) return { ...load(canon, repoRoot), selectedBy: 'canonical' };
  if (hasRoot) return { ...load(root, repoRoot), selectedBy: 'repo-root' };
  throw new ReferenceError(`reference image missing. Expected ${CANONICAL}`, canon);
}

/** What manifests record (no absolute paths, no bytes). */
export const referenceRecord = (r) => ({ path: r.path, sha256: r.sha256, width: r.width, height: r.height, bytes: r.bytes, version: r.version, mime: r.mime });
