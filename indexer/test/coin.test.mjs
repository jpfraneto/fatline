import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { Coins, isLocalRpc, parseCoinRoute } from '../src/coin.mjs';
import { openDb } from '../src/db.mjs';
import { Launchpad, appUri } from '../src/launchpad.mjs';
import { NodeMonitor } from '../src/nodes.mjs';
import { buildServer } from '../src/server.mjs';

const FACTORY = '0x00000000000000000000000000000000000000fa';
const VAULT = '0x1111111111111111111111111111111111111111';
const COIN = '0x2222222222222222222222222222222222222222';
const BARE = '0x3333333333333333333333333333333333333333'; // an app without a node
const CREATOR = '0x4444444444444444444444444444444444444444';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** A chain that answers the reads a coin page makes. `fail` makes vault reads throw (RPC down). */
function fakeClient({ fail = false } = {}) {
  const values = {
    name: 'Fatline', symbol: 'FATLINE', decimals: 18,
    balance: 12_340_000n, pendingFees: 500_000n, aliveUntil: 2_000_000_000n, paidThrough: 1_900_000_000n, tier: 0,
    tiers: [{ ratePerSecond: 6n, minDau: 0 }], ratePerSecond: 6n, today: 20_000n, owner: CREATOR, keeper: CREATOR,
    billingPeriod: 2_592_000n, minCoinToCount: 0n, dauOf: 0,
  };
  return {
    readContract: async ({ address, functionName }) => {
      if (fail && address !== COIN) throw new Error('RPC down');
      if (!(functionName in values)) throw new Error(`unexpected read ${functionName}`);
      return values[functionName];
    },
    getBlockNumber: async () => 120n,
    getBlock: async ({ blockNumber }) => ({ timestamp: 1_700_000_000n + blockNumber }),
    getLogs: async ({ address }) => (address === USDC ? [
      // the factory's starting deposit (no vault event), and the transfer inside deposit() (already covered by Deposited)
      { address: USDC, blockNumber: 100n, logIndex: 3, transactionHash: '0x99', eventName: 'Transfer', args: { from: FACTORY, to: VAULT, value: 20_000_000n } },
      { address: USDC, blockNumber: 101n, logIndex: 1, transactionHash: '0xaa', eventName: 'Transfer', args: { from: CREATOR, to: VAULT, value: 20_000_000n } },
    ] : Array.isArray(address) && address.includes(VAULT) ? [
      { address: VAULT, blockNumber: 101n, logIndex: 0, transactionHash: '0xaa', eventName: 'Deposited', args: { from: CREATOR, amount: 20_000_000n, note: 'hello' } },
      { address: VAULT, blockNumber: 110n, logIndex: 1, transactionHash: '0xbb', eventName: 'Harvested', args: { amount: 1_500_000n } },
      { address: VAULT, blockNumber: 111n, logIndex: 0, transactionHash: '0xcc', eventName: 'ComputePaid', args: { keeper: CREATOR, amount: 15_550_000n, paidThrough: 1_900_000_000n } },
    ] : []),
  };
}

function setup({ fail = false, nodeApps = [VAULT], meta = {}, rpc = 'https://mainnet.base.org' } = {}) {
  const db = openDb(tmpdir(), ':memory:');
  const client = fakeClient({ fail });
  const launchpad = new Launchpad(db, { chainId: 8453, factory: FACTORY, fromBlock: 100, usdc: USDC }, { client });
  const ins = db.prepare('INSERT INTO apps (chain_id, vault, creator, owner, uri, coin, block_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run(8453, VAULT, CREATOR, CREATOR, appUri({ name: 'Fatline', ...meta }), COIN, 100, 1_700_000_100_000);
  ins.run(8453, BARE, CREATOR, CREATOR, appUri({ name: 'Bare' }), null, 100, 1_700_000_100_000);
  let clock = Date.now();
  const nodes = new NodeMonitor(db, [{ id: 'master', url: 'http://10.0.0.9:3381', publicUrl: 'http://46.225.208.199:3381', apps: nodeApps }], {
    fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }, now: () => clock,
  });
  // No Farcaster lookups in these tests: a network that has no node.
  const networks = { farcaster: { name: 'farcaster', get: async () => { throw new Error('no node'); } } };
  const coins = new Coins({ launchpad, nodes, networks, config: { defaultNetwork: 'farcaster', launchpad: { rpc } } });
  return { db, launchpad, nodes, coins, tick: (ms) => { clock += ms; } };
}

