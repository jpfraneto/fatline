// A client for any node that speaks the Snapchain HTTP API: Farcaster's Snapchain and Hypersnap.
// Both networks use the same message format, so everything above this file is network-agnostic.

/** Farcaster timestamps count seconds from 2021-01-01T00:00:00Z. */
export const FARCASTER_EPOCH = 1609459200;
export const toMs = (fcSeconds) => (fcSeconds + FARCASTER_EPOCH) * 1000;
export const toFc = (ms) => Math.floor(ms / 1000) - FARCASTER_EPOCH;

const HEALTH_TTL_MS = 30_000;
const MAX_HEALTHY_DELAY = 200; // blocks behind before a node counts as out of sync

export class Network {
  constructor(name, { label, about, nodes }, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
    this.name = name;
    this.label = label ?? name;
    this.about = about ?? '';
    this.nodes = nodes.map((n) => ({ url: n.url.replace(/\/$/, ''), own: Boolean(n.own), label: n.label ?? null, status: null }));
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.current = null;
    this.checkedAt = 0;
  }

  async request(node, path, params = {}) {
    const url = new URL(node.url + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
    const res = await this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${node.url}${path} -> HTTP ${res.status}`);
    return res.json();
  }

  async checkNode(node) {
    const started = Date.now();
    try {
      const info = await this.request(node, '/v1/info');
      const shards = (info?.shardInfos ?? []).filter((s) => s.shardId !== 0);
      const worstDelay = Math.max(0, ...shards.map((s) => Number(s.blockDelay ?? 0)));
      node.status = {
        ok: shards.length > 0 && worstDelay <= MAX_HEALTHY_DELAY,
        version: info?.version ?? null,
        blockDelay: worstDelay,
        messages: info?.dbStats?.numMessages ?? null,
        approxSizeBytes: info?.dbStats?.approxSize ?? null,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      node.status = { ok: false, error: err.message, checkedAt: new Date().toISOString() };
    }
    return node.status;
  }

  /** Checks every node and picks the first healthy one, in the order the person listed them. */
  async refresh() {
    await Promise.all(this.nodes.map((n) => this.checkNode(n)));
    this.current = this.nodes.find((n) => n.status?.ok) ?? null;
    this.checkedAt = Date.now();
    return this.current;
  }

  async node() {
    if (!this.current || Date.now() - this.checkedAt > HEALTH_TTL_MS) await this.refresh();
    if (!this.current) {
      throw Object.assign(new Error(`No reachable ${this.label} node. Run ./fatline doctor.`), { status: 503 });
    }
    return this.current;
  }

  /** GET a Snapchain HTTP path from the chosen node. Retries once on a fresh node if it fails. */
  async get(path, params) {
    let node = await this.node();
    try {
      return { data: await this.request(node, path, params), node };
    } catch {
      this.current = null;
      node = await this.node();
      return { data: await this.request(node, path, params), node };
    }
  }

  source(node, { chosen = false } = {}) {
    return { network: this.name, node: node.url, own: node.own, label: node.label, chosen, blockDelay: node.status?.blockDelay ?? null };
  }

  /**
   * This network, read only through the node the person chose. No fallback: if that node is down,
   * every request fails with a clear error naming it. A node that answers but is behind is still used,
   * and the source says how far behind it is.
   */
  pinned(url) {
    const want = String(url).replace(/\/$/, '');
    const node = this.nodes.find((n) => n.url === want);
    if (!node) throw Object.assign(new Error(`${want} is not one of this server's ${this.label} nodes. Choose one in Settings.`), { status: 400 });
    const self = this;
    const name = node.label ?? node.url.replace(/^https?:\/\//, '');
    const down = (why) => Object.assign(new Error(`The ${this.label} node you chose, ${name}, is not answering${why ? ` (${why})` : ''}. Choose another node in Settings; this client does not switch for you.`), { status: 503 });
    const check = async () => {
      const fresh = node.status && Date.now() - Date.parse(node.status.checkedAt) < HEALTH_TTL_MS;
      if (!fresh) await self.checkNode(node);
      if (node.status.error || !(node.status.blockDelay >= 0)) throw down(node.status.error);
      return node;
    };
    return {
      name: this.name, label: this.label, about: this.about, nodes: this.nodes, pinnedTo: node.url,
      get current() { return node; },
      node: check,
      async get(path, params) {
        await check();
        try {
          return { data: await self.request(node, path, params), node };
        } catch (err) {
          node.status = { ok: false, error: err.message, checkedAt: new Date().toISOString() };
          throw down(err.message);
        }
      },
      source: (n) => self.source(n ?? node, { chosen: true }),
      describe: () => self.describe(),
    };
  }

  describe() {
    return {
      name: this.name,
      label: this.label,
      about: this.about,
      using: this.current ? this.source(this.current) : null,
      nodes: this.nodes.map(({ url, own, label, status }) => ({ url, own, label, status })),
    };
  }
}

/** Turns a CAST_ADD message into the shape the apps use. */
export function normalizeCast(message, network) {
  const d = message.data;
  const body = d.castAddBody ?? {};
  return {
    kind: 'cast',
    id: message.hash,
    network,
    fid: d.fid,
    text: body.text ?? '',
    mentions: body.mentions ?? [],
    mentionsPositions: body.mentionsPositions ?? [],
    embeds: (body.embeds ?? []).map((e) => e.url ?? (e.castId ? { cast: e.castId } : null)).filter(Boolean),
    parent: body.parentCastId ? { fid: body.parentCastId.fid, hash: body.parentCastId.hash } : null,
    parentUrl: body.parentUrl ?? null,
    long: body.type === 'LONG_CAST',
    signer: typeof message.signer === 'string' ? message.signer.toLowerCase() : null, // the app key that signed it
    timestamp: toMs(d.timestamp),
  };
}

const USER_FIELDS = {
  USER_DATA_TYPE_USERNAME: 'username',
  USER_DATA_TYPE_DISPLAY: 'displayName',
  USER_DATA_TYPE_PFP: 'pfp',
  USER_DATA_TYPE_BIO: 'bio',
};

export function normalizeUser(fid, messages = []) {
  const user = { fid, username: null, displayName: null, pfp: null, bio: null };
  for (const m of messages) {
    const b = m.data?.userDataBody;
    if (b && USER_FIELDS[b.type]) user[USER_FIELDS[b.type]] = b.value;
  }
  return user;
}

/** Ethereum addresses this FID has verified, lowercased. */
export function ethAddresses(messages = []) {
  return messages
    .map((m) => m.data?.verificationAddAddressBody)
    .filter((b) => b && b.protocol !== 'PROTOCOL_SOLANA' && /^0x[0-9a-fA-F]{40}$/.test(b.address))
    .map((b) => b.address.toLowerCase());
}

/** Inserts @username where the protocol stores mentions as byte positions. */
export function renderMentions(cast, usernames) {
  if (!cast.mentions.length) return cast.text;
  const bytes = Buffer.from(cast.text, 'utf8');
  let out = '';
  let last = 0;
  cast.mentionsPositions.forEach((pos, i) => {
    out += bytes.subarray(last, pos).toString('utf8');
    out += '@' + (usernames.get(cast.mentions[i]) ?? `fid:${cast.mentions[i]}`);
    last = pos;
  });
  return out + bytes.subarray(last).toString('utf8');
}
