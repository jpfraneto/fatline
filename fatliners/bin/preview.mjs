#!/usr/bin/env node
// Local preview: http://127.0.0.1:7777  (npm run preview). Serves preview/ and src/ as static files;
// the browser runs the same generator modules. One JSON endpoint reads a real FID's history from the
// local Fatline archive, read-only and text-free, for this machine only.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArchive, defaultDbPath } from '../src/sources/archive.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = process.env.FATLINE_DB ?? defaultDbPath(join(root, '..'));
const port = Number(process.env.PORT ?? 7777);
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

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
    const path = url.pathname === '/' ? '/preview/index.html' : url.pathname;
    const file = normalize(join(root, path));
    if (!file.startsWith(join(root, 'preview')) && !file.startsWith(join(root, 'src'))) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain' });
    res.end(err.code === 'ENOENT' ? 'not found' : String(err.message));
  }
}).listen(port, '127.0.0.1', () => console.log(`Fatliners preview → http://127.0.0.1:${port}  (archive: ${db})`));
