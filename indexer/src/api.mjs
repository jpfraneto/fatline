// The HTTP API the apps read from. Every answer says which network and which node it came from,
// so a reader always knows whether they are on their own node or someone else's.
import { decodeAbiParameters } from 'viem';
import { ethAddresses, normalizeCast, normalizeUser, renderMentions, toFc } from './hub.mjs';

const KEY_REQUEST = [{ type: 'tuple', components: [
  { name: 'requestFid', type: 'uint256' }, { name: 'requestSigner', type: 'address' }, { name: 'signature', type: 'bytes' }, { name: 'deadline', type: 'uint256' }] }];

/**
 * The FID of the app that asked for this key, read from the record itself:
 * onchain keys carry SignedKeyRequestMetadata (metadataType 1) with requestFid; gasless keys may carry requestFid directly.
 * Returns null when the record does not say. Never guessed.
 */
export function appFidOf(signer) {
  const direct = Number(signer?.requestFid ?? signer?.request_fid ?? 0);
  if (direct > 0) return direct;
  const body = signer?.onChainEvent?.signerEventBody;
  if (body?.metadata && Number(body.metadataType) === 1) {
    try {
      const [m] = decodeAbiParameters(KEY_REQUEST, `0x${Buffer.from(body.metadata, 'base64').toString('hex')}`);
      return Number(m.requestFid) || null;
    } catch { return null; }
  }
  return null;
}

/** Which casts to keep, given the reader's choice: hide some apps, or show only some, and a rule for unknown apps. */
export function appFilter({ hide = [], only = [], unknown = 'show' } = {}) {
  const hidden = new Set(hide.map(Number));
  const kept = new Set(only.map(Number));
  return (cast) => {
    if (cast.kind !== 'cast') return true; // voices are onchain, not made by an app
    const app = cast.app?.fid ?? null;
    if (kept.size) return app !== null && kept.has(app); // "only these apps" leaves unknown ones out
    if (app === null) return unknown !== 'hide';
    return !hidden.has(app);
  };
}

const CACHE_MS = 10 * 60_000;
const MAX_FIDS = 50;

