// One coin, everything verified about it: its app and vault, the node it runs on, its money, its history.
//
// coin -> app:  AppFactory's CoinLaunched(vault, coin) event, indexed into the apps table.
// app -> node:  only from two explicit, labeled sources, never guessed:
//               1. the operator of this server lists the app in config.masterNodes[].apps;
//               2. the app's own onchain metadata (its vault's uri) names a node URL that this server monitors.
//               A URL from the chain that this server does not monitor is shown, but never fetched.
import { getAddress, isAddress, parseAbi } from 'viem';

const erc20 = parseAbi(['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)']);
const EXPLORERS = { 8453: 'https://basescan.org', 84532: 'https://sepolia.basescan.org' };
const CHAIN_NAMES = { 8453: 'Base', 84532: 'Base Sepolia', 31337: 'Local chain' };

export const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Checks the route's chain id and address. Mixed-case addresses must have a valid checksum. */
export function parseCoinRoute(chainId, address) {
  if (!/^\d{1,12}$/.test(String(chainId))) throw httpError(400, 'The chain id must be a number, like 8453 for Base.');
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(address))) throw httpError(400, 'That is not a contract address (0x followed by 40 hex characters).');
  const hex = address.slice(2);
  const mixed = hex !== hex.toLowerCase() && hex !== hex.toUpperCase();
  if (mixed && !isAddress(address, { strict: true })) throw httpError(400, 'That address has an invalid checksum.');
  return { chainId: Number(chainId), address: getAddress(address.toLowerCase()) };
}

/** Is this chain a local fork or dev chain? Then explorer links would point at nothing. */
export function isLocalRpc(rpc) {
  try { return ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(new URL(rpc).hostname); } catch { return false; }
}

export class Coins {
  constructor({ launchpad, nodes, networks = {}, config = {}, keeper = null }) {
    this.launchpad = launchpad;
    this.nodes = nodes;
    this.networks = networks;
    this.config = config;
    this.keeper = keeper;
    this.local = isLocalRpc(config.launchpad?.rpc);
    this.tokens = new Map();
    this.fids = new Map();
  }

  chain() {
    const id = this.launchpad.chainId;
    const explorer = this.local ? null : EXPLORERS[id] ?? null;
    return { id, name: CHAIN_NAMES[id] ?? `Chain ${id}`, local: this.local, explorer };
  }

  link(kind, value) {
    const e = this.chain().explorer;
    return e && value ? `${e}/${kind}/${value}` : null;
  }

  async token(address) {
    if (!this.tokens.has(address)) {
      const read = (functionName) => this.launchpad.client.readContract({ address, abi: erc20, functionName }).catch(() => null);
      const [name, symbol, decimals] = await Promise.all([read('name'), read('symbol'), read('decimals')]);
      const value = { name: typeof name === 'string' ? name.slice(0, 80) : null, symbol: typeof symbol === 'string' ? symbol.slice(0, 20) : null, decimals: decimals === null ? null : Number(decimals) };
      if (name !== null || symbol !== null) this.tokens.set(address, value); // don't cache an RPC failure forever
      return value;
    }
    return this.tokens.get(address);
  }

