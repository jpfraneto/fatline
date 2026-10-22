#!/usr/bin/env node
// Checks that headless Chrome (V8 in a browser, via the preview) renders every synthetic being
// byte-for-byte like Node does. Needs the preview running and Google Chrome installed.
import { execFileSync } from 'node:child_process';
import { generate } from '../src/index.mjs';
import { sha256Hex } from '../src/hash.mjs';
import { allProfiles, history } from '../src/sources/synthetic.mjs';

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = `http://127.0.0.1:${process.env.PORT ?? 7777}/?selftest`;
const dom = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--virtual-time-budget=8000', '--dump-dom', url], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const m = dom.match(/<pre id="selftest">([^<]+)<\/pre>/);
if (!m) { console.error('selftest output not found (is the preview running?)'); process.exit(1); }
const browser = JSON.parse(m[1].replace(/&quot;/g, '"'));
let bad = 0;
for (const p of allProfiles()) {
  const r = generate(history(p));
  const node = sha256Hex(r.svg + r.icon);
  if (browser[p.id] !== node) { bad++; console.log(`MISMATCH ${p.id}`); }
}
console.log(bad ? `${bad} mismatches` : `all ${allProfiles().length} beings identical in Chrome and Node`);
process.exit(bad ? 1 : 0);
