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
  'function launchFatline(uint256 fid, AppParams p, bytes deployCalldata, uint256 deposit) payable returns (address, address)',
  'function predictFatlinerVault(uint256 fid) view returns (address)',
  'function fatliners() view returns (address)',
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
const transferEvent = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])[0];

// The vault's own events: where its USDC came from and where it went. Indexed into vault_events.
export const vaultEventsAbi = parseAbi([
  'event Deposited(address indexed from, uint256 amount, string note)',
  'event Harvested(uint256 amount)',
  'event ComputePaid(address indexed keeper, uint256 amount, uint256 paidThrough)',
  'event Withdrawn(address indexed to, uint256 amount)',
  'event TierChanged(uint8 tier, uint256 ratePerSecond)',
  'event KeeperChanged(address keeper)',
]);

/** Reads a data: URI (or plain JSON) describing the app. Remote URIs are left for the browser. */
export function readUri(uri) {
  try {
    if (uri.startsWith('data:application/json;base64,')) return JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));
    if (uri.startsWith('data:application/json,')) return JSON.parse(decodeURIComponent(uri.slice(22)));
    if (uri.startsWith('{')) return JSON.parse(uri);
  } catch { /* fall through */ }
  return { link: uri };
}

export function appUri({ name, description = '', image = '', experience = null, node = null }) {
  // node: the public URL of the read node this app runs on. Optional; a monitored URL links the app to it.
  const json = JSON.stringify(node ? { name, description, image, experience, node } : { name, description, image, experience });
  return `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
}

export class Launchpad {
  constructor(db, { chainId, rpc, factory, fromBlock = 0, usdc = null } = {}, { client } = {}) {
    this.db = db;
    this.usdc = usdc ? getAddress(usdc) : null;
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
        submitted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (vault, day, person));
      CREATE TABLE IF NOT EXISTS vault_events (
        chain_id INTEGER NOT NULL, vault TEXT NOT NULL, block_number INTEGER NOT NULL, log_index INTEGER NOT NULL,
        tx_hash TEXT NOT NULL, kind TEXT NOT NULL, account TEXT, amount TEXT, detail TEXT, at INTEGER NOT NULL,
        PRIMARY KEY (chain_id, tx_hash, log_index));
      CREATE INDEX IF NOT EXISTS vault_events_time ON vault_events (chain_id, vault, block_number DESC, log_index DESC);`);
    this.vaultKey = `vaultEvents:${this.chainId}:${this.factory}`;
    this.head = null;
    this.lastSyncAt = null;
    this.lastErrorAt = null;
    this.intervalMs = 5_000;
    this.cache = new Map(); // vault -> { at, value }: live reads, shared by every viewer for a few seconds
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
    this.head = Number(head);
    applied += await this.syncVaultEvents(head);
    this.lastSyncAt = Date.now();
    this.lastError = null;
    return applied;
  }

  /** Indexes every known vault's money events, up to the block the app list is synced to. */
  async syncVaultEvents(head) {
    const saved = getState(this.db, this.vaultKey);
    let from = saved === null ? this.fromBlock : BigInt(saved) + 1n;
    let applied = 0;
    const insert = this.db.prepare(`INSERT OR IGNORE INTO vault_events (chain_id, vault, block_number, log_index, tx_hash, kind, account, amount, detail, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    while (from <= head) {
      const to = from + CHUNK - 1n < head ? from + CHUNK - 1n : head;
      const vaults = this.db.prepare('SELECT vault FROM apps WHERE chain_id = ? AND block_number <= ?').all(this.chainId, Number(to)).map((r) => r.vault);
      const logs = vaults.length ? await this.client.getLogs({ address: vaults, events: vaultEventsAbi, fromBlock: from, toBlock: to }) : [];
      // USDC that reaches a vault without a vault event: the starting deposit at birth (sent by the factory),
      // or someone sending USDC straight to the vault's address. Deposits and harvests already have their own event.
      if (vaults.length && this.usdc) {
        const covered = new Set(logs.filter((l) => l.eventName === 'Deposited' || l.eventName === 'Harvested').map((l) => `${l.transactionHash}:${l.address.toLowerCase()}`));
        const transfers = await this.client.getLogs({ address: this.usdc, event: transferEvent, args: { to: vaults }, fromBlock: from, toBlock: to });
        for (const t of transfers) {
          const vault = t.args.to.toLowerCase();
          if (covered.has(`${t.transactionHash}:${vault}`)) continue;
          // The factory moves the starting deposit in the birth transaction, from the creator (or from itself).
          const app = this.db.prepare('SELECT creator, block_number FROM apps WHERE chain_id = ? AND vault = ?').get(this.chainId, vault);
          const fromWho = t.args.from.toLowerCase();
          const birth = app && Number(t.blockNumber) === app.block_number && (fromWho === app.creator || fromWho === this.factory.toLowerCase());
          logs.push({ ...t, address: vault, eventName: birth ? 'StartingDeposit' : 'DirectTransfer', args: { from: birth ? app.creator : t.args.from, amount: t.args.value } });
        }
      }
      const times = new Map();
      for (const log of logs) {
        if (!times.has(log.blockNumber)) times.set(log.blockNumber, Number((await this.client.getBlock({ blockNumber: log.blockNumber })).timestamp) * 1000);
      }
      this.db.exec('BEGIN');
      try {
        for (const log of logs) {
          const a = log.args;
          const [account, amount, detail] = {
            Deposited: [a.from, a.amount, a.note],
            StartingDeposit: [a.from, a.amount, null],
            DirectTransfer: [a.from, a.amount, null],
            Harvested: [null, a.amount, null],
            ComputePaid: [a.keeper, a.amount, a.paidThrough?.toString()],
            Withdrawn: [a.to, a.amount, null],
            TierChanged: [null, a.ratePerSecond, String(a.tier)],
            KeeperChanged: [a.keeper, null, null],
          }[log.eventName] ?? [null, null, null];
          insert.run(this.chainId, log.address.toLowerCase(), Number(log.blockNumber), Number(log.logIndex), log.transactionHash, log.eventName,
            account ? account.toLowerCase() : null, amount === null || amount === undefined ? null : amount.toString(),
            detail === null || detail === undefined ? null : String(detail).slice(0, 500), times.get(log.blockNumber));
          applied++;
        }
        setState(this.db, this.vaultKey, to);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
      from = to + 1n;
    }
    return applied;
  }

  vaultEvents(vault, { before = Infinity, limit = 50 } = {}) {
    return this.db.prepare('SELECT * FROM vault_events WHERE chain_id = ? AND vault = ? AND at < ? ORDER BY block_number DESC, log_index DESC LIMIT ?')
      .all(this.chainId, vault.toLowerCase(), Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER, limit)
      .map((e) => ({ source: 'vault', at: e.at, kind: e.kind, account: e.account, amount: e.amount, detail: e.detail, tx: e.tx_hash, block: e.block_number }));
  }

  /** Totals per kind of money event, from the indexed history. */
  vaultTotals(vault) {
    const rows = this.db.prepare("SELECT kind, amount FROM vault_events WHERE chain_id = ? AND vault = ? AND kind IN ('Deposited','StartingDeposit','DirectTransfer','Harvested','ComputePaid','Withdrawn')")
      .all(this.chainId, vault.toLowerCase());
    const out = { Deposited: 0n, Harvested: 0n, ComputePaid: 0n, Withdrawn: 0n };
    // Every way people put USDC in counts as "deposited by people"; trading fees are separate.
    for (const r of rows) out[['StartingDeposit', 'DirectTransfer'].includes(r.kind) ? 'Deposited' : r.kind] += BigInt(r.amount ?? 0);
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.toString()]));
  }

  /** Live vault state, cached a few seconds so many viewers cost one set of RPC reads. */
  async cachedVaultState(vault, ttlMs = 15_000) {
    const hit = this.cache.get(vault);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await this.vaultState(vault);
    this.cache.set(vault, { at: Date.now(), value });
    return value;
  }

  start(intervalMs = 5_000) {
    if (!this.enabled) return;
    this.intervalMs = intervalMs;
    const tick = async () => {
      try { await this.syncOnce(); } catch (err) { this.lastError = err.shortMessage ?? err.message; this.lastErrorAt = Date.now(); }
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
  async prepare({ creator, owner, keeper, name, symbol, description = '', image = '', experience = null, node = null, coin = true, fid = null, billingDays = 30, startMarketCapUsd = 25_000 }) {
    if (!this.enabled) throw Object.assign(new Error('The launchpad is not configured (no factory address)'), { status: 503 });
    creator = getAddress(creator);
    const salt = keccak256(toHex(`${creator}:${name}:${Date.now()}`));
    let vault;
    if (coin) {
      // Coins are only for Fatliners, one each; the ticker is the Fatliner's surname (the launchpad checks).
      if (!fid) throw Object.assign(new Error('A coin needs a Fatliner: give its number (its FID).'), { status: 400 });
      const nft = await this.client.readContract({ address: this.factory, abi: factoryAbi, functionName: 'fatliners' });
      const nftAbi = parseAbi(['function isFatliner(uint256) view returns (bool)', 'function surnameOf(uint256) view returns (string)', 'function ownerOf(uint256) view returns (address)']);
      const read = (functionName) => this.client.readContract({ address: nft, abi: nftAbi, functionName, args: [BigInt(fid)] });
      if (!(await read('isFatliner').catch(() => false))) throw Object.assign(new Error(`#${fid} is not a hatched Fatliner.`), { status: 400 });
      if (getAddress(await read('ownerOf')) !== creator) throw Object.assign(new Error(`Only the holder of Fatliner #${fid} can launch its coin.`), { status: 403 });
      symbol = await read('surnameOf');
      name = name || symbol.charAt(0) + symbol.slice(1).toLowerCase();
      vault = await this.client.readContract({ address: this.factory, abi: factoryAbi, functionName: 'predictFatlinerVault', args: [BigInt(fid)] });
    } else {
      vault = await this.client.readContract({ address: this.factory, abi: factoryAbi, functionName: 'predictVault', args: [creator, salt] });
    }
    if (node !== null && node !== '' && !/^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(String(node))) throw Object.assign(new Error('The node must be a URL like http://1.2.3.4:3381'), { status: 400 });
    const uri = appUri({ name, description, image, experience, node: node || null });
    const params = { owner: getAddress(owner ?? creator), keeper: getAddress(keeper ?? creator), billingPeriod: String(billingDays * 86_400), uri, salt };
    const out = { chainId: this.chainId, factory: this.factory, vault, params, fid: coin ? Number(fid) : null, symbol: coin ? symbol : null };
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

  /**
   * Is this server's chain indexer keeping up? Healthy needs a recent successful pass and a small lag.
   * A running process with an old cursor is not healthy.
   */
  indexerStatus(now = Date.now()) {
    if (!this.enabled) return { state: 'off', reason: 'No launchpad contract is configured.' };
    const synced = getState(this.db, this.stateKey);
    const events = getState(this.db, this.vaultKey);
    const cursor = synced === null ? null : Number(synced);
    const lag = this.head !== null && cursor !== null ? Math.max(0, this.head - cursor) : null;
    const staleMs = Math.max(6 * this.intervalMs, 60_000);
    let state = 'ok';
    let reason = 'Indexed up to the chain head.';
    if (this.lastSyncAt === null) { state = 'unknown'; reason = this.lastError ? `No successful pass yet: ${this.lastError}` : 'No successful pass yet.'; }
    else if (now - this.lastSyncAt > staleMs) { state = 'stale'; reason = `Last successful pass ${Math.round((now - this.lastSyncAt) / 1000)} s ago${this.lastError ? `: ${this.lastError}` : ''}.`; }
    else if (lag !== null && lag > 50) { state = 'behind'; reason = `${lag} blocks behind the chain head.`; }
    return {
      state, reason, chainId: this.chainId, cursor, vaultEventsCursor: events === null ? null : Number(events), head: this.head, lag,
      lastSyncAt: this.lastSyncAt, error: this.lastError, errorAt: this.lastErrorAt,
    };
  }
}

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** What a person signs to say "I used this app on this day". Free, no gas. */
export function checkInTypedData(chainId, vault, day) {
  return {
    domain: { name: 'Fatline App', version: '1', chainId: Number(chainId), verifyingContract: getAddress(vault) },
    types: { CheckIn: [{ name: 'day', type: 'uint256' }] },
    primaryType: 'CheckIn',
    message: { day: BigInt(day) },
  };
}
