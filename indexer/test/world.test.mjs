import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, WINDOW } from '../src/world.mjs';

const C = '0x00000000000000000000000000000000000000c0';
const ok = (result) => ({ status: 'success', result });

/** A chain with a few events, a head that moves, and a contract whose views answer from `tokens`. */
function fakeChain() {
  const chain = {
    head: 25_000n,
    calls: [],
    failAt: null,
    logs: [
      { blockNumber: 100n, logIndex: 0, transactionHash: '0xa', eventName: 'EggTaken', args: { fid: 16098n, to: '0x1', server: '0x2', dna: '0xd', laidAt: 1n } },
      { blockNumber: 15_000n, logIndex: 3, transactionHash: '0xb', eventName: 'EggTaken', args: { fid: 13505n, to: '0x3', server: '0x4', dna: '0xe', laidAt: 2n } },
    ],
    tokens: {
      16098: { stageOf: 1, ownerOf: '0xF2fe000000000000000000000000000000000001', surnameOf: 'FATLINE', stoneOf: 5, vaultOfFatliner: '0x0000000000000000000000000000000000000000' },
      13505: { stageOf: 1, ownerOf: '0x00000000000000000000000000000000000000a9', surnameOf: 'THAITUMA', stoneOf: 3 },
    },
    async getBlockNumber() { return chain.head; },
    async getLogs({ fromBlock, toBlock }) {
      chain.calls.push([fromBlock, toBlock]);
      if (toBlock - fromBlock + 1n > WINDOW) throw new Error('range too long');
      if (chain.failAt !== null && fromBlock <= chain.failAt && chain.failAt <= toBlock) throw new Error('request limit reached');
      return chain.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    },
    async multicall({ contracts }) {
      return contracts.map(({ functionName, args }) => {
        if (!args) return ok({ hatcheries: [['0x37757A1D0E0117EB169dDADBa10C18c796343bAE'], ['http://46.225.208.199:8791']], threshold: 1n, totalSupply: 0n, liveEggs: 2n, eggCount: 2n, coinsLaunched: 0n, maxSupply: 777n, genesisFid: 16098n, orderRoot: `0x${'0'.repeat(64)}` }[functionName]);
        const t = chain.tokens[Number(args[0])] ?? {};
        if (functionName === 'ownerOf' && !t.ownerOf) return { status: 'failure', error: new Error('ERC721NonexistentToken') };
        const blank = /surname|serverUrl/.test(functionName) ? '' : /owner|server|app|vault|coin/.test(functionName) ? '0x0000000000000000000000000000000000000000' : /dna/.test(functionName) ? `0x${'0'.repeat(64)}` : 0n;
        return ok(t[functionName] ?? blank);
      });
    },
  };
  return chain;
}

test('reads every event in windows, then only what is new', async () => {
  const chain = fakeChain();
  const w = new World({ client: chain, address: C, chainId: 8453, fromBlock: 50, file: ':memory:', now: () => 1000 });
  assert.equal(await w.sync(), 2);
  assert.deepEqual(chain.calls.map(([a, b]) => [Number(a), Number(b)]), [[50, 10_049], [10_050, 20_049], [20_050, 25_000]]);
  const v = w.view((fid) => (fid === 16098 ? { warmDays: 2 } : null));
  assert.equal(v.syncedBlock, 25_000);
  assert.equal(v.liveEggs, 2);
  assert.equal(v.places, 777);
  assert.equal(v.ranking, null);
  assert.deepEqual(v.attesters, [{ address: '0x37757a1d0e0117eb169ddadba10c18c796343bae', hatchery: 'http://46.225.208.199:8791' }]);
  assert.deepEqual(v.tokens.map((t) => [t.fid, t.stage, t.surname, t.stone, t.holder, t.vault]), [
    [13505, 'egg', 'THAITUMA', 'basalt', '0x00000000000000000000000000000000000000a9', null],
    [16098, 'egg', 'FATLINE', 'gold', '0xf2fe000000000000000000000000000000000001', null],
  ]);
  assert.deepEqual(v.tokens.find((t) => t.fid === 16098).warmth, { warmDays: 2 });

  chain.calls = [];
  chain.head = 26_000n;
  assert.equal(await w.sync(), 0);
  assert.deepEqual(chain.calls.map(([a, b]) => [Number(a), Number(b)]), [[25_001, 26_000]]);
});