test('valid and invalid token addresses', () => {
  assert.equal(parseCoinRoute('8453', COIN).address, '0x2222222222222222222222222222222222222222');
  assert.equal(parseCoinRoute(8453, '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD').chainId, 8453); // all caps: no checksum to check
  assert.equal(parseCoinRoute(8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913').address, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  for (const bad of ['0x123', 'hello', `${COIN}00`, '0xZZ22222222222222222222222222222222222222', '']) {
    assert.throws(() => parseCoinRoute(8453, bad), (e) => e.status === 400, bad);
  }
  assert.throws(() => parseCoinRoute(8453, '0x833589fcD6eDb6E08f4c7C32D4f71b54bdA02913'), /checksum/); // one letter's case changed
  assert.throws(() => parseCoinRoute('base', COIN), (e) => e.status === 400);
});

test('coin resolves to its app, vault and operator-listed node; wrong chain is 404', async () => {
  const { coins } = setup();
  const c = await coins.get(8453, COIN);
  assert.equal(c.isCoin, true);
  assert.equal(c.coin.symbol, 'FATLINE');
  assert.equal(c.app.vault, VAULT);
  assert.equal(c.coin.link, `https://basescan.org/token/${COIN}`);
  assert.equal(c.nodes.length, 1);
  assert.equal(c.nodes[0].how, 'operator');
  assert.equal(c.nodes[0].status.url, 'http://46.225.208.199:3381', 'the public URL, never the probe URL');
  assert.equal(c.nodes[0].status.state, 'unknown', 'not probed yet');
  await assert.rejects(coins.get(1, COIN), (e) => e.status === 404);
  await assert.rejects(coins.get(8453, '0x5555555555555555555555555555555555555555'), (e) => e.status === 404);
});

test('a coin with no node gets none, not a guess', async () => {
  const { coins } = setup({ nodeApps: [] });
  assert.deepEqual((await coins.get(8453, COIN)).nodes, []);
  assert.deepEqual((await coins.get(8453, BARE)).nodes, []);
});

test('a node named onchain is used only if this server monitors it; other URLs are never fetched', async () => {
  const known = setup({ nodeApps: [], meta: { node: 'http://46.225.208.199:3381/' } });
  const a = await known.coins.get(8453, COIN);
  assert.equal(a.nodes[0].how, 'onchain');
  assert.equal(a.nodes[0].node, 'master');
  const unknown = setup({ nodeApps: [], meta: { node: 'http://169.254.169.254/' } });
  const b = await unknown.coins.get(8453, COIN);
  assert.equal(b.nodes[0].node, null);
  assert.equal(b.nodes[0].status, null);
});

test('missing treasury data: the page still resolves and says why', async () => {
  const { coins } = setup({ fail: true });
  const c = await coins.get(8453, COIN);
  assert.equal(c.treasury.balance, null);
  assert.match(c.treasury.error, /RPC down/);
  assert.equal(c.app.vault, VAULT);
});

test('a local fork gets no explorer links and is labeled', async () => {
  assert.equal(isLocalRpc('http://127.0.0.1:8545'), true);
  assert.equal(isLocalRpc('https://mainnet.base.org'), false);
  const c = await setup({ rpc: 'http://127.0.0.1:8545' }).coins.get(8453, COIN);
  assert.equal(c.chain.local, true);
  assert.equal(c.coin.link, null);
  assert.equal(c.app.trade, null);
});

test('vault events are indexed from the chain and become treasury history', async () => {
  const { coins, launchpad, nodes } = setup();
  await launchpad.syncOnce();
  const totals = launchpad.vaultTotals(VAULT);
  assert.deepEqual(totals, { Deposited: '40000000', Harvested: '1500000', ComputePaid: '15550000', Withdrawn: '0' }, 'starting deposit + deposit(), not counted twice');
  await nodes.checkAll(); // the node refuses: one "offline" event
  const { items } = coins.activity(8453, COIN);
  assert.deepEqual(items.map((i) => i.kind).slice(-5), ['ComputePaid', 'Harvested', 'Deposited', 'StartingDeposit', 'AppCreated']);
  assert.equal(items.find((i) => i.kind === 'StartingDeposit').account, CREATOR, 'credited to the creator, not the factory');
  assert.equal(items[0].kind, 'offline');
  assert.equal(items.find((i) => i.kind === 'Deposited').link, 'https://basescan.org/tx/0xaa');
  const idx = launchpad.indexerStatus();
  assert.equal(idx.state, 'ok');
  assert.equal(idx.lag, 0);
  assert.equal(idx.cursor, 120);
});

test('indexer status: lag and stale passes are not "ok"', () => {
  const { launchpad } = setup();
  assert.equal(launchpad.indexerStatus().state, 'unknown');
  launchpad.lastSyncAt = Date.now();
  launchpad.head = 10_000;
  launchpad.db.prepare("INSERT INTO sync_state (key, value) VALUES (?, '9000')").run(launchpad.stateKey);
  assert.equal(launchpad.indexerStatus().state, 'behind');
  launchpad.head = 9000;
  assert.equal(launchpad.indexerStatus(Date.now() + 10 * 60_000).state, 'stale');
});

test('HTTP: bad input is 400, API failures are reported, admin data is not exposed', async () => {
  const { coins, launchpad, nodes } = setup({ fail: true });
  const server = buildServer({ config: { appDir: '/nonexistent', dataDir: '/tmp' }, networks: {}, voices: { status: () => ({}) }, launchpad, nodes, coins });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/coin/8453/0x12`)).status, 400);
    assert.equal((await fetch(`${base}/api/coin/1/${COIN}`)).status, 404);
    const res = await fetch(`${base}/api/coin/8453/${COIN}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.treasury.error);
    const text = JSON.stringify(body) + JSON.stringify(await (await fetch(`${base}/api/nodes`)).json());
    assert.ok(!text.includes('10.0.0.9'), 'the private probe URL never reaches the browser');
    assert.equal((await fetch(`${base}/api/nodes/master`)).status, 200);
    assert.equal((await fetch(`${base}/api/nodes/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/coin/8453/${COIN}/activity?limit=5`)).status, 200);
  } finally { server.close(); }
});

