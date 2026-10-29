// The lupa: everything a node holds about one account, by exact @username or FID.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../src/api.mjs';

const b64 = (hex) => Buffer.from(hex, 'hex').toString('base64');

function fakeNetwork() {
  const answers = {
    '/v1/userNameProofByName': (p) => (p.name === 'jpfraneto' ? { fid: 16098 } : null),
    '/v1/userDataByFid': () => ({ messages: [
      { data: { userDataBody: { type: 'USER_DATA_TYPE_USERNAME', value: 'jpfraneto' } } },
      { data: { userDataBody: { type: 'USER_DATA_TYPE_DISPLAY', value: 'jp' } } },
      { data: { userDataBody: { type: 'USER_DATA_TYPE_LOCATION', value: 'geo:-33.4,-70.6' } } },
    ] }),
    '/v1/onChainEventsByFid': () => ({ events: [
      { blockNumber: 2, logIndex: 0, blockTimestamp: 1700000000, idRegisterEventBody: { eventType: 'Transfer', to: '0xAB20000000000000000000000000000000000001', recoveryAddress: '0x0000000000000000000000000000000000000000' } },
      { blockNumber: 1, logIndex: 0, blockTimestamp: 1699388131, idRegisterEventBody: { eventType: 'Register', to: '0x1111111111111111111111111111111111111111', recoveryAddress: '0x00000000FCb080a4D6c39a9354dA9EB9bC104cd7' } },
    ] }),
    '/v1/storageLimitsByFid': () => ({ units: 37, limits: [{ name: 'CASTS', used: 26000, limit: 26000 }, { name: 'LINKS', used: 3424, limit: 17500 }] }),
    '/v1/verificationsByFid': () => ({ messages: [
      { data: { verificationAddAddressBody: { address: '0xF2FE000000000000000000000000000000000002', protocol: 'PROTOCOL_ETHEREUM' } } },
      { data: { verificationAddAddressBody: { address: 'So1anaAddre55', protocol: 'PROTOCOL_SOLANA' } } },
    ] }),
    '/v1/signersByFid': () => ({ signers: [{ key: '0xAA', requestFid: 9152 }, { key: '0xBB', requestFid: 9152 }, { key: '0xCC' }] }),
    '/v1/castsByFid': () => ({ messages: [] }),
  };
  return {
    name: 'farcaster',
    async get(path, params) {
      const data = answers[path]?.(params ?? {});
      if (data === undefined) throw new Error(`unexpected ${path}`);
      return { data, node: 'http://node' };
    },
    source: (node) => ({ node }),
  };
}

test('a person, as this node holds them: wallets, since when, storage, addresses, apps with keys', async () => {
  const api = new Api({ config: {}, networks: {}, voices: { enabled: false }, launchpad: null });
  const p = await api.person(fakeNetwork(), '@JPFRANETO');
  assert.equal(p.user.fid, 16098);
  assert.equal(p.user.location, 'geo:-33.4,-70.6');
  assert.equal(p.custody, '0xab20000000000000000000000000000000000001', 'the last register or transfer holds it');
  assert.equal(p.recovery, '0x00000000fcb080a4d6c39a9354da9eb9bc104cd7', 'the last recovery that was set, not the empty one');
  assert.equal(p.since, 1699388131000, 'when it registered');
  assert.deepEqual(p.storage.casts, { used: 26000, limit: 26000 });
  assert.equal(p.storage.units, 37);
  assert.deepEqual(p.addresses, [{ address: '0xf2fe000000000000000000000000000000000002', chain: 'ethereum' }, { address: 'So1anaAddre55', chain: 'solana' }]);
  assert.deepEqual(p.apps.map((a) => [a.fid, a.keys]), [[9152, 2], [null, 1]]);
  await assert.rejects(api.person(fakeNetwork(), 'nobody'), /No account named nobody/);
});
