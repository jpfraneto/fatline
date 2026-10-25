// Eggs and the hatchery, with a fake reference node and fake egg nodes (no network).
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { recoverTypedDataAddress } from 'viem';
import { surnameCandidate, claimText, eggOf, eggTypes, hatchDomain, hatchOf, hatchTypes, laidAtOf, normalizeNode, signClaim, surnameOf, verifyClaim, warmth } from '../src/egg.mjs';
import { Hatchery } from '../src/hatchery.mjs';

const HOUR = 3_600_000, DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 9, 24, 3, 0, 0);
const REF = 'http://ref.test:3381';
const GOOD = 'http://egg.test:3381';
const STALE = 'http://stale.test:3381';
const LIAR = 'http://liar.test:3381';
const SYNCING = 'http://syncing.test:3381'; // far behind, but closer every time it is read
const SERVER = '0x00000000000000000000000000000000000000aa'; // the egg server's hatchery key
const HATCH = 'http://egg.test:8791';
const FC_EPOCH_S = 1_609_459_200;

function appKey(fid = 18350) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const d = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url');
  const x = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  return { fid, privateKey: `0x${d.toString('hex')}`, publicKey: `0x${x.toString('hex')}` };
}

/** A tiny Snapchain: the reference holds a cast for every FID; egg nodes answer by their kind. */
function fakeNet({ signers, now }) {
  const cast = (fid) => ({ hash: `0x${fid.toString(16).padStart(40, '0')}`, data: { type: 'MESSAGE_TYPE_CAST_ADD', timestamp: Math.floor(now() / 1000) - FC_EPOCH_S - 3600 } });
  const info = (behind = 0) => ({ shardInfos: [{ shardId: 0, maxHeight: 10 }, { shardId: 1, maxHeight: 50_000 - behind }, { shardId: 2, maxHeight: 60_000 - behind }] });
  const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
  let syncReads = 0;
  const notFound = () => new Response(JSON.stringify({ error_detail: 'NotFound' }), { status: 400 });
  return async (input) => {
    const u = new URL(String(input));
    const node = `${u.protocol}//${u.host}`;
    const q = Object.fromEntries(u.searchParams);
    if (node === 'http://down.test:3381') throw new Error('fetch failed');
    if (u.port === '8791' && u.pathname === '/') return node === 'http://wrongkey.test:8791' ? ok({ attester: '0x00000000000000000000000000000000000000bb' }) : ok({ attester: SERVER });
    if (u.pathname === '/v1/info' && node === SYNCING) return ok(info(Math.max(0, 40_000 - 300 * ++syncReads)));
    if (u.pathname === '/v1/info') return ok(info(node === STALE ? 5000 : 0));
    if (u.pathname === '/v1/signersByFid') return ok({ signers: (signers[q.fid] ?? []).map((key) => ({ key })) });
    if (u.pathname === '/v1/castsByFid' && node === REF) return ok({ messages: [cast(Number(q.fid))] });
    if (u.pathname === '/v1/castById') {
      if (node === LIAR) return notFound(); // in sync on paper, holds nothing
      return ok({ hash: cast(Number(q.fid)).hash, data: {} });
    }
    return notFound();
  };
}

function setup({ dayMs = DAY, checkEveryMs = HOUR, attesters = [], surnameTaken, computeDna = async () => `0x${'ab'.repeat(32)}` } = {}) {
  let clock = T0;
  const now = () => clock;
  const key = appKey();
  const signers = { 18350: [key.publicKey] };
  const h = new Hatchery({
    config: { networks: { farcaster: { nodes: [{ url: 'https://crackle.farcaster.xyz:3381' }] } } },
    privateKey: `0x${'42'.repeat(32)}`, contract: { chainId: 8453, address: '0x5FbDB2315678afecb367f032d93F642f64180aa3' },
    reference: { farcaster: REF }, dataDir: mkdtempSync(join(tmpdir(), 'hatchery-')),
    computeDna, surnameTaken, listAttesters: async () => attesters, fetchImpl: fakeNet({ signers, now }), now, dayMs, checkEveryMs, log: () => {}, sleep: async () => {},
  });
  const claim = (over = {}) => {
    const node = over.node ?? GOOD;
    let hatchery = HATCH;
    try { hatchery = `http://${new URL(node).hostname}:8791`; } catch {}
    return signClaim(key, { fid: 18350, network: 'farcaster', node, to: '0x3ae59405ea68e9ce61442cadf74c335abfbc6b60', server: SERVER, hatchery, at: clock, ...over });
  };
  return { h, key, signers, claim, tick: async (ms) => { clock += ms; await h.tick(); }, now };
}

