// The HTTP API the apps read from. Every answer says which network and which node it came from,
// so a reader always knows whether they are on their own node or someone else's.
import { ethAddresses, normalizeCast, normalizeUser, renderMentions, toFc } from './hub.mjs';

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
  }

  network(name) {
    const n = this.networks[name ?? this.config.defaultNetwork];
    if (!n) throw httpError(400, `Unknown network "${name}". Choose one of: ${Object.keys(this.networks).join(', ')}`);
    return n;
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
  async feed(networkName, { fids = [], before, limit = 30, replies = false }) {
    const network = this.network(networkName);
    limit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    fids = [...new Set(fids.map(Number).filter((f) => Number.isInteger(f) && f > 0))].slice(0, MAX_FIDS);

    let voices = [];
    if (this.voices.enabled) {
      voices = await this.withVerification(network, this.voices.list({ before, limit, fids: fids.length ? fids : null }));
      // When you chose people, a voice only counts as theirs if the claim is verified.
      if (fids.length) voices = voices.filter((v) => v.verified);
    }

    const results = await Promise.allSettled(fids.map((fid) => this.casts(network.name, { fid, before, limit, replies })));
    const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
    const source = results.find((r) => r.status === 'fulfilled')?.value.source
      ?? (fids.length ? null : network.current && network.source(network.current));
    const casts = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.casts : []));

    const items = [...voices, ...(await this.renderCasts(network, casts))]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
    const users = await this.usersFor(network, items.map((i) => i.fid));
    const complete = items.length < limit;
    return {
      network: network.name,
      source,
      items,
      users,
      next: complete ? null : items.at(-1).timestamp,
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
