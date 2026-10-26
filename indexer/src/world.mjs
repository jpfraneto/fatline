// The world: this server's own copy of the Fatliners contract, the one contract of the Fatline world.
//
// Once an hour it reads the contract's events since the last time (in windows public RPCs accept), keeps them, and
// reads the current state of every token they touched. Everything lands in one SQLite file in the data folder
// (world.sqlite). Every frontend (fatline.ink, <surname>.fatline.ink, the mini app, the phone, the CLI) reads it
// from here (GET /world), not from the chain.
//
// The cursor moves only after a window is saved, so a failed hour is read again the next hour.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { parseAbi } from 'viem';

export const WINDOW = 10_000n; // blocks per getLogs (publicnode refuses over 50,000)
export const EVERY_MS = 3_600_000; // the Fatline's pace: once an hour
export const STAGES = ['none', 'egg', 'fatliner'];
export const STONES = ['ivory', 'marble', 'sandstone', 'basalt', 'moss', 'gold', 'opal'];

export const worldEvents = parseAbi([
  'event AttesterJoined(address indexed attester, uint256 indexed fid, string url)',
  'event UrlChanged(address indexed attester, string url)',
  'event EggTaken(uint256 indexed fid, address indexed to, address indexed server, bytes32 dna, uint64 laidAt)',
  'event EggMoved(uint256 indexed fid, address indexed server, string url)',
  'event Stone(uint256 indexed fid, uint8 stone)',
  'event AppSet(uint256 indexed fid, address indexed app)',
  'event Born(uint256 indexed fid, address indexed to, string surname, bytes32 dna, address server, uint256 signers)',
  'event FidLinked(uint256 indexed fatliner, uint256 indexed fid, address indexed holder)',
  'event Died(uint256 indexed fid, uint256 hibernatingUntil)',
  'event Listed(uint256 indexed fid, address indexed holder, uint256 price)',
  'event Sold(uint256 indexed fid, address indexed from, address indexed to, uint256 price)',
  'event Order(bytes32 root, uint64 start)',
  'event FatlineBorn(uint256 indexed fid, address indexed vault)',
  'event CoinLaunched(address indexed vault, address indexed coin)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

const views = parseAbi([
  'function stageOf(uint256) view returns (uint8)',
  'function ownerOf(uint256) view returns (address)',
  'function surnameOf(uint256) view returns (string)',
  'function stoneOf(uint256) view returns (uint8)',
  'function dnaOf(uint256) view returns (bytes32)',
  'function laidAtOf(uint256) view returns (uint64)',
  'function serverOf(uint256) view returns (address)',
  'function serverUrlOf(uint256) view returns (string)',
  'function appOf(uint256) view returns (address)',
  'function linkedFidOf(uint256) view returns (uint256)',
  'function priceOf(uint256) view returns (uint256)',
  'function vaultOfFatliner(uint256) view returns (address)',
  'function coinOfFatliner(uint256) view returns (address)',
  'function hibernatingUntil(uint256) view returns (uint256)',
  'function hatcheries() view returns (address[] who, string[] urls)',
  'function threshold() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function liveEggs() view returns (uint256)',
  'function eggCount() view returns (uint256)',
  'function coinsLaunched() view returns (uint256)',
  'function maxSupply() view returns (uint256)',
  'function genesisFid() view returns (uint256)',
  'function orderRoot() view returns (bytes32)',
]);
const PER_TOKEN = ['stageOf', 'ownerOf', 'surnameOf', 'stoneOf', 'dnaOf', 'laidAtOf', 'serverOf', 'serverUrlOf', 'appOf', 'linkedFidOf', 'priceOf', 'vaultOfFatliner', 'coinOfFatliner', 'hibernatingUntil'];
const SUMMARY = ['hatcheries', 'threshold', 'totalSupply', 'liveEggs', 'eggCount', 'coinsLaunched', 'maxSupply', 'genesisFid', 'orderRoot'];
const ZERO = '0x0000000000000000000000000000000000000000';
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'; // on Base, and on any fork of it
const n = (v) => (v === null || v === undefined ? null : Number(v));
const plain = (v) => (typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);

export class World {
  /** client: viem public client (getBlockNumber, getLogs, multicall). fromBlock: the contract's deploy block. */
  constructor({ client, address, chainId, fromBlock = 0, dataDir, file = 'world.sqlite', now = () => Date.now(), log = console.log }) {
    this.client = client;
    this.address = address;
    this.chainId = chainId;
    this.fromBlock = BigInt(fromBlock);
    this.now = now;
    this.log = log;
    this.db = new DatabaseSync(file === ':memory:' ? ':memory:' : join(dataDir, file));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS world_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS world_events (
        block INTEGER NOT NULL, log_index INTEGER NOT NULL, tx TEXT NOT NULL, name TEXT NOT NULL, fid INTEGER, args TEXT NOT NULL,
        PRIMARY KEY (block, log_index));
      CREATE TABLE IF NOT EXISTS world_tokens (fid INTEGER PRIMARY KEY, state TEXT NOT NULL, block INTEGER NOT NULL);
    `);
    this.lastError = null;
  }

  get(key) { return this.db.prepare('SELECT value FROM world_state WHERE key = ?').get(key)?.value ?? null; }
  set(key, value) { this.db.prepare('INSERT INTO world_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value)); }

  /** Reads everything new since the last time. Returns how many events it kept. */
  async sync() {
    const head = await this.client.getBlockNumber();
    const saved = this.get('block');
    let from = saved === null ? this.fromBlock : BigInt(saved) + 1n;
    let kept = 0;
    // Tokens whose state must be read again: saved with their events, cleared only once read.
    const touched = new Set(JSON.parse(this.get('pending') ?? '[]'));
    const insert = this.db.prepare('INSERT OR IGNORE INTO world_events (block, log_index, tx, name, fid, args) VALUES (?, ?, ?, ?, ?, ?)');
    while (from <= head) {
      const to = from + WINDOW - 1n < head ? from + WINDOW - 1n : head;
      const logs = await this.client.getLogs({ address: this.address, events: worldEvents, fromBlock: from, toBlock: to });
      this.db.exec('BEGIN');
      try {
        for (const l of logs) {
          const a = l.args ?? {};
          let fid = a.fid ?? a.fatliner ?? a.tokenId ?? null;
          if (fid === null && l.eventName === 'CoinLaunched') fid = this.fidOfVault(a.vault);
          if (fid !== null) touched.add(Number(fid));
          insert.run(Number(l.blockNumber), Number(l.logIndex), l.transactionHash, l.eventName, fid === null ? null : Number(fid), JSON.stringify(plain(a)));
          kept++;
        }
        this.set('block', to);
        this.set('pending', JSON.stringify([...touched]));
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
      from = to + 1n;
    }
    if (touched.size) {
      await this.refresh([...touched], head);
      this.set('pending', '[]');
    }
    if (kept || this.get('summary') === null) await this.refreshSummary();
    this.set('head', head);
    this.set('syncedAt', this.now());
    this.lastError = null;
    return kept;
  }

  fidOfVault(vault) {
    if (!vault) return null;
    for (const r of this.db.prepare('SELECT fid, state FROM world_tokens').all()) {
      if (JSON.parse(r.state).vault?.toLowerCase() === vault.toLowerCase()) return r.fid;
    }
    return null;
  }

  /** The current state of these tokens, read from the contract in one multicall. */
  async refresh(fids, block) {
    const calls = fids.flatMap((fid) => PER_TOKEN.map((functionName) => ({ address: this.address, abi: views, functionName, args: [BigInt(fid)] })));
    const res = await this.client.multicall({ contracts: calls, allowFailure: true, multicallAddress: MULTICALL3 });
    const put = this.db.prepare('INSERT INTO world_tokens (fid, state, block) VALUES (?, ?, ?) ON CONFLICT(fid) DO UPDATE SET state = excluded.state, block = excluded.block');
    fids.forEach((fid, i) => {
      const v = Object.fromEntries(PER_TOKEN.map((name, j) => [name, res[i * PER_TOKEN.length + j]]));
      const ok = (name) => (v[name]?.status === 'success' ? v[name].result : null);
      const addr = (name) => { const x = ok(name); return x && x !== ZERO ? x.toLowerCase() : null; };
      const stone = ok('stoneOf');
      const state = {
        fid,
        stage: STAGES[Number(ok('stageOf') ?? 0)] ?? 'none',
        holder: addr('ownerOf'), // null once burned (an egg that died)
        surname: ok('surnameOf') || null,
        stone: stone === null ? null : STONES[Number(stone)] ?? null,
        dna: ok('dnaOf'),
        laidAt: ok('laidAtOf') === null ? null : Number(ok('laidAtOf')),
        server: addr('serverOf'),
        hatchery: ok('serverUrlOf') || null,
        app: addr('appOf'),
        linkedFid: ok('linkedFidOf') === null ? null : Number(ok('linkedFidOf')), // 0: asleep after a sale
        price: ok('priceOf') === null ? null : String(ok('priceOf')), // USDC, 6 decimals; 0 = not for sale
        vault: addr('vaultOfFatliner'),
        coin: addr('coinOfFatliner'),
        hibernatingUntil: Number(ok('hibernatingUntil') ?? 0) || null,
      };
      put.run(fid, JSON.stringify(plain(state)), Number(block));
    });
  }

  async refreshSummary() {
    const res = await this.client.multicall({ contracts: SUMMARY.map((functionName) => ({ address: this.address, abi: views, functionName })), allowFailure: true, multicallAddress: MULTICALL3 });
    const v = Object.fromEntries(SUMMARY.map((name, i) => [name, res[i]?.status === 'success' ? res[i].result : null]));
    const [who = [], urls = []] = v.hatcheries ?? [];
    this.set('summary', JSON.stringify(plain({
      attesters: who.map((address, i) => ({ address: address.toLowerCase(), hatchery: urls[i] })),
      threshold: n(v.threshold), fatliners: n(v.totalSupply), liveEggs: n(v.liveEggs), eggsEver: n(v.eggCount), coins: n(v.coinsLaunched),
      places: n(v.maxSupply), genesisFid: n(v.genesisFid), ranking: v.orderRoot && /^0x0+$/.test(v.orderRoot) ? null : v.orderRoot,
    })));
  }

  tokens() {
    return this.db.prepare('SELECT state FROM world_tokens ORDER BY fid').all().map((r) => JSON.parse(r.state));
  }

  events(limit = 50) {
    return this.db.prepare('SELECT block, log_index, tx, name, fid, args FROM world_events ORDER BY block DESC, log_index DESC LIMIT ?')
      .all(Math.min(500, Math.max(1, Number(limit) || 50)))
      .map((r) => ({ block: r.block, logIndex: r.log_index, tx: r.tx, name: r.name, fid: r.fid, args: JSON.parse(r.args) }));
  }

  /** What GET /world answers. warmth(fid): this hatchery's checks of that egg, if it keeps any. */
  view(warmth = () => null) {
    const syncedAt = Number(this.get('syncedAt') ?? 0) || null;
    return {
      contract: this.address, chainId: this.chainId,
      syncedBlock: this.get('block') === null ? null : Number(this.get('block')),
      syncedAt, nextAt: syncedAt ? syncedAt + EVERY_MS : null, error: this.lastError,
      ...(JSON.parse(this.get('summary') ?? '{}')),
      tokens: this.tokens().filter((t) => t.stage !== 'none').map((t) => ({ ...t, warmth: warmth(t.fid) })),
    };
  }
}