test('a claim is plain text, signed by the app key, and any change breaks it', () => {
  const key = appKey();
  const s = signClaim(key, { fid: 18350, network: 'farcaster', node: 'http://1.2.3.4:3381/', to: '0xABCDEF0000000000000000000000000000000001', server: SERVER, hatchery: 'http://1.2.3.4:8791/', at: T0 });
  assert.match(claimText(s.claim), /^fatline egg v1\nfid: 18350\nnetwork: farcaster\nnode: http:\/\/1\.2\.3\.4:3381\nto: 0xabcdef0+1\nserver: 0x0+aa\nhatchery: http:\/\/1\.2\.3\.4:8791\nat: /);
  assert.ok(!verifyClaim({ ...s, claim: { ...s.claim, server: '0x00000000000000000000000000000000000000bb' } }));
  assert.ok(verifyClaim(s));
  assert.ok(!verifyClaim({ ...s, claim: { ...s.claim, to: '0x0000000000000000000000000000000000000002' } }));
  assert.ok(!verifyClaim({ ...s, publicKey: appKey().publicKey }));
  assert.throws(() => signClaim(key, { ...s.claim, fid: 3 }), /belongs to FID 18350/);
  assert.equal(normalizeNode('https://Node.Example'), 'https://node.example:443');
});

test('the history is cut at the hour before laying, minus ten minutes', () => {
  assert.equal(laidAtOf(Date.UTC(2026, 9, 24, 3, 5)), Date.UTC(2026, 9, 24, 2) / 1000);
  assert.equal(laidAtOf(Date.UTC(2026, 9, 24, 3, 15)), Date.UTC(2026, 9, 24, 3) / 1000);
});

test('laying: only the FID\'s own key, a fresh claim, your own live node', async () => {
  const { h, claim, signers } = setup();
  const stranger = signClaim(appKey(), { ...claim().claim });
  await assert.rejects(h.lay(stranger), /not an active app key/);
  await assert.rejects(h.lay({ ...claim(), signature: claim({ to: '0x0000000000000000000000000000000000000009' }).signature }), /not signed by that key/);
  await assert.rejects(h.lay(claim({ at: T0 - 20 * 60_000 })), /too old/);
  await assert.rejects(h.lay(claim({ node: 'http://127.0.0.1:3381' })), /reachable from the internet/);
  await assert.rejects(h.lay(claim({ node: REF })), /public node or already hosts an attester/);
  await assert.rejects(h.lay(claim({ node: 'https://crackle.farcaster.xyz:3381' })), /public node or already hosts an attester/);
  await assert.rejects(h.lay(claim({ node: 'http://down.test:3381' })), /first check: no answer/);
  await assert.rejects(h.lay(claim({ node: STALE })), /blocks behind and not catching up/);
  await assert.rejects(h.lay(claim({ node: LIAR })), /did not return message/);
  const egg = await h.lay(claim());
  assert.equal(egg.fid, 18350);
  assert.equal(egg.warmDays, 0);

  // One node, one egg.
  const other = appKey(3);
  signers[3] = [other.publicKey];
  await assert.rejects(h.lay(signClaim(other, { fid: 3, network: 'farcaster', node: 'http://egg.test:3999', to: '0x0000000000000000000000000000000000000003', server: '0x00000000000000000000000000000000000000cc', hatchery: 'http://egg.test:8791', at: T0 })), /another egg/);
});

test('the egg names its server\'s hatchery: same machine, the key it claims, not already an attester', async () => {
  const { h, claim } = setup({ attesters: [{ address: '0x00000000000000000000000000000000000000dd', url: 'http://genesis.test:8791' }] });
  await assert.rejects(h.lay(claim({ hatchery: 'http://elsewhere.test:8791' })), /same machine/);
  await assert.rejects(h.lay(claim({ node: 'http://wrongkey.test:3381' })), /answers with key 0x0+bb/);
  await assert.rejects(h.lay(claim({ node: 'http://genesis.test:3381' })), /already hosts an attester/);
  const taken = setup({ attesters: [{ address: SERVER, url: 'http://old.test:8791' }] });
  await assert.rejects(taken.h.lay(taken.claim()), /already an attester/);
  const egg = await h.lay(claim());
  assert.equal(egg.server, SERVER);
  assert.equal(egg.hatchery, HATCH);
});

test('the Egg is signed as soon as the DNA is in, and recovers to the attester', async () => {
  const { h, claim } = setup();
  await h.lay(claim());
  for (let i = 0; i < 200 && !h.status(18350).egg; i++) await new Promise((r) => setTimeout(r, 10)); // DNA, then the surname
  const s = h.status(18350);
  assert.ok(s.egg, 'egg signed');
  assert.match(s.egg.message.surname, /^[A-Z0-9]{1,12}$/, 'the egg carries its surname (its coin ticker)');
  assert.equal(s.egg.message.server, SERVER);
  assert.equal(s.egg.message.url, HATCH);
  assert.equal(s.egg.message.dna, `0x${'ab'.repeat(32)}`);
  const message = await eggOf(h.state.eggs[18350]);
  const signer = await recoverTypedDataAddress({ domain: hatchDomain(h.contract), types: eggTypes, primaryType: 'Egg', message, signature: s.egg.signature });
  assert.equal(signer, h.address);
});

