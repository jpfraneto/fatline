#!/usr/bin/env node
// Local preview: http://127.0.0.1:7777  (npm run preview). Serves preview/ and src/ as static files;
// the browser runs the same generator modules. One JSON endpoint reads a real FID's history from the
// local Fatline archive, read-only and text-free, for this machine only.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArchive, defaultDbPath } from '../src/sources/archive.mjs';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { prepare, OUT_ROOT, LATEST_PROMPT } from '../src/pfp/pipeline.mjs';
import { loadConfig } from '../../indexer/src/config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = process.env.FATLINE_DB ?? defaultDbPath(join(root, '..'));
const port = Number(process.env.PORT ?? 7777);
const TYPES = { '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

function json(res, x) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(x)); }
const rj = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** The newest prepared directory for a FID (by the latest prompt version first, then time). */
function latest(fid) {
  const base = join(OUT_ROOT, `fid-${fid}`);
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base).filter((k) => /^[0-9a-f]{16}$/.test(k)).map((k) => join(base, k))
    .filter((d) => existsSync(join(d, 'pfp.request.json')))
    .map((d) => ({ d, req: rj(join(d, 'pfp.request.json')), t: statSync(join(d, 'pfp.request.json')).mtimeMs }))
    .sort((a, b) => (b.req.prompt.version === LATEST_PROMPT) - (a.req.prompt.version === LATEST_PROMPT) || b.t - a.t);
  if (!dirs.length) return null;
  const { d, req } = dirs[0];
  const rel = d.slice(OUT_ROOT.length + 1);
  const prov = rj(join(d, 'provenance.private.json'));
  const has = existsSync(join(d, 'portrait.png'));
  const revs = existsSync(join(d, 'revisions')) ? readdirSync(join(d, 'revisions')).sort((a, b) => a - b).map((n) => `/pfp-out/${rel}/revisions/${n}/portrait.png`) : [];
  return {
    status: has ? 'generated' : 'prepared', fid, key: req.key, request: req,
    blueprint: rj(join(d, 'blueprint.json')), traits: rj(join(d, 'traits.json')).traits,
    coverage: { state: prov.coverage.state, networks: Object.fromEntries(Object.entries(prov.coverage.networks ?? {}).map(([n, c]) => [n, { label: c.label, status: c.status, messages: c.messages, oldest: c.oldest, newest: c.newest }])), evidence: prov.evidence },
    prompt: readFileSync(join(d, 'pfp.prompt.txt'), 'utf8'),
    portrait: has ? `/pfp-out/${rel}/portrait.png` : null, revisions: revs,
    generation: has ? rj(join(d, 'generation.json')) : null,
  };
}
function listPfps() {
  if (!existsSync(OUT_ROOT)) return [];
  return readdirSync(OUT_ROOT).filter((x) => /^fid-\d+$/.test(x)).map((x) => latest(Number(x.slice(4)))).filter(Boolean)
    .map((r) => ({ fid: r.fid, name: r.blueprint.name, status: r.status, portrait: r.portrait, directions: r.blueprint.directions, prompt: r.request.prompt.version }));
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    const m = url.pathname.match(/^\/api\/fid\/(\d{1,12})$/);
    if (m) {
      const q = (k) => (url.searchParams.get(k) ? Number(url.searchParams.get(k)) : null);
      const { history, sources } = await readArchive(db, Number(m[1]), { snapshotAt: q('snapshotAt') ?? Date.now(), registeredAt: q('registeredAt') });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ history, sources }));
    }
    // ---- PFP (reference-conditioned). /pfp is the page; the API never returns node URLs or raw history.
    if (url.pathname === '/api/pfp') return json(res, listPfps());
    const pm = url.pathname.match(/^\/api\/pfp\/(\d{1,12})$/);
    if (pm) {
      if (req.method !== 'POST') return json(res, latest(Number(pm[1])) ?? { status: 'not-prepared' });
      const r = await prepare({ fid: Number(pm[1]), source: { kind: 'nodes', config: loadConfig(), dbPath: db, offline: url.searchParams.has('offline'), networks: ['farcaster', 'hypersnap'] } });
      return json(res, r.dir ? latest(r.fid) : { status: r.status, message: r.message, coverage: r.coverage });
    }
    const om = url.pathname.match(/^\/pfp-out\/(fid-\d+\/[0-9a-f]{16}\/(?:revisions\/\d+\/)?[a-z.]+\.(png|txt|json))$/);
    if (om && !om[1].includes('private')) { const f = join(OUT_ROOT, om[1]); res.writeHead(200, { 'content-type': TYPES[extname(f)] }); return res.end(await readFile(f)); }
    if (url.pathname === '/reference.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(await readFile(join(root, 'assets/FATLINERS_MASTER_REFERENCE.png'))); }
    const path = url.pathname === '/' ? '/preview/index.html' : url.pathname === '/pfp' ? '/preview/pfp.html' : url.pathname;
    const file = normalize(join(root, path));
    if (!file.startsWith(join(root, 'preview')) && !file.startsWith(join(root, 'src'))) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain' });
    res.end(err.code === 'ENOENT' ? 'not found' : String(err.message));
  }
}).listen(port, '127.0.0.1', () => console.log(`Fatliners preview → http://127.0.0.1:${port}  ·  PFPs → http://127.0.0.1:${port}/pfp  (archive: ${db})`));
