import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { DOMAIN, verify } from '../src/connect.mjs';
import { qrArt } from '../src/qr.mjs';

const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const node = { url: 'http://node.test:3381' };
const nonce = 'abc123def456abc123def456';
const sign = async (over = {}) => {
  const message = createSiweMessage({
    domain: DOMAIN, address: account.address, uri: 'https://fatline.ink', version: '1', chainId: 10, nonce,
    issuedAt: new Date('2026-10-23T12:00:00Z'), expirationTime: new Date('2026-10-23T12:10:00Z'),
    resources: ['farcaster://fid/18350'], statement: 'Farcaster Auth', ...over,
  });
  return { message, signature: await account.signMessage({ message }) };
};
const now = new Date('2026-10-23T12:01:00Z');
const owns = (fid) => async (_node, addr) => (addr.toLowerCase() === account.address.toLowerCase() ? fid : null);

test('connect: a sign-in is accepted only when the node says the signer owns the FID', async () => {
  const s = await sign();
  const ok = await verify({ ...s, fid: 18350, nonce, node, now, fidOf: owns(18350) });
  assert.deepEqual(ok, { fid: 18350, custody: account.address });
  await assert.rejects(verify({ ...s, fid: 18350, nonce, node, now, fidOf: owns(3) }), /says .* owns FID 3, not 18350/);
  await assert.rejects(verify({ ...s, fid: 18350, nonce, node, now, fidOf: owns(null) }), /owns no FID/);
});

test('connect: wrong request, wrong domain, expired, or a forged signature are refused', async () => {
  const s = await sign();
  const base = { fid: 18350, nonce, node, now, fidOf: owns(18350) };
  await assert.rejects(verify({ ...s, ...base, nonce: 'another-request-nonce' }), /nonce/);
  await assert.rejects(verify({ ...(await sign({ domain: 'evil.example' })), ...base }), /not fatline\.ink/);
  await assert.rejects(verify({ ...s, ...base, now: new Date('2026-10-23T13:00:00Z') }), /expired/);
  await assert.rejects(verify({ ...s, ...base, fid: 3 }), /does not name the FID/);
  const other = privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba');
  const forged = { message: s.message, signature: await other.signMessage({ message: s.message }) };
  await assert.rejects(verify({ ...forged, ...base }), /not made by the address/);
});

test('the QR code keeps its quiet zone and has the arch in the middle', () => {
  const art = qrArt('https://farcaster.xyz/~/siwf?channelToken=TEST1234');
  assert.equal(art.size, art.n + 6);
  const mid = art.cells.filter((c) => c.kind === 'logo');
  assert.ok(mid.length > 0 && mid.length / (art.n * art.n) < 0.12, 'the arch covers under 12% of the code (error correction H allows 30%)');
  assert.ok(mid.some((c) => c.color.join() === '255,255,255'), 'the arch is drawn in white');
});
