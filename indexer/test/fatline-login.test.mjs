import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { loginMessage, tieOf, verifyLogin } from '../src/fatline-login.mjs';

const me = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const other = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const now = new Date('2026-10-28T18:00:00Z');
const net = { name: 'farcaster', label: 'Farcaster' };
const msg = (o = {}) => loginMessage({ domain: 'example.app', uri: 'https://example.app', address: me.address, fid: 16098, nonce: 'abc12345', issuedAt: now, ...o });
const signed = async (o, who = me) => { const message = msg(o); return { message, signature: await who.signMessage({ message }) }; };
const tie = async (n, fid, address) => (fid === 16098 && address.toLowerCase() === me.address.toLowerCase() ? 'verified' : null);

test('a wallet tied to the FID logs in', async () => {
  const r = await verifyLogin({ ...(await signed()), network: net, now, tie });
  assert.equal(r.fid, 16098); assert.equal(r.how, 'verified'); assert.equal(r.domain, 'example.app'); assert.equal(r.nonce, 'abc12345');
});

test('the app can make the node check its own domain and nonce', async () => {
  const s = await signed();
  await assert.rejects(verifyLogin({ ...s, domain: 'evil.app', network: net, now, tie }), /not evil.app/);
  await assert.rejects(verifyLogin({ ...s, nonce: 'other', network: net, now, tie }), /nonce/);
  assert.equal((await verifyLogin({ ...s, domain: 'example.app', nonce: 'abc12345', network: net, now, tie })).fid, 16098);
});

test('a signature from someone else, or a wallet not tied to the FID: no', async () => {
  const s = await signed();
  const forged = { message: s.message, signature: await other.signMessage({ message: s.message }) };
  await assert.rejects(verifyLogin({ ...forged, network: net, now, tie }), /not made by/);
  await assert.rejects(verifyLogin({ ...(await signed({ fid: 1 })), network: net, now, tie }), /not FID 1's/);
});

test('expired, too long, or no FID: no', async () => {
  const s = await signed();
  await assert.rejects(verifyLogin({ ...s, network: net, now: new Date(now.getTime() + 11 * 60_000), tie }), /expired/);
  await assert.rejects(verifyLogin({ ...(await signed({ minutes: 60 * 48 })), network: net, now, tie }), /a day/);
  const message = msg().replace(/\nResources:[\s\S]*$/, '');
  await assert.rejects(verifyLogin({ message, signature: await me.signMessage({ message }), network: net, now, tie }), /FID/);
});

test('tieOf reads custody and verifications from the node', async () => {
  const fake = (custody, verified) => ({ get: async (path) => ({ data: path.includes('onChainEvents')
    ? { events: [{ blockNumber: 1, logIndex: 0, idRegisterEventBody: { eventType: 'REGISTER', to: custody } }] }
    : { messages: verified.map((address) => ({ data: { verificationAddAddressBody: { address } } })) } }) });
  assert.equal(await tieOf(fake(me.address.toLowerCase(), []), 1, me.address), 'custody');
  assert.equal(await tieOf(fake('0x0', [me.address.toLowerCase()]), 1, me.address), 'verified');
  assert.equal(await tieOf(fake('0x0', []), 1, me.address), null);
});
