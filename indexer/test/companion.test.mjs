import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeAbiParameters, pad } from 'viem';
import { hatchEta, makeCompanion, makeQuickAuth } from '../src/companion.mjs';

// ---- Quick Auth: a token signed like auth.farcaster.xyz's, against a JWKS we serve ourselves
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(claims, key = privateKey, kid = 'k1') {
  const h = b64({ alg: 'RS256', kid, typ: 'JWT' }), p = b64(claims);
  return `${h}.${p}.${createSign('RSA-SHA256').update(`${h}.${p}`).sign(key).toString('base64url')}`;
}
const jwksFetch = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
const NOW = 1_793_000_000_000;
const good = { iss: 'https://auth.farcaster.xyz', aud: 'fatline.ink', sub: 16098, exp: NOW / 1000 + 600 };

test('quick auth: a real token gives the FID; anything else is refused', async () => {
  const verify = makeQuickAuth({ fetchImpl: jwksFetch, now: () => NOW });
  assert.equal(await verify(`Bearer ${jwt(good)}`), 16098);
  assert.equal(await verify(jwt({ ...good, aud: 'fatline.fatline.ink' })), 16098);
  await assert.rejects(verify(jwt({ ...good, aud: 'evil.com' })), /another app/);
  await assert.rejects(verify(jwt({ ...good, iss: 'https://evil' })), /not from Farcaster/);
  await assert.rejects(verify(jwt({ ...good, exp: NOW / 1000 - 1 })), /ran out/);
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(verify(jwt(good, other)), /not from Farcaster/);
  await assert.rejects(verify(''), /Sign in/);
});

// ---- the egg's clock, on Aster's real numbers (2026-10-26 15:35 UTC)
test('hatchEta: Aster, 2 warm days, day 3 just started', () => {
  const layingAt = 1792851214169;
  const egg = { layingAt, warmDays: 2, needed: 3, hatched: false,
    days: [{ day: 1, passed: 27, need: 18, warm: true }, { day: 2, passed: 24, need: 18, warm: true }, { day: 3, passed: 1, need: 18, warm: false }],
    recent: [{ at: 1793028100000, ok: true }] };
  const eta = hatchEta(egg, { now: 1793028949000 });
  // 17 more passes, ~55 min apart: about 15.6 hours after the last check
  assert.equal(new Date(eta).toISOString().slice(0, 13), '2026-10-27T06');
  assert.equal(hatchEta({ ...egg, hatched: true }), null);
  // a day that can no longer fill rolls to the next window
  const late = { ...egg, days: [...egg.days.slice(0, 2), { day: 3, passed: 1, need: 18, warm: false }], recent: [{ at: layingAt + 3 * 86_400_000 - 3_600_000 }] };
  assert.ok(hatchEta(late) > layingAt + 3 * 86_400_000);
});

// ---- a companion with fake chain, node and voice
const PAY_TO = '0x' + 'ab'.repeat(20);
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const COIN = '0x' + 'cc'.repeat(20);
function setup({ stage = 1, coin = null, balance = 0n, receipt = null } = {}) {
  const reader = {
    readContract: async ({ functionName, args }) => ({
      stageOf: stage, surnameOf: 'FATLINE', stoneOf: 5, genesisFid: 16098n, coinOfFatliner: coin ?? '0x' + '0'.repeat(40),
      decimals: 18, balanceOf: balance,
    })[functionName],
    waitForTransactionReceipt: async () => receipt,
  };
  const net = { name: 'farcaster', get: async (path, params) => {
    if (path === '/v1/verificationsByFid') return { data: { messages: [{ data: { verificationAddAddressBody: { address: '0x' + '11'.repeat(20), protocol: 'PROTOCOL_ETHEREUM' } } }] } };
    if (path === '/v1/castsByFid') return { data: { messages: [{ data: { timestamp: 50_000_000, castAddBody: { text: params.reverse ? 'gm from my own node' : 'hello farcaster' } } }] } };
    return { data: null };
  } };
  const api = { user: async () => ({ username: 'jpfraneto', displayName: 'jp', pfp: null, bio: 'building' }) };
  const said = [];
  const c = makeCompanion({ config: { dataDir: mkdtempSync(join(tmpdir(), 'companion-')) }, networks: { farcaster: net }, api, contract: '0x' + '22'.repeat(20),
    payTo: PAY_TO, reader, verify: async (h) => Number(String(h).replace('Bearer ', '')), now: () => NOW, priceOf: async () => 0.01,
    llm: async (m) => { said.push(m); return 'i remember your first cast.'; } });
  return { c, said };
}

test('price: $7, 20% off in USDC, 30% off for $FATLINE holders (not before it launches)', async () => {
  let { c } = setup();
  let p = await c.price(16098);
  assert.deepEqual([p.card, p.crypto, p.holder, p.fatlineCoin], [7, 5.6, false, null]);
  ({ c } = setup({ coin: COIN, balance: 200n * 10n ** 18n })); // 200 × $0.01 = $2
  p = await c.price(16098);
  assert.deepEqual([p.card, p.crypto, p.holder], [4.9, 4.9, true]);
  ({ c } = setup({ coin: COIN, balance: 50n * 10n ** 18n })); // $0.50
  assert.equal((await c.price(16098)).holder, false);
});

const transferLog = (to, units) => ({ address: USDC, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', pad('0x' + '11'.repeat(20)), pad(to)], data: encodeAbiParameters([{ type: 'uint256' }], [units]) });

test('USDC: enough to payTo unlocks once; too little, wrong place or reuse by another FID is refused', async () => {
  const tx = '0x' + '9'.repeat(64);
  let { c } = setup({ receipt: { status: 'success', logs: [transferLog(PAY_TO, 5_600_000n)] } });
  assert.deepEqual(await c.payCrypto(16098, tx), { premium: true });
  await assert.rejects(c.payCrypto(42, tx), /another account/);
  ({ c } = setup({ receipt: { status: 'success', logs: [transferLog(PAY_TO, 5_000_000n)] } }));
  await assert.rejects(c.payCrypto(16098, tx), /premium is 5.60/);
  ({ c } = setup({ receipt: { status: 'success', logs: [transferLog('0x' + '33'.repeat(20), 9_000_000n)] } }));
  await assert.rejects(c.payCrypto(16098, tx), /sent 0.00/);
  ({ c } = setup({ receipt: { status: 'reverted', logs: [] } }));
  await assert.rejects(c.payCrypto(16098, tx), /failed/);
});

test('me: an egg holder sees its days and the free first line; chapters only with premium', async () => {
  const { c } = setup();
  const m = await c.me(16098);
  assert.equal(m.stage, 'egg'); assert.equal(m.surname, 'FATLINE');
  const st = await c.story(16098);
  assert.match(st.firstLine, /oldest cast your node holds.*"hello farcaster"/);
  assert.equal(st.chapters, undefined); assert.match(st.next, /Chapter 1/);
  c.store.person(16098).premium = { at: NOW };
  const p = await c.story(16098);
  assert.equal(p.chapters.length, 1); assert.match(p.chapters[0].text, /first cast/);
});

test('talk: three free messages, then premium; the being is told about their casts', async () => {
  const { c, said } = setup({ stage: 0 });
  for (let i = 0; i < 3; i++) await c.talk(7, 'hi');
  await assert.rejects(c.talk(7, 'hi'), /Premium/);
  assert.match(said[0][0].content, /hello farcaster/);
  assert.match(said[0][0].content, /no egg yet/);
  c.store.person(7).premium = { at: NOW };
  assert.equal((await c.talk(7, 'still here?')).free, null);
});
