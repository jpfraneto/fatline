// The launchpad: every app born from AppFactory, its coin, and the state of its USDC vault.
import { createPublicClient, getAddress, http, keccak256, parseAbi, toHex } from 'viem';
import { getState, setState } from './db.mjs';
import { buildLaunch } from './launch.mjs';

export const factoryAbi = parseAbi([
  'event AppCreated(address indexed vault, address indexed creator, address indexed owner, string uri)',
  'event CoinLaunched(address indexed vault, address indexed coin)',
  'function predictVault(address creator, bytes32 salt) view returns (address)',
  'function usdc() view returns (address)',
  'struct AppParams { address owner; address keeper; uint256 billingPeriod; string uri; bytes32 salt; }',
  'function createApp(AppParams p, uint256 deposit) returns (address)',
  'function launchApp(AppParams p, bytes deployCalldata, uint256 deposit) payable returns (address, address)',
  'function launchAppWithPermit(AppParams p, bytes deployCalldata, uint256 deposit, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable returns (address, address)',
]);

export const vaultAbi = parseAbi([
  'struct Tier { uint64 ratePerSecond; uint32 minDau; }',
  'function owner() view returns (address)',
  'function keeper() view returns (address)',
  'function coin() view returns (address)',
  'function uri() view returns (string)',
  'function balance() view returns (uint256)',
  'function pendingFees() view returns (uint256)',
  'function aliveUntil() view returns (uint256)',
  'function paidThrough() view returns (uint256)',
  'function billingPeriod() view returns (uint256)',
  'function tier() view returns (uint8)',
  'function tiers() view returns (Tier[])',
  'function ratePerSecond() view returns (uint256)',
  'function today() view returns (uint256)',
  'function dau() view returns (uint32)',
  'function dauOf(uint256 day) view returns (uint32)',
  'function checkedIn(uint256 day, address person) view returns (bool)',
  'function minCoinToCount() view returns (uint256)',
  'function checkIn()',
  'function checkInFor(address[] people, uint256[] days_, bytes[] signatures) returns (uint256)',
  'function computeDue() view returns (uint256 amount, uint256 newPaidThrough)',
  'function deposit(uint256 amount, string note)',
  'function harvest() returns (uint256)',
  'function payCompute() returns (uint256)',
]);

const CHUNK = 2_000n;

/** Reads a data: URI (or plain JSON) describing the app. Remote URIs are left for the browser. */
export function readUri(uri) {
  try {
    if (uri.startsWith('data:application/json;base64,')) return JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));
    if (uri.startsWith('data:application/json,')) return JSON.parse(decodeURIComponent(uri.slice(22)));
    if (uri.startsWith('{')) return JSON.parse(uri);
  } catch { /* fall through */ }
  return { link: uri };
}

