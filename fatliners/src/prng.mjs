// Deterministic randomness. sfc32 seeded from a 32-byte hash: same seed, same stream, every engine.
import { sha256Bytes } from './hash.mjs';

export function prng(seedHex, label = '') {
  // Each label gets its own stream, so adding a draw in one part of the renderer never shifts another part.
  const bytes = sha256Bytes(`${seedHex}|${label}`);
  const dv = new DataView(bytes.buffer);
  let a = dv.getUint32(0), b = dv.getUint32(4), c = dv.getUint32(8), d = dv.getUint32(12);
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}
