#!/usr/bin/env node
// Scenes of the Fatliners' world, through the Bankr LLM gateway (text to image).
//
//   node fatliners/bin/world.mjs                 make every scene in world/scenes.json that has no image yet
//   node fatliners/bin/world.mjs the-vault       only these scenes (by slug)
//   node fatliners/bin/world.mjs --redo the-vault   make it again (the old image is kept as <slug>.<n>.png)
//   node fatliners/bin/world.mjs --dry-run       print the prompts, call nothing
//
// The key comes from BANKR_API_KEY or ~/.fatline-bankr-key (mode 600). It is never printed or written anywhere.
// Out: world/img/<slug>.png and a web copy world/img/<slug>.jpg (macOS sips), plus world/img/<slug>.json
// with the model, prompt and token usage, so every image says how it was made.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'world');
const OUT = join(ROOT, 'img');
const GATEWAY = 'https://llm.bankr.bot/v1/images/generations';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const redo = args.includes('--redo');
const only = args.filter((a) => !a.startsWith('--'));

const world = JSON.parse(readFileSync(join(ROOT, 'scenes.json'), 'utf8'));
const unknown = only.filter((s) => !world.scenes.some((x) => x.slug === s));
if (unknown.length) throw new Error(`no scene named ${unknown.join(', ')} in world/scenes.json`);
const scenes = world.scenes.filter((s) => (only.length ? only.includes(s.slug) : true));

const promptOf = (s) => `${s.style ?? world.style}\n\nThe scene: ${s.prompt}`;

function key() {
  if (process.env.BANKR_API_KEY) return process.env.BANKR_API_KEY.trim();
  const file = join(homedir(), '.fatline-bankr-key');
  if (!existsSync(file)) throw new Error('No Bankr key: set BANKR_API_KEY or save it to ~/.fatline-bankr-key (chmod 600).');
  return readFileSync(file, 'utf8').trim();
}

async function make(s) {
  const body = { model: s.model ?? world.model, prompt: promptOf(s), size: s.size ?? '1536x1024', n: 1 };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(GATEWAY, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
    if (res.ok) {
      const json = await res.json();
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) throw new Error(`${s.slug}: no image in the answer`);
      return { png: Buffer.from(b64, 'base64'), usage: json.usage ?? null, model: body.model, size: body.size };
    }
    const text = (await res.text()).slice(0, 300);
    if (res.status === 402) throw new Error(`Bankr says the LLM credits are used up (402). Top up at bankr.bot. ${text}`);
    console.error(`  ${s.slug}: HTTP ${res.status} (try ${attempt}/3): ${text}`);
    if (res.status && res.status < 500 && res.status !== 429) throw new Error(`${s.slug}: refused`);
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
  throw new Error(`${s.slug}: failed 3 times`);
}

mkdirSync(OUT, { recursive: true });
let made = 0;
for (const s of scenes) {
  const png = join(OUT, `${s.slug}.png`);
  if (dry) { console.log(`--- ${s.slug} (${s.size})\n${promptOf(s)}\n`); continue; }
  if (existsSync(png) && !redo) { console.log(`${s.slug}: already made, skipped (--redo to make it again)`); continue; }
  if (existsSync(png)) { let n = 1; while (existsSync(join(OUT, `${s.slug}.${n}.png`))) n++; renameSync(png, join(OUT, `${s.slug}.${n}.png`)); }
  const t0 = Date.now();
  console.log(`${s.slug}: asking ${s.model ?? world.model} for ${s.size}…`);
  const r = await make(s);
  writeFileSync(png, r.png);
  writeFileSync(join(OUT, `${s.slug}.json`), JSON.stringify({
    slug: s.slug, title: s.title, caption: s.caption, model: r.model, size: r.size, gateway: 'llm.bankr.bot',
    world: world.version, madeAt: new Date().toISOString(), usage: r.usage, prompt: promptOf(s),
  }, null, 2) + '\n');
  try { // a lighter copy for the web
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', '1600', png, '--out', join(OUT, `${s.slug}.jpg`)], { stdio: 'ignore' });
  } catch { console.log('  (no sips here: PNG only)'); }
  made++;
  console.log(`  done in ${Math.round((Date.now() - t0) / 1000)} s, ${r.usage?.total_tokens ?? '?'} tokens`);
}
if (!dry) console.log(`${made} made.`);
