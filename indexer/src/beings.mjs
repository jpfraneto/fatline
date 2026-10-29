// Beings: a Fatliner's own art, drawn by this server when it hatches. Once an hour (after the world is read), every
// Fatliner with no art yet is drawn by the Fatliners pipeline (fatliners/src/pfp: its history from this server's own
// nodes → calibrated traits → the prompt, with the style reference attached) through an image API (OpenRouter).
//
// Rules, because each drawing costs real money:
//   - only when the owner put a key here (<data>/openrouter.key, mode 600, never printed);
//   - one accepted portrait per Fatliner, ever: it is never redrawn by itself;
//   - at most `perDay` drawings a day, and a failed one waits a day before it is tried again;
//   - a Fatliner whose art is already in fatliners-art.json (Aster) is left alone.
// The portrait is kept in <data>/beings/<fid>.png and served at GET /beings/<fid>.png; GET /beings lists them. The
// token metadata (apps/site/fatliners.mjs), /world and every client read it from there.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PUBLIC = 'https://fatline.ink/beings';
const DAY = 24 * 3600_000;

export function readKey(file) {
  try { const k = readFileSync(file, 'utf8').trim(); return k || null; } catch { return null; }
}

/**
 * dataDir: the hatchery's data folder. tokens(): the world's tokens. drawn(fid): art already published elsewhere.
 * draw(fid, { outRoot, key }): makes one portrait, returns { portrait (a PNG path), model, promptSha256 }.
 */
export function makeBeings({ dataDir, tokens, drawn = () => false, draw, keyFile = join(dataDir, 'openrouter.key'), perDay = 4, now = () => Date.now(), log = console.log }) {
  const dir = join(dataDir, 'beings');
  const file = join(dataDir, 'beings.json');
  const load = () => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { beings: {}, tries: {} }; } };
  const save = (s) => { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(s, null, 1) + '\n'); };
  let running = false;

  /** Draws whatever is missing, within the day's limit. Returns how many it drew. */
  async function run() {
    if (running) return 0;
    const key = readKey(keyFile);
    if (!key) return 0;
    running = true;
    try {
      const s = load();
      const today = now() - DAY;
      let spent = Object.values(s.tries).filter((t) => t.at > today).length;
      let made = 0;
      for (const t of tokens()) {
        if (t.stage !== 'fatliner' || s.beings[t.fid] || drawn(t.fid)) continue;
        if (s.tries[t.fid]?.at > today) continue; // tried in the last day (and failed): not again yet
        if (spent >= perDay) { log(`[beings] ${perDay} drawings today; the rest wait for tomorrow`); break; }
        spent++;
        s.tries[t.fid] = { at: now() };
        save(s);
        try {
          log(`[beings] drawing #${t.fid} ${t.surname ?? ''}`);
          const g = await draw(t.fid, { outRoot: join(dataDir, 'pfp'), key });
          mkdirSync(dir, { recursive: true });
          copyFileSync(g.portrait, join(dir, `${t.fid}.png`));
          s.beings[t.fid] = { image: `${PUBLIC}/${t.fid}.png`, at: now(), model: g.model ?? null, promptSha256: g.promptSha256 ?? null };
          s.tries[t.fid].ok = true;
          made++;
          log(`[beings] #${t.fid} drawn`);
        } catch (err) {
          s.tries[t.fid].error = String(err.message).slice(0, 300);
          log(`[beings] #${t.fid} failed: ${s.tries[t.fid].error}`);
        }
        save(s);
      }
      return made;
    } finally {
      running = false;
    }
  }

  /** { fid: { image } } of every being drawn here. The URL carries when it was drawn: a new drawing is a new address. */
  function list() {
    return Object.fromEntries(Object.entries(load().beings).map(([fid, b]) => [fid, { image: `${PUBLIC}/${fid}.png?v=${b.at}` }]));
  }

  /** The PNG of a being drawn here, or null. */
  function png(fid) {
    const p = join(dir, `${Number(fid)}.png`);
    return existsSync(p) ? readFileSync(p) : null;
  }

  return { run, list, png, status: () => ({ key: Boolean(readKey(keyFile)), ...load() }) };
}