class TtlCache {
  constructor(ms) { this.ms = ms; this.map = new Map(); }
  async get(key, load) {
    const hit = this.map.get(key);
    if (hit && Date.now() - hit.at < this.ms) return hit.value;
    const value = await load();
    this.map.set(key, { value, at: Date.now() });
    if (this.map.size > 20_000) this.map.delete(this.map.keys().next().value);
    return value;
  }
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export class Api {
  constructor({ config, networks, voices, launchpad }) {
    this.config = config;
    this.launchpad = launchpad;
    this.networks = networks;
    this.voices = voices;
    this.users = new TtlCache(CACHE_MS);
    this.verified = new TtlCache(CACHE_MS);
    this.signers = new TtlCache(CACHE_MS);
  }

  /** signer key -> app FID, for one author. One request per author per 10 minutes. */
  async appsOf(network, fid) {
    return this.signers.get(`${network.name}:${fid}`, async () => {
      const map = new Map();
      try {
        const { data } = await network.get('/v1/signersByFid', { fid });
        for (const s of data?.signers ?? []) if (typeof s.key === 'string') map.set(s.key.toLowerCase(), appFidOf(s));
      } catch { /* unknown apps, shown by the stated rule */ }
      return map;
    });
  }

  /** Tags each cast with the app that made it, when its key's record says so. */
  async withApps(network, casts) {
    const byFid = new Map();
    await Promise.all([...new Set(casts.map((c) => c.fid))].map(async (fid) => byFid.set(fid, await this.appsOf(network, fid))));
    return casts.map((c) => {
      const appFid = c.signer ? byFid.get(c.fid)?.get(c.signer) ?? null : null;
      return { ...c, app: appFid ? { fid: appFid } : null };
    });
  }

  /**
   * The network to read: a name, or { name, node } when the person chose a node (then only that node is used),
   * or an already chosen network passed along.
   */
  network(choice) {
    if (choice && typeof choice.get === 'function') return choice;
    const { name, node } = choice && typeof choice === 'object' ? choice : { name: choice };
    const n = this.networks[name || this.config.defaultNetwork];
    if (!n) throw httpError(400, `Unknown network "${name}". Choose one of: ${Object.keys(this.networks).join(', ')}`);
    return node ? n.pinned(node) : n;
  }

  config_() {
    return {
      defaultNetwork: this.config.defaultNetwork,
      networks: Object.values(this.networks).map((n) => ({ name: n.name, label: n.label, about: n.about })),
      voices: { chainId: this.config.voices.chainId, address: this.voices.address },
      launchpad: this.launchpad?.enabled ? { chainId: this.launchpad.chainId, factory: this.launchpad.factory, usdc: this.config.launchpad?.usdc ?? null } : null,
    };
  }

  async networksStatus() {
    await Promise.all(Object.values(this.networks).map((n) => n.refresh()));
    return Object.values(this.networks).map((n) => n.describe());
  }

  async user(network, fid) {
    return this.users.get(`${network.name}:${fid}`, async () => {
      const { data } = await network.get('/v1/userDataByFid', { fid });
      return normalizeUser(Number(fid), data?.messages);
    });
  }

  async usersFor(network, fids) {
    const unique = [...new Set(fids.filter(Boolean).map(Number))];
    const entries = await Promise.all(unique.map(async (fid) => [fid, await this.user(network, fid).catch(() => null)]));
    return Object.fromEntries(entries.filter(([, u]) => u));
  }

  /** True when `address` is a verified Ethereum address of `fid` on this network. */
  async addressBelongsTo(network, fid, address) {
    const addresses = await this.verified.get(`${network.name}:${fid}`, async () => {
      const { data } = await network.get('/v1/verificationsByFid', { fid });
      return ethAddresses(data?.messages);
    });
    return addresses.includes(address.toLowerCase());
  }

  async withVerification(network, voices) {
    return Promise.all(voices.map(async (v) => {
      if (!v.claimedFid) return { ...v, fid: null, verified: null };
      const ok = await this.addressBelongsTo(network, v.claimedFid, v.author).catch(() => null);
      return { ...v, fid: ok ? v.claimedFid : null, verified: ok, verifiedOn: network.name };
    }));
  }

  async renderCasts(network, casts) {
    const mentioned = casts.flatMap((c) => c.mentions);
    const names = await this.usersFor(network, mentioned);
    const usernames = new Map(Object.values(names).map((u) => [u.fid, u.username]));
    return casts.map((c) => ({ ...c, text: renderMentions(c, usernames) }));
  }

  async casts(networkName, { fid, before, limit = 30, replies = false }) {
    const network = this.network(networkName);
    const params = { fid, pageSize: Math.min(limit * 2, 100), reverse: true };
    if (before) params.stopTimestamp = toFc(before);
    const { data, node } = await network.get('/v1/castsByFid', params);
    let casts = (data?.messages ?? [])
      .filter((m) => m.data?.type === 'MESSAGE_TYPE_CAST_ADD')
      .map((m) => normalizeCast(m, network.name))
      .filter((c) => !before || c.timestamp < before);
    if (!replies) casts = casts.filter((c) => !c.parent);
    return { casts: casts.slice(0, limit), source: network.source(node) };
  }

  /**
   * The quiet feed: long-form voices plus the casts of the people you chose, nothing else.
   * With no fids, it shows every voice and no casts.
   */
  async feed(networkName, { fids = [], before, limit = 30, replies = false, apps = {} }) {
    const network = this.network(networkName);
    limit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    fids = [...new Set(fids.map(Number).filter((f) => Number.isInteger(f) && f > 0))].slice(0, MAX_FIDS);

    let voices = [];
    if (this.voices.enabled) {
      voices = await this.withVerification(network, this.voices.list({ before, limit, fids: fids.length ? fids : null }));
      // When you chose people, a voice only counts as theirs if the claim is verified.
      if (fids.length) voices = voices.filter((v) => v.verified);
    }

    const results = await Promise.allSettled(fids.map((fid) => this.casts(network, { fid, before, limit, replies })));
    const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
    // With no FIDs nothing was read from the node, so check it now: the source line must carry real sync state.
    if (!fids.length && network.pinnedTo) await network.node().catch(() => {});
    const source = results.find((r) => r.status === 'fulfilled')?.value.source
      ?? (fids.length ? null : network.current && network.source(network.current));
    // A chosen node that fails is an error, not a quiet empty feed.
    if (network.pinnedTo && fids.length && errors.length === fids.length) throw httpError(503, errors[0]);
    const casts = await this.withApps(network, results.flatMap((r) => (r.status === 'fulfilled' ? r.value.casts : [])));

    // Paging follows the unfiltered timeline, so hiding an app never ends the feed early.
    const page = [...voices, ...(await this.renderCasts(network, casts))]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
    const items = page.filter(appFilter(apps));
    // Every app seen on this page, with its name and how many casts it made: the reader chooses from these.
    const pageCasts = page.filter((i) => i.kind === 'cast');
    const counts = new Map();
    for (const c of pageCasts) if (c.app) counts.set(c.app.fid, (counts.get(c.app.fid) ?? 0) + 1);
    const users = await this.usersFor(network, [...items.map((i) => i.fid), ...counts.keys()]);
    return {
      network: network.name,
      source,
      items,
      users,
      apps: [...counts].map(([fid, count]) => ({ fid, username: users[fid]?.username ?? null, count })).sort((a, b) => b.count - a.count),
      attribution: { casts: pageCasts.length, traced: pageCasts.filter((c) => c.app).length },
      next: page.length < limit ? null : page.at(-1).timestamp,
      errors,
    };
  }

  async thread(networkName, { fid, hash }) {
    const network = this.network(networkName);
    const [cast, replies] = await Promise.all([
      network.get('/v1/castById', { fid, hash }),
      network.get('/v1/castsByParent', { fid, hash, pageSize: 100 }),
    ]);
    if (!cast.data) throw httpError(404, 'Cast not found on this network');
    const items = await this.renderCasts(network, [cast.data, ...(replies.data?.messages ?? [])]
      .filter((m) => m.data?.type === 'MESSAGE_TYPE_CAST_ADD')
      .map((m) => normalizeCast(m, network.name)));
    return { network: network.name, source: network.source(cast.node), cast: items[0], replies: items.slice(1), users: await this.usersFor(network, items.map((i) => i.fid)) };
  }

  async voice(networkName, id) {
    const network = this.network(networkName);
    const voice = this.voices.get(id);
    if (!voice) throw httpError(404, 'No voice with that id');
    const [withFid, ...replies] = await this.withVerification(network, [voice, ...this.voices.replies(id)]);
    const node = await network.node();
    return { network: network.name, source: network.source(node), voice: withFid, replies, users: await this.usersFor(network, [withFid, ...replies].map((v) => v.fid)) };
  }

  async resolve(networkName, name) {
    const network = this.network(networkName);
    const clean = String(name).replace(/^@/, '').toLowerCase();
    if (/^\d+$/.test(clean)) return this.user(network, Number(clean));
    const { data } = await network.get('/v1/userNameProofByName', { name: clean });
    if (!data?.fid) throw httpError(404, `No account named ${clean} on ${network.label}`);
    return this.user(network, data.fid);
  }
}