test('a failed window is read again next time; nothing is lost or doubled', async () => {
  const chain = fakeChain();
  chain.failAt = 15_000n;
  const w = new World({ client: chain, address: C, chainId: 8453, fromBlock: 50, file: ':memory:' });
  await assert.rejects(w.sync(), /request limit/);
  assert.equal(w.view().syncedBlock, 10_049); // the first window was kept
  chain.failAt = null;
  assert.equal(await w.sync(), 1);
  assert.equal(w.events().length, 2);
  assert.equal(w.view().tokens.length, 2);
});

test('an egg that died leaves the world; a coin is traced to its token by its vault', async () => {
  const chain = fakeChain();
  chain.tokens[16098].vaultOfFatliner = '0x00000000000000000000000000000000000000Ba';
  const w = new World({ client: chain, address: C, chainId: 8453, fromBlock: 50, file: ':memory:' });
  await w.sync();
  chain.head = 30_000n;
  chain.tokens[13505] = { stageOf: 0 }; // burned
  chain.tokens[16098].coinOfFatliner = '0x00000000000000000000000000000000000000c1';
  chain.logs.push(
    { blockNumber: 29_000n, logIndex: 0, transactionHash: '0xc', eventName: 'Died', args: { fid: 13505n, hibernatingUntil: 9n } },
    { blockNumber: 29_500n, logIndex: 1, transactionHash: '0xd', eventName: 'CoinLaunched', args: { vault: '0x00000000000000000000000000000000000000ba', coin: '0xc1' } },
  );
  assert.equal(await w.sync(), 2);
  const v = w.view();
  assert.deepEqual(v.tokens.map((t) => t.fid), [16098]);
  assert.equal(v.tokens[0].coin, '0x00000000000000000000000000000000000000c1');
  assert.equal(w.events(1)[0].fid, 16098);
});

test('what each coin earned: every harvest plus what waits, counted once; a new vault catches up alone', async () => {
  const chain = fakeChain();
  const V = '0x00000000000000000000000000000000000000ba';
  chain.tokens[16098].vaultOfFatliner = V;
  chain.logs.push({ blockNumber: 12_000n, logIndex: 1, transactionHash: '0xh', address: V, eventName: 'Harvested', args: { amount: 7_432_637n } });
  const base = chain.multicall;
  chain.multicall = async ({ contracts }) => (contracts[0]?.functionName === 'pendingFees' ? contracts.map(() => ok(500_000n)) : base({ contracts }));
  const w = new World({ client: chain, address: C, chainId: 8453, fromBlock: 50, file: ':memory:' });
  await w.sync();
  const earned = () => w.view().tokens.find((t) => t.fid === 16098).earned;
  assert.equal(earned(), 7.932637);
  assert.equal(w.view().tokens.find((t) => t.fid === 13505).earned, null, 'no vault, nothing earned');
  // Next hour: only the new blocks, and the old harvest is not counted again.
  chain.head = 26_000n;
  chain.logs.push({ blockNumber: 25_500n, logIndex: 0, transactionHash: '0xi', address: V, eventName: 'Harvested', args: { amount: 1_000_000n } });
  await w.sync();
  assert.equal(earned(), 8.932637);
  // A second vault appears later: it reads its own past once.
  const V2 = '0x00000000000000000000000000000000000000bb';
  chain.logs.push({ blockNumber: 300n, logIndex: 0, transactionHash: '0xj', address: V2, eventName: 'Harvested', args: { amount: 2_000_000n } });
  chain.tokens[13505].vaultOfFatliner = V2;
  chain.head = 27_000n;
  chain.logs.push({ blockNumber: 26_500n, logIndex: 0, transactionHash: '0xk', eventName: 'FatlineBorn', args: { fid: 13505n, vault: V2 } });
  await w.sync();
  assert.equal(w.view().tokens.find((t) => t.fid === 13505).earned, 2.5);
  assert.equal(earned(), 8.932637);
});
