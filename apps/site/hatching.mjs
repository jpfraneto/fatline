// Aster's hatching, for the home page: the site is https and the hatchery speaks plain http, so the site's
// workflow asks it every 15 minutes and writes hatching.json. Usage: node apps/site/hatching.mjs [out-file]
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'hatching.json');
const HATCHERY = 'http://46.225.208.199:8791';
const FID = 18350;
try {
  const res = await fetch(`${HATCHERY}/eggs/${FID}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const e = await res.json();
  const last = e.recent?.at(-1) ?? null;
  writeFileSync(out, JSON.stringify({
    fid: FID, checkedAt: new Date().toISOString(), startedAt: e.layingAt ?? null,
    warmDays: e.warmDays, needed: e.needed, hatched: Boolean(e.hatched),
    days: (e.days ?? []).map(({ day, checks, passed, need, warm, done }) => ({ day, checks, passed, need, warm, done })),
    lastCheck: last ? { at: last.at, ok: last.ok } : null,
  }, null, 2) + '\n');
  console.log(`hatching: ${e.warmDays}/${e.needed} warm days`);
} catch (err) {
  console.log(`hatching: the hatchery did not answer (${err.message}); keeping the last file`);
}
