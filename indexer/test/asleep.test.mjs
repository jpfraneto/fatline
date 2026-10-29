// A place whose server is off, shown by the master (asleep.mjs). Everything is faked: the hatchery's /world, the
// node, the coins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAsleep } from '../src/asleep.mjs';

const world = {
  genesisFid: 16098,
  tokens: [
    { fid: 16098, stage: 'fatliner', surname: 'FATLINE', stone: 'gold', linkedFid: 16098 },
    { fid: 13505, stage: 'fatliner', surname: 'THAITUMA', stone: 'basalt', linkedFid: 13505, coin: null,
      warmth: { lastCheck: { at: Date.now() - 2 * 86400_000, ok: true } } },
    { fid: 20630, stage: 'egg', surname: 'AENON', stone: 'gold', linkedFid: 20630, coin: '0xc0', warmth: { lastCheck: { at: Date.now() - 3600_000, ok: false } } },
    { fid: 9, stage: 'dead', surname: 'GONE' },
  ],
};
const art = { egg: { image: 'https://arweave.net/' + 'e'.repeat(43) }, eggs: { basalt: { image: 'https://arweave.net/' + 'b'.repeat(43) } }, beings: {} };

function make({ hatcheryUp = true } = {}) {
  let worldCalls = 0;
  const fetchImpl = async (url) => {
    worldCalls++;
    assert.equal(url, 'http://127.0.0.1:8791/world');
    if (!hatcheryUp) throw new Error('down');
    return { ok: true, json: async () => world };
  };
  const api = {
    user: async (net, fid) => ({ fid, username: fid === 13505 ? 'thai' : null }),
    feed: async () => ({ items: [{ kind: 'cast', fid: 13505, text: 'gm <script>alert(1)</script>', timestamp: Date.now() - 600_000 }] }),
  };
  const coins = async (fids) => ({ coins: [fids === '20630' ? { coin: '0xc0', vault: '0xv', usdc: 12.5 } : { coin: null, vault: null, usdc: null }] });
  const a = makeAsleep({ worlds: async () => [{ url: 'http://127.0.0.1:8791/' }], api, network: { name: 'snapchain' }, coins,
    ownLabel: async () => 'fatline', fetchImpl, readArt: () => art });
  return { a, calls: () => worldCalls };
}

function res() {
  const r = { status: 0, headers: {}, body: '' };
  r.writeHead = (s, h = {}) => { r.status = s; r.headers = h; return r; };
  r.end = (b = '') => { r.body = String(b); };
  return r;
}

test('stands in only for known places, never for this server, fatline.ink or www', async () => {
  const { a, calls } = make();
  assert.equal(await a.knows('thaituma.fatline.ink'), true);
  assert.equal(await a.knows('AENON.fatline.ink'), true);
  for (const d of ['fatline.fatline.ink', 'fatline.ink', 'www.fatline.ink', 'nobody.fatline.ink', 'gone.fatline.ink', 'thaituma.evil.com', '', null]) {
    assert.equal(await a.knows(d), false, d);
  }
  assert.ok(calls() <= 2, 'the world is read once a minute, not per question');
});

test('the asleep page: who, why, the last cast (escaped), the coin, how to wake it, and its mini app card', async () => {
  const { a } = make();
  const html = await a.page('thaituma.fatline.ink');
  assert.match(html, /<h1>Thaituma<\/h1>/);
  assert.match(html, /@thai · a Fatliner/);
  assert.match(html, /<b>Asleep\.<\/b> Its server is not answering/);
  assert.match(html, /last checked its node 2 days ago: it answered/);
  assert.match(html, /gm &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /read from fatline\.ink&#39;s Snapchain node/);
  assert.match(html, /No coin yet/);
  assert.match(html, /fatline update/);
  assert.match(html, /<meta name="fc:miniapp"/);
  assert.match(html, /https:\/\/thaituma\.fatline\.ink\//);
  assert.match(html, new RegExp(`https://fatline\\.ink/api/art/${'b'.repeat(43)}`), 'its stone egg as picture and card');
  assert.doesNotMatch(html, /\/miniapp\/(embed\.jpg|splash\.png)/, 'no pictures this server would not have for that name');

  const egg = await a.page('aenon.fatline.ink');
  assert.match(egg, /FID 20630 · an egg · \$AENON/);
  assert.match(egg, /Its vault holds <b>12\.50 USDC<\/b>/);
  assert.match(egg, /no answer/);
});

test('serve: health says asleep (503), the manifest names the place, other paths go home, unknown names 404', async () => {
  const { a } = make();
  let r = res(); await a.serve('thaituma.fatline.ink', '/api/health', r);
  assert.equal(r.status, 503);
  assert.equal(JSON.parse(r.body).asleep, true);
  r = res(); await a.serve('thaituma.fatline.ink:443', '/.well-known/farcaster.json', r);
  const m = JSON.parse(r.body);
  assert.equal(m.miniapp.name, 'Thaituma');
  assert.equal(m.miniapp.homeUrl, 'https://thaituma.fatline.ink/');
  assert.equal(m.accountAssociation, undefined, 'not ours to sign');
  r = res(); await a.serve('thaituma.fatline.ink', '/', r);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  r = res(); await a.serve('thaituma.fatline.ink', '/assets/x.js', r);
  assert.equal(r.status, 302);
  r = res(); await a.serve('nobody.fatline.ink', '/', r);
  assert.equal(r.status, 404);
  r = res(); await a.serve('thaituma.fatline.ink', '/asleep/sdk.mjs', r);
  assert.equal(r.status, 200);
  assert.match(r.body, /isInMiniApp/);
});

test('no hatchery answers: no stand-in (and no certificate) at all', async () => {
  const { a } = make({ hatcheryUp: false });
  assert.equal(await a.knows('thaituma.fatline.ink'), false);
  const r = res(); await a.serve('thaituma.fatline.ink', '/', r);
  assert.equal(r.status, 404);
});
