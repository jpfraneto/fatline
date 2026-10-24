// The life force: what is flowing through your own node right now. The cockpit draws it as electricity running
// through the egg. Measured, not decorative: sampled from the node's /v1/info every few seconds.
//
//   messagesPerSecond  new Farcaster messages your node took in (its copy of the network growing)
//   blocksPerSecond    blocks it is applying (above ~1/s per shard it is catching up)
//   behindSeconds      how far behind the network it is (Snapchain's blockDelay, in seconds; worst user shard)
//   catchUpRate        seconds of lag it closes per second (> 0: catching up; ~0: in sync or stalled)
//   alive              it answered the last check
const KEEP = 60;

export class LifeForce {
  constructor(network, { fetchImpl = fetch, everyMs = 5_000, now = () => Date.now() } = {}) {
    this.network = network;
    this.fetch = fetchImpl;
    this.everyMs = everyMs;
    this.now = now;
    this.samples = [];
    this.node = network.nodes.find((n) => n.own) ?? network.nodes[0];
  }

  async sample() {
    const t = this.now();
    try {
      const res = await this.fetch(`${this.node.url}/v1/info`, { signal: AbortSignal.timeout(8_000) });
      const info = await res.json();
      const shards = (info.shardInfos ?? []).filter((s) => Number(s.shardId) > 0);
      this.samples.push({
        t, ok: true,
        messages: Number(info.dbStats?.numMessages ?? shards.reduce((a, s) => a + Number(s.numMessages ?? 0), 0)),
        height: shards.reduce((a, s) => a + Number(s.maxHeight ?? 0), 0),
        behind: Math.max(0, ...shards.map((s) => Number(s.blockDelay ?? 0))),
      });
    } catch (err) {
      this.samples.push({ t, ok: false, error: String(err.message ?? err).slice(0, 120) });
    }
    if (this.samples.length > KEEP) this.samples.shift();
  }

  status() {
    const good = this.samples.filter((s) => s.ok);
    const last = good.at(-1);
    const first = good.find((s) => last && last.t - s.t <= 60_000) ?? good[0];
    const dt = last && first && last.t > first.t ? (last.t - first.t) / 1000 : 0;
    const rate = (k) => (dt ? Math.max(0, (last[k] - first[k]) / dt) : 0);
    return {
      network: this.network.name ?? null, node: this.node.url, own: Boolean(this.node.own), label: this.node.label ?? null,
      alive: Boolean(this.samples.at(-1)?.ok), at: this.samples.at(-1)?.t ?? null,
      messagesPerSecond: Math.round(rate('messages') * 10) / 10,
      blocksPerSecond: Math.round(rate('height') * 10) / 10,
      behindSeconds: last?.behind ?? null,
      catchUpRate: dt && first.behind != null ? Math.round(((first.behind - last.behind) / dt) * 100) / 100 : 0,
      totalMessages: last?.messages ?? null,
      pulse: good.slice(-30).map((s, i, a) => (i ? Math.max(0, s.messages - a[i - 1].messages) : 0)), // recent beats
      error: this.samples.at(-1)?.ok ? null : this.samples.at(-1)?.error ?? null,
    };
  }

  start() {
    this.sample();
    this.timer = setInterval(() => this.sample(), this.everyMs);
    this.timer.unref?.();
  }
}