export function appUri({ name, description = '', image = '', experience = null }) {
  const json = JSON.stringify({ name, description, image, experience });
  return `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
}

export class Launchpad {
  constructor(db, { chainId, rpc, factory, fromBlock = 0 } = {}, { client } = {}) {
    this.db = db;
    this.chainId = Number(chainId ?? 0);
    this.factory = factory ? getAddress(factory) : null;
    this.fromBlock = BigInt(fromBlock ?? 0);
    this.client = client ?? (rpc ? createPublicClient({ transport: http(rpc) }) : null);
    this.stateKey = `launchpad:${this.chainId}:${this.factory}`;
    this.lastError = null;
    db.exec(`CREATE TABLE IF NOT EXISTS apps (
      chain_id INTEGER NOT NULL, vault TEXT NOT NULL, creator TEXT NOT NULL, owner TEXT NOT NULL,
      uri TEXT NOT NULL, coin TEXT, block_number INTEGER NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (chain_id, vault));
      CREATE INDEX IF NOT EXISTS apps_coin ON apps (chain_id, coin);
      CREATE TABLE IF NOT EXISTS checkins (
        vault TEXT NOT NULL, day INTEGER NOT NULL, person TEXT NOT NULL, signature TEXT NOT NULL,
        submitted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (vault, day, person));`);
  }

  get enabled() {
    return Boolean(this.factory && this.client);
  }

  async syncOnce() {
    if (!this.enabled) return 0;
    const head = await this.client.getBlockNumber();
    const saved = getState(this.db, this.stateKey);
    let from = saved === null ? this.fromBlock : BigInt(saved) + 1n;
    let applied = 0;
    const insert = this.db.prepare(`INSERT OR IGNORE INTO apps (chain_id, vault, creator, owner, uri, coin, block_number, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`);
    const setCoin = this.db.prepare('UPDATE apps SET coin = ? WHERE chain_id = ? AND vault = ?');
    while (from <= head) {
      const to = from + CHUNK - 1n < head ? from + CHUNK - 1n : head;
      const logs = await this.client.getLogs({ address: this.factory, events: factoryAbi.filter((x) => x.type === 'event'), fromBlock: from, toBlock: to });
      const times = new Map();
      for (const log of logs) {
        if (log.eventName === 'AppCreated' && !times.has(log.blockNumber)) {
          times.set(log.blockNumber, Number((await this.client.getBlock({ blockNumber: log.blockNumber })).timestamp) * 1000);
        }
      }
      this.db.exec('BEGIN');
      try {
        for (const log of logs) {
          const a = log.args;
          if (log.eventName === 'AppCreated') {
            insert.run(this.chainId, a.vault.toLowerCase(), a.creator.toLowerCase(), a.owner.toLowerCase(), a.uri, Number(log.blockNumber), times.get(log.blockNumber));
          } else {
            setCoin.run(a.coin.toLowerCase(), this.chainId, a.vault.toLowerCase());
          }
          applied++;
        }
        setState(this.db, this.stateKey, to);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
      from = to + 1n;
    }
    this.lastError = null;
    return applied;
  }

  start(intervalMs = 5_000) {
    if (!this.enabled) return;
    const tick = async () => {
      try { await this.syncOnce(); } catch (err) { this.lastError = err.shortMessage ?? err.message; }
      this.timer = setTimeout(tick, intervalMs);
    };
    tick();
  }

  stop() { clearTimeout(this.timer); }

  rows() {
    return this.db.prepare('SELECT * FROM apps WHERE chain_id = ? ORDER BY created_at DESC').all(this.chainId);
  }

  find(address) {
    const a = address.toLowerCase();
    return this.db.prepare('SELECT * FROM apps WHERE chain_id = ? AND (vault = ? OR coin = ?)').get(this.chainId, a, a) ?? null;
  }

  /** Live vault numbers, read from the chain. */
  async vaultState(vault) {
    const read = (functionName) => this.client.readContract({ address: vault, abi: vaultAbi, functionName });
    const [balance, pendingFees, aliveUntil, paidThrough, tier, tiers, rate, today, owner, keeper, billingPeriod, minCoinToCount] = await Promise.all(
      ['balance', 'pendingFees', 'aliveUntil', 'paidThrough', 'tier', 'tiers', 'ratePerSecond', 'today', 'owner', 'keeper', 'billingPeriod', 'minCoinToCount'].map(read));
    // Daily active users, straight from the app's contract: the last 7 days, oldest first, today last.
    const week = await Promise.all([6, 5, 4, 3, 2, 1, 0].map(async (ago) => {
      const day = today - BigInt(ago);
      return { day: Number(day), date: new Date(Number(day) * 86_400_000).toISOString().slice(0, 10), users: Number(await this.client.readContract({ address: vault, abi: vaultAbi, functionName: 'dauOf', args: [day] })) };
    }));
    const queued = this.db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE vault = ? AND day = ? AND submitted = 0').get(vault.toLowerCase(), Number(today)).n;
    return {
      balance: balance.toString(),
      pendingFees: pendingFees.toString(),
      aliveUntil: Number(aliveUntil) * 1000,
      paidThrough: Number(paidThrough) * 1000,
      alive: Number(paidThrough) * 1000 > Date.now(),
      tier: Number(tier),
      tiers: tiers.map((t) => ({ ratePerSecond: t.ratePerSecond.toString(), minDau: t.minDau, usdPer30Days: Number(t.ratePerSecond) * 2_592_000 / 1e6 })),
      ratePerSecond: rate.toString(),
      dau: week[5].users, // the last complete day: this is what unlocks tiers
      today: { day: Number(today), users: week[6].users, queued },
      week,
      minCoinToCount: minCoinToCount.toString(),
      owner, keeper,
      billingPeriodDays: Number(billingPeriod) / 86_400,
    };
  }

  describe(row) {
    return {
      vault: row.vault, coin: row.coin, creator: row.creator, owner: row.owner,
      createdAt: row.created_at, uri: row.uri, meta: readUri(row.uri),
      trade: row.coin ? `https://app.uniswap.org/swap?chain=base&inputCurrency=${USDC_BASE}&outputCurrency=${row.coin}` : null,
    };
  }

  async coinSymbol(coin) {
    if (!coin) return null;
    this.symbols ??= new Map();
    if (!this.symbols.has(coin)) {
      const symbol = await this.client.readContract({ address: coin, abi: parseAbi(['function symbol() view returns (string)']), functionName: 'symbol' }).catch(() => null);
      this.symbols.set(coin, symbol);
    }
    return this.symbols.get(coin);
  }

  async full(row) {
    const [state, symbol] = await Promise.all([this.vaultState(row.vault).catch(() => null), this.coinSymbol(row.coin)]);
    return { ...this.describe(row), symbol, state };
  }

  async list() {
    return Promise.all(this.rows().map((row) => this.full(row)));
  }

  async get(address) {
    const row = this.find(address);
    return row ? this.full(row) : null;
  }

  /**
   * Everything the browser needs to launch an app in one transaction: the predicted vault, the
   * Clanker deployment (fees 100% to that vault, in USDC) and the app params.
   */
  async prepare({ creator, owner, keeper, name, symbol, description = '', image = '', experience = null, coin = true, billingDays = 30, startMarketCapUsd = 25_000 }) {
    if (!this.enabled) throw Object.assign(new Error('The launchpad is not configured (no factory address)'), { status: 503 });
    creator = getAddress(creator);
    const salt = keccak256(toHex(`${creator}:${name}:${Date.now()}`));
    const vault = await this.client.readContract({ address: this.factory, abi: factoryAbi, functionName: 'predictVault', args: [creator, salt] });
    const uri = appUri({ name, description, image, experience });
    const params = { owner: getAddress(owner ?? creator), keeper: getAddress(keeper ?? creator), billingPeriod: String(billingDays * 86_400), uri, salt };
    const out = { chainId: this.chainId, factory: this.factory, vault, params };
    if (coin) {
      const launch = await buildLaunch({ vault, tokenAdmin: params.owner, name, symbol, image, description, chainId: this.chainId, startMarketCapUsd, salt });
      out.deployCalldata = launch.data;
      out.value = launch.value.toString();
    }
    return out;
  }

  /**
   * A free check-in: the person signed "I was here on day N" for this app. We verify the signature
   * (plain or smart wallet) and queue it; the app's server submits the queue onchain in batches,
   * where the contract verifies every signature again and counts unique people.
   */
  async queueCheckIn(vault, { person, day, signature }) {
    const row = this.find(vault);
    if (!row) throw Object.assign(new Error('No app with that vault'), { status: 404 });
    person = getAddress(person);
    const today = Number(await this.client.readContract({ address: row.vault, abi: vaultAbi, functionName: 'today' }));
    if (Number(day) !== today) throw Object.assign(new Error('A check-in must be for today'), { status: 400 });
    const valid = await this.client.verifyTypedData({
      address: person, signature, ...checkInTypedData(this.chainId, row.vault, day),
    });
    if (!valid) throw Object.assign(new Error('Invalid signature'), { status: 400 });
    const already = await this.client.readContract({ address: row.vault, abi: vaultAbi, functionName: 'checkedIn', args: [BigInt(day), person] });
    if (already) return { status: 'counted' };
    this.db.prepare('INSERT OR IGNORE INTO checkins (vault, day, person, signature) VALUES (?, ?, ?, ?)')
      .run(row.vault, Number(day), person.toLowerCase(), signature);
    return { status: 'queued' };
  }

  pendingCheckIns(vault, minDay, limit = 200) {
    return this.db.prepare('SELECT * FROM checkins WHERE vault = ? AND submitted = 0 AND day >= ? LIMIT ?').all(vault.toLowerCase(), minDay, limit);
  }

  markSubmitted(rows) {
    const mark = this.db.prepare('UPDATE checkins SET submitted = 1 WHERE vault = ? AND day = ? AND person = ?');
    for (const r of rows) mark.run(r.vault, r.day, r.person);
  }

  status() {
    return { enabled: this.enabled, factory: this.factory, chainId: this.chainId, synced: getState(this.db, this.stateKey), error: this.lastError };
  }
}

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** What a person signs to say "I used this app on this day". Free, no gas. */
export function checkInTypedData(chainId, vault, day) {
  return {
    domain: { name: 'Infinicaster App', version: '1', chainId: Number(chainId), verifyingContract: getAddress(vault) },
    types: { CheckIn: [{ name: 'day', type: 'uint256' }] },
    primaryType: 'CheckIn',
    message: { day: BigInt(day) },
  };
}
