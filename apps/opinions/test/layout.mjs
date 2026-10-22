// Responsive check for the Farline pages, in a real Chrome.
//   node test/layout.mjs <base url> [path ...]     e.g. node test/layout.mjs http://localhost:8787 "#/" "#/coin/8453/0x…"
// For each width (phone, tablet, desktop) it loads the page with device emulation, waits for data,
// fails if anything scrolls sideways, and saves a full-page screenshot next to this file's output dir.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTHS = [[360, 'phone-small'], [390, 'phone'], [768, 'tablet'], [1280, 'desktop']];
const [base, ...paths] = process.argv.slice(2);
if (!base) { console.error('usage: node test/layout.mjs <base url> [hash path ...]'); process.exit(1); }
const out = process.env.LAYOUT_OUT ?? mkdtempSync(join(tmpdir(), 'farline-layout-'));

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'chrome-'))}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((done, fail) => {
  let err = '';
  chrome.stderr.on('data', (d) => { err += d; const m = err.match(/ws:\/\/\S+/); if (m) done(m[0]); });
  setTimeout(() => fail(new Error('Chrome did not start')), 15_000);
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const waiting = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
  const msg = { id: ++id, method, params, sessionId };
  waiting.set(msg.id, (m) => (m.error ? fail(new Error(`${method}: ${m.error.message}`)) : done(m.result)));
  ws.send(JSON.stringify(msg));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
for (const path of paths.length ? paths : ['#/']) {
  for (const [width, name] of WIDTHS) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 2, mobile: width < 600 }, sessionId);
    await send('Page.enable', {}, sessionId);
    await send('Page.navigate', { url: base + path }, sessionId);
    await sleep(4000); // first data from the API
    const { result } = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const doc = document.documentElement;
        const wide = [...document.querySelectorAll('body *')].filter((n) => n.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 5).map((n) => n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').join('.') : ''));
        return { scroll: doc.scrollWidth, inner: innerWidth, height: doc.scrollHeight, wide, text: document.querySelector('#main')?.innerText.slice(0, 80) };
      })()`,
    }, sessionId);
    const r = result.value;
    const ok = r.scroll <= r.inner;
    if (!ok) failed++;
    await send('Emulation.setDeviceMetricsOverride', { width, height: Math.min(r.height, 6000), deviceScaleFactor: 1, mobile: width < 600 }, sessionId);
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const file = join(out, `${path.replace(/[^\w]+/g, '_').slice(0, 40)}-${name}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(width).padStart(4)}px ${path}  page ${r.scroll}px wide${ok ? '' : `, too wide: ${r.wide.join(', ')}`}  -> ${file}`);
    await send('Target.closeTarget', { targetId });
  }
}
ws.close();
chrome.kill();
process.exit(failed ? 1 : 0);
