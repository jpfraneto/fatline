// A one-word name from the seed alone (never from FID digits or text). Provisional: uniqueness across
// the 777 is checked at mint time, not here.
import { prng } from '../prng.mjs';

export const NAME_VERSION = 'fatliners.name/2';
// Soft, pebble-like sounds: open syllables, no consonant pile-ups.
const ONSET = ['b', 'd', 'f', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'y', 'th', 'sh'];
const VOWEL = ['a', 'a', 'e', 'i', 'o', 'o', 'u', 'ai', 'ou', 'ae'];
const CODA = ['', '', '', 'n', 'l', 'r', 's', 'm'];

export function beingName(seed) {
  const r = prng(seed, 'name');
  const n = r.next() < 0.7 ? 2 : 3;
  let s = '';
  for (let i = 0; i < n; i++) s += (i === 0 && r.next() < 0.25 ? '' : r.pick(ONSET)) + (i === n - 1 ? r.pick(VOWEL.filter((v) => v.length === 1)) : r.pick(VOWEL)) + (i === n - 1 ? r.pick(CODA) : '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