test('three warm days hatch it; the Hatch names the surname from the DNA and recovers to the attester', async () => {
  const { h, claim, tick } = setup();
  await h.lay(claim());
  await new Promise((r) => setImmediate(r)); // the DNA fills in the background
  // Checks at hour 0 (laying) through 64: day 3 (hours 48–71) has 17 of the 18 it needs.
  for (let i = 0; i < 64; i++) await tick(HOUR);
  assert.equal(h.status(18350).warmDays, 2);
  assert.equal(h.status(18350).hatched, false);
  await tick(HOUR); // the 18th: a day turns warm as soon as it has enough, about 2 days 17 hours in
  const s = h.status(18350);
  assert.equal(s.warmDays, 3);
  assert.ok(s.hatched);
  const message = await hatchOf(h.state.eggs[18350]);
  assert.equal(s.hatch.message.surname, await surnameOf(18350, `0x${'ab'.repeat(32)}`));
  assert.match(s.hatch.message.surname, /^[A-Z]{2,12}$/);
  assert.equal(s.hatch.message.deadline, String(message.deadline));
  const signer = await recoverTypedDataAddress({ domain: hatchDomain(h.contract), types: hatchTypes, primaryType: 'Hatch', message, signature: s.hatch.signature });
  assert.equal(signer, h.address);
  const checks = h.state.eggs[18350].checks.length;
  await tick(HOUR);
  assert.equal(h.state.eggs[18350].checks.length, checks); // hatched eggs are not checked again
});

test('a cold day does not reset the egg, it just does not count', () => {
  const egg = { claim: { at: T0 }, checks: [] };
  const hours = (day, n, ok) => { for (let i = 0; i < n; i++) egg.checks.push({ at: T0 + day * DAY + i * HOUR, ok }); };
  hours(0, 24, true);
  hours(1, 24, false); // the node was down
  hours(2, 18, true);
  hours(3, 17, true); // one short
  let w = warmth(egg, { now: T0 + 4 * DAY - 1 });
  assert.deepEqual(w.days.map((d) => d.warm), [true, false, true, false]);
  assert.equal(w.ready, false);
  hours(4, 18, true);
  w = warmth(egg, { now: T0 + 5 * DAY });
  assert.equal(w.warmDays, 3);
  assert.ok(w.ready);
});

test('no hatch without DNA', async () => {
  const { h, claim, tick } = setup({ dayMs: 10 * HOUR, checkEveryMs: HOUR });
  h.computeDna = async () => { throw new Error('node down'); };
  await h.lay(claim());
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 40; i++) await tick(HOUR);
  const s = h.status(18350);
  assert.ok(s.warmDays >= 3);
  assert.equal(s.hatched, false);
  assert.match(s.dnaError, /node down/);
});

test('a FID whose Fatliner is already born cannot lay an egg', async () => {
  const { h, claim } = setup();
  h.isBorn = async (fid) => fid === 18350;
  await assert.rejects(h.lay(claim()), /already born/);
});

test('warmth starts when the node starts syncing: a node that is catching up passes its checks', async () => {
  const { h, claim, tick } = setup();
  const egg = await h.lay(claim({ node: SYNCING }));
  assert.equal(egg.fid, 18350);
  const first = h.state.eggs[18350].checks[0];
  assert.equal(first.ok, true);
  assert.equal(first.syncing, true);
  assert.ok(first.behind > 600);
  await tick(HOUR);
  assert.equal(h.state.eggs[18350].checks.at(-1).ok, true, 'still catching up an hour later: still warm');
  const shown = h.status(18350).recent.at(-1);
  assert.equal(shown.syncing, true, 'the public status says it is still catching up');
  assert.ok(shown.behind > 0);
});

test('no two eggs share a surname: a taken name moves the egg to its next one, and the stone is signed in', async () => {
  const dna = `0x${'ab'.repeat(32)}`;
  const first = await surnameCandidate(18350, dna, 0);
  const second = await surnameCandidate(18350, dna, 1);
  assert.notEqual(first, second);
  const { h, claim } = setup({ surnameTaken: async (name) => (name === first ? 3 : 0), computeDna: async () => ({ dna, stone: 6 }) });
  await h.lay(claim());
  for (let i = 0; i < 200 && !h.status(18350).egg; i++) await new Promise((r) => setTimeout(r, 10));
  const s = h.status(18350);
  assert.equal(s.egg.message.surname, second, 'FID 3 holds the first name, so this egg takes the next');
  assert.equal(s.egg.message.stone, '6', 'opal, from the same history as the DNA');
  const signer = await recoverTypedDataAddress({ domain: hatchDomain(h.contract), types: eggTypes, primaryType: 'Egg', message: await eggOf(h.state.eggs[18350]), signature: s.egg.signature });
  assert.equal(signer, h.address);
  assert.equal((await hatchOf(h.state.eggs[18350])).surname, second, 'it hatches with that same surname');
});