  /**
   * The FID whose custody address is `address`, checked against the latest custody event. Cached 10 minutes.
   * Nodes can take many seconds to say "no FID", so the page never waits more than `waitMs` for it:
   * it gets { pending: true } and the answer arrives with the next refresh.
   */
  async custodyFid(address, waitMs = 1500) {
    const network = this.networks[this.config.defaultNetwork];
    if (!network || !address) return null;
    const key = `${network.name}:${address.toLowerCase()}`;
    const hit = this.fids.get(key);
    if (hit && Date.now() - hit.at < 600_000) return hit.value;
    this.lookups ??= new Map();
    if (!this.lookups.has(key)) this.lookups.set(key, this.#lookupFid(network, key, address).finally(() => this.lookups.delete(key)));
    const timeout = new Promise((r) => { setTimeout(() => r({ pending: true }), waitMs); });
    return Promise.race([this.lookups.get(key), timeout]);
  }

  async #lookupFid(network, key, address) {
    let value = null;
    try {
      const { data, node } = await network.get('/v1/onChainIdRegistryEventByAddress', { address });
      const fid = Number(data?.fid);
      if (fid > 0) {
        const { data: history } = await network.get('/v1/onChainEventsByFid', { fid, event_type: 'EVENT_TYPE_ID_REGISTER' });
        const latest = (history?.events ?? []).filter((e) => e.idRegisterEventBody?.to).sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex).at(-1);
        if (latest?.idRegisterEventBody.to.toLowerCase() === address.toLowerCase()) {
          let username = null;
          try {
            const { data: names } = await network.get('/v1/userDataByFid', { fid, user_data_type: 'USER_DATA_TYPE_USERNAME' });
            username = names?.data?.userDataBody?.value ?? null;
          } catch { /* the FID is still verified without a name */ }
          value = { fid, username, network: network.name, networkLabel: network.label, node: node.url, own: node.own, rule: 'custody' };
        }
      }
    } catch { value = undefined; }
    if (value !== undefined) this.fids.set(key, { at: Date.now(), value });
    return value ?? null;
  }

  /** The nodes tied to this app, each with how we know. */
  nodesFor(app) {
    const out = [];
    for (const n of this.nodes.forApp(app.vault, app.coin)) out.push({ node: n.id, how: 'operator', detail: 'Listed by the operator of this server.' });
    const declared = app.meta?.node;
    const declaredUrl = typeof declared === 'string' ? declared : declared?.url;
    if (declaredUrl) {
      const n = this.nodes.byPublicUrl(declaredUrl);
      if (n && !out.some((x) => x.node === n.id)) out.push({ node: n.id, how: 'onchain', detail: "Named in the app's onchain metadata." });
      else if (!n) out.push({ node: null, how: 'onchain', url: String(declaredUrl).slice(0, 200), detail: "Named in the app's onchain metadata, but this server does not monitor it." });
    }
    return out.map((a) => ({ ...a, status: a.node ? this.nodes.status(a.node) : null }));
  }

  async get(chainId, address) {
    const route = parseCoinRoute(chainId, address);
    if (!this.launchpad?.enabled) throw httpError(503, 'This server has no launchpad configured, so it knows no coins.');
    if (route.chainId !== this.launchpad.chainId) throw httpError(404, `This server indexes chain ${this.launchpad.chainId} only, not ${route.chainId}.`);
    const row = this.launchpad.find(route.address);
    if (!row) throw httpError(404, 'No app launched from this factory has that coin or vault.');
    const app = this.launchpad.describe(row);

    const [token, treasury, fid] = await Promise.all([
      row.coin ? this.token(row.coin) : null,
      this.treasury(row),
      this.custodyFid(row.creator),
    ]);
    const keeperHere = this.keeper && this.keeper.vault?.toLowerCase() === row.vault;
    return {
      chain: this.chain(),
      isCoin: Boolean(row.coin && row.coin === route.address.toLowerCase()),
      coin: row.coin ? { address: row.coin, ...token, link: this.link('token', row.coin) } : null,
      app: {
        name: app.meta?.name ?? null, description: app.meta?.description ?? null, image: app.meta?.image ?? null, experience: app.meta?.experience ?? null,
        vault: row.vault, creator: row.creator, owner: row.owner, createdAt: row.created_at, block: row.block_number,
        links: { vault: this.link('address', row.vault), creator: this.link('address', row.creator), owner: this.link('address', row.owner) },
        trade: this.chain().local ? null : app.trade,
      },
      identity: fid, // the creator's FID, only when their wallet is that FID's current custody address
      nodes: this.nodesFor(app),
      indexer: this.launchpad.indexerStatus(),
      treasury,
      server: { keeperForThisApp: Boolean(keeperHere), keeper: keeperHere ? this.keeper.account.address : null, keeperLast: keeperHere ? this.keeper.last : null },
      at: Date.now(),
    };
  }

  async treasury(row) {
    const totals = this.launchpad.vaultTotals(row.vault);
    let live = null;
    let error = null;
    try { live = await this.launchpad.cachedVaultState(row.vault); } catch (err) { error = err.shortMessage ?? err.message; }
    return {
      vault: row.vault,
      asset: 'USDC',
      balance: live?.balance ?? null, // USDC held by the vault right now
      pendingFees: live?.pendingFees ?? null, // trading fees waiting in Clanker's fee locker: not in the vault until harvest()
      aliveUntil: live?.aliveUntil ?? null,
      paidThrough: live?.paidThrough ?? null,
      alive: live?.alive ?? null,
      tier: live?.tier ?? null,
      tiers: live?.tiers ?? [],
      ratePerSecond: live?.ratePerSecond ?? null,
      keeper: live?.keeper ?? null,
      people: live ? { week: live.week, today: live.today, dau: live.dau, minCoinToCount: live.minCoinToCount } : null, // daily users, counted by the vault
      totals, // from indexed events: Deposited, Harvested (trading fees), ComputePaid (the server paying itself), Withdrawn
      readAt: live ? Date.now() : null,
      error,
    };
  }

  /** History: the app's birth, its vault's money events and its nodes' changes, newest first. All from durable sources. */
  activity(chainId, address, { before, limit = 40 } = {}) {
    const route = parseCoinRoute(chainId, address);
    if (!this.launchpad?.enabled || route.chainId !== this.launchpad.chainId) throw httpError(404, 'Unknown chain for this server.');
    const row = this.launchpad.find(route.address);
    if (!row) throw httpError(404, 'No app launched from this factory has that coin or vault.');
    const cap = Math.min(Math.max(Number(limit) || 40, 1), 100);
    const b = before ? Number(before) : Infinity;
    const nodeIds = this.nodesFor(this.launchpad.describe(row)).map((n) => n.node).filter(Boolean);
    const items = [
      ...this.launchpad.vaultEvents(row.vault, { before: b, limit: cap }).map((e) => ({ ...e, link: this.link('tx', e.tx) })),
      ...this.nodes.events(nodeIds, { before: b, limit: cap }),
      ...(row.created_at < b ? [{ source: 'app', at: row.created_at, kind: 'AppCreated', block: row.block_number }] : []),
    ].sort((x, y) => y.at - x.at).slice(0, cap);
    return { items, more: items.length === cap ? items.at(-1).at : null };
  }

  /** The overview for the main page: every monitored node and the apps tied to it. */
  overview() {
    const apps = this.launchpad?.enabled ? this.launchpad.rows() : [];
    return {
      nodes: this.nodes.list().map((s) => ({
        ...s,
        apps: apps.filter((r) => s.apps.includes(r.vault) || (r.coin && s.apps.includes(r.coin)))
          .map((r) => ({ vault: r.vault, coin: r.coin, name: this.launchpad.describe(r).meta?.name ?? null })),
      })),
      indexer: this.launchpad?.indexerStatus?.() ?? null,
      chain: this.launchpad?.enabled ? this.chain() : null,
      at: Date.now(),
    };
  }

  nodeDetail(id, { before, limit = 40 } = {}) {
    const status = this.nodes.status(id);
    if (!status) throw httpError(404, 'This server does not monitor a node with that id.');
    const ov = this.overview().nodes.find((n) => n.id === id);
    return { ...ov, events: this.nodes.events([id], { before: before ? Number(before) : Infinity, limit: Math.min(Number(limit) || 40, 100) }), at: Date.now() };
  }
}