test('Farcaster identity: verified only when the creator is the current custody address; slow nodes never block the page', async () => {
  const { launchpad, nodes } = setup();
  const answers = (custodyNow) => ({
    name: 'farcaster', label: 'Farcaster',
    get: async (path) => {
      if (path === '/v1/onChainIdRegistryEventByAddress') return { data: { fid: 18350 }, node: { url: 'http://n', own: false } };
      if (path === '/v1/onChainEventsByFid') return { data: { events: [
        { blockNumber: 1, logIndex: 0, idRegisterEventBody: { to: CREATOR } },
        { blockNumber: 2, logIndex: 0, idRegisterEventBody: { to: custodyNow } }] } };
      return { data: { data: { userDataBody: { value: 'anky' } } } };
    },
  });
  const make = (network) => new Coins({ launchpad, nodes, networks: { farcaster: network }, config: { defaultNetwork: 'farcaster' } });
  assert.deepEqual(await make(answers(CREATOR)).custodyFid(CREATOR), { fid: 18350, username: 'anky', network: 'farcaster', networkLabel: 'Farcaster', node: 'http://n', own: false, rule: 'custody' });
  assert.equal(await make(answers(BARE)).custodyFid(CREATOR), null, 'the FID moved to another wallet');
  const slow = { name: 'farcaster', get: () => new Promise(() => {}) };
  assert.deepEqual(await make(slow).custodyFid(CREATOR, 50), { pending: true });
});
