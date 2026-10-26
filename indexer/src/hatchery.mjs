// The hatchery: what an attester runs.
//
// It takes eggs (claims signed by an account's app key), checks each egg's node every hour against the
// attester's own node, and when an egg has had WARM_DAYS warm days it signs that egg's EIP-712 Hatch with
// the attester's key. It can also submit the mint for people who have no ETH (the relay).
//
// A check passes when the egg's node:
//   1. answers /v1/info quickly,
//   2. is in sync (every user shard within MAX_LAG_BLOCKS of the attester's node), or is catching up: read again
//      SYNC_PROBE_MS later, every lagging shard is closer to the attester's than before. Warmth starts the hour the
//      node starts syncing, not when it is done.
//   3. holds real data: returns two messages the attester picked at random from its own node, by hash
//      (skipped while it catches up: it can't hold the newest messages yet),
//   4. runs a hatchery that answers with the key the egg names (that server becomes an attester at hatching).
// This cannot prove the node isn't forwarding to someone else's node, but one machine can warm only one
// egg, and machines that already host an attester, and the well-known public nodes, are refused.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { isPublicAddress, outsideFetch } from './outside-fetch.mjs';
import {
  CHECK_EVERY_MS, CLAIM_SKEW_MS, DAY_MS, eggOf, eggTypes, surnameCandidate, hatchDomain, hatchOf, hatchTypes, laidAtOf, normalizeNode, normalizeUrl, sameHost, verifyClaim, warmth,
} from './egg.mjs';

// Names under fatline.ink that no Fatliner can take (surnames are 1–12 letters and digits).
export const RESERVED_NAMES = new Set(['www', 'api', 'docs', 'mail', 'app', 'apps', 'site', 'status', 'admin', 'eggs', 'names', 'hatchery', 'master', 'node', 'nodes']);
export const MAX_LAG_BLOCKS = 600; // ~10 minutes of blocks
export const SYNC_PROBE_MS = 15_000; // how long to wait before reading a lagging node again
const FC_EPOCH_S = 1_609_459_200; // Farcaster timestamps count seconds from 2021-01-01
const SETTLED_S = 30 * 60; // challenge messages are at least this old, so every synced node has them

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const isLocal = (u) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(u);

export class Hatchery {
  /**
   * @param config      fatline config (networks, hatchery section)
   * @param privateKey  the attester's secp256k1 key (0x…)
   * @param contract    { chainId, address } of Fatliners (address may be null until it is deployed)
   * @param reference   { farcaster: url, hypersnap: url }: the attester's own nodes, the truth it checks against
   * @param computeDna  async (fid, snapshotAtMs) => '0x' + 64 hex: the history commitment
   * @param listAttesters async () => [{ address, url }]: every attester, from the contract
   */
  constructor({ config, privateKey, contract, reference, dataDir, computeDna, listAttesters = async () => [], isBorn = async () => false, fetchImpl = fetch, outsideFetchImpl, now = () => Date.now(),
    dayMs = DAY_MS, checkEveryMs = CHECK_EVERY_MS, random = Math.random, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), surnameTaken = async () => 0 }) {
    this.config = config;
    this.account = privateKeyToAccount(privateKey);
    this.contract = contract;
    this.reference = reference;
    this.file = join(dataDir, 'hatchery.json');
    this.computeDna = computeDna;
    this.listAttesters = listAttesters;
    this.isBorn = isBorn;
    this.fetch = fetchImpl;
    // URLs an egg names (its node, its hatchery) are someone else's: public addresses only, no redirects.
    // (Tests that pass their own fetch use it for both.)
    this.outside = outsideFetchImpl ?? (fetchImpl === fetch ? outsideFetch : fetchImpl);
    this.now = now;
    this.dayMs = dayMs;
    this.checkEveryMs = checkEveryMs;
    this.random = random;
    this.sleep = sleep;
    this.surnameTaken = surnameTaken; // (surname) => the FID that holds it onchain, or 0
    this.log = (m) => log(`[hatchery] ${m}`);
    this.state = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { eggs: {} };
    this.busy = new Set();
  }

  get address() { return this.account.address; }

  save() {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state, null, 1));
    renameSync(`${this.file}.tmp`, this.file);
  }

  /** GET a JSON answer. outside: the URL came from an egg, so it goes through the public-only fetch. */
  async json(url, timeoutMs = 8_000, { outside = false } = {}) {
    const t0 = Date.now();
    const res = await (outside ? this.outside : this.fetch)(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    const body = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body, ms: Date.now() - t0 };
  }

  /** Machines that can't warm an egg: this attester's own nodes, the public nodes in its config, and every
   * machine that already hosts an attester. Compared by host name: another port is the same machine. */
  async refused(node) {
    const urls = [...Object.values(this.reference).filter(Boolean)];
    for (const net of Object.values(this.config.networks ?? {})) for (const n of net.nodes ?? []) if (!isLocal(n.url)) urls.push(n.url);
    for (const n of this.config.masterNodes ?? []) urls.push(n.url);
    const attesters = await this.listAttesters();
    for (const a of attesters) if (a.url) urls.push(a.url);
    return { hit: urls.some((u) => { try { return sameHost(u, node); } catch { return false; } }), attesters };
  }

  // ------------------------------------------------------------------ laying

  /** Takes a signed claim. Returns the egg's public status. */
  async lay(signed) {
    const c = signed?.claim;
    if (!c || !verifyClaim(signed)) throw fail('The claim is not signed by that key.');
    const fid = Number(c.fid);
    if (!Number.isSafeInteger(fid) || fid <= 0) throw fail('Bad FID.');
    if (Math.abs(this.now() - Number(c.at)) > CLAIM_SKEW_MS) throw fail('The claim is too old or from the future. Check your clock and lay it again.');
    if (!/^0x[0-9a-f]{40}$/.test(c.to) || /^0x0{40}$/.test(c.to)) throw fail('The claim needs the address to hatch to.');
    const ref = this.reference[c.network];
    if (!ref) throw fail(`This attester has no node on ${c.network}.`);
    const node = normalizeNode(c.node);
    if (isLocal(node)) throw fail('The node must be reachable from the internet, not localhost.');
    const literal = new URL(node).hostname.replace(/^\[|\]$/g, '');
    if (isIP(literal) && !isPublicAddress(literal)) throw fail('The node must be reachable from the internet: a public address, not a private one.');
    if (!/^0x[0-9a-f]{40}$/.test(c.server ?? '')) throw fail('The claim needs the server\'s hatchery key.');
    let hatcheryUrl;
    try { hatcheryUrl = normalizeUrl(c.hatchery); } catch { throw fail('The claim needs the server\'s hatchery URL.'); }
    if (!sameHost(hatcheryUrl, node)) throw fail('The hatchery must run on the same machine as the node.');
    const { hit, attesters } = await this.refused(node);
    if (hit) throw fail('That machine is a public node or already hosts an attester. Your egg needs your own server.');
    if (attesters.some((a) => a.address.toLowerCase() === c.server)) throw fail('That hatchery key is already an attester. One server, one egg.');
    const other = Object.values(this.state.eggs).find((e) => e.claim.fid !== fid && (sameHost(e.claim.node, node) || e.claim.server === c.server));
    if (other) throw fail('That server already keeps another egg warm. One server, one egg.');

    // The key must be an active app key of this FID, on the attester's own node.
    const signers = await this.json(`${ref}/v1/signersByFid?fid=${fid}`, 15_000).catch(() => null);
    if (!signers?.ok) throw fail('Could not read this account\'s keys from the attester\'s node. Try again.', 503);
    if (!(signers.body?.signers ?? []).some((s) => String(s.key).toLowerCase() === signed.publicKey.toLowerCase())) {
      throw fail(`That key is not an active app key of FID ${fid}. Run fatline identity first.`);
    }

    if (await this.isBorn(fid)) throw fail(`Fatliner #${fid} is already born.`, 409);
    const existing = this.state.eggs[fid];
    if (existing?.hatch) throw fail('This egg has already hatched.', 409);
    if (existing && existing.claim.to !== c.to) throw fail('This egg already names another address to hatch to.', 409);

    // The server must be alive when the egg is laid.
    const first = await this.check({ ...c, node, hatchery: hatcheryUrl });
    if (!first.ok) throw fail(`Your node did not pass its first check: ${first.reason}`);

    if (existing) {
      // Moving the egg to another node keeps its warmth and its DNA.
      existing.claim = { ...existing.claim, node, network: c.network, server: c.server, hatchery: hatcheryUrl };
      existing.egg = null; // its server changed: the Egg is signed again
      existing.publicKey = signed.publicKey;
      existing.signature = signed.signature;
      existing.checks.push(first);
      this.log(`FID ${fid}: egg moved to ${node}`);
    } else {
      this.state.eggs[fid] = { claim: { ...c, node, hatchery: hatcheryUrl }, publicKey: signed.publicKey, signature: signed.signature, laidAt: laidAtOf(c.at), dna: null, checks: [first], hatch: null };
      this.log(`FID ${fid}: egg laid, kept warm by ${node}`);
    }
    this.save();
    this.fillDna(fid); // in the background: big histories take a while
    return this.status(fid);
  }

  async fillDna(fid) {
    const egg = this.state.eggs[fid];
    if (!egg || egg.dna || this.busy.has(`dna:${fid}`)) return;
    this.busy.add(`dna:${fid}`);
    try {
      const got = await this.computeDna(fid, egg.laidAt * 1000);
      const dna = typeof got === 'string' ? got : got.dna; // the DNA, and the stone read from the same history
      if (!/^0x[0-9a-f]{64}$/.test(dna)) throw new Error(`bad DNA ${dna}`);
      egg.dna = dna;
      egg.stone = typeof got === 'string' ? 0 : Number(got.stone ?? 0);
      await this.signEgg(egg);
      this.save();
      this.log(`FID ${fid}: DNA ${dna.slice(0, 12)}…`);
    } catch (err) {
      egg.dnaError = String(err.message ?? err).slice(0, 200);
      this.save();
      this.log(`FID ${fid}: DNA failed: ${egg.dnaError}`);
    } finally {
      this.busy.delete(`dna:${fid}`);
    }
  }

  // ------------------------------------------------------------------ checking

  /** One random message the attester's node holds, old enough that every synced node has it too. */
  async pick(ref) {
    const nowFc = Math.floor(this.now() / 1000) - FC_EPOCH_S;
    for (let i = 0; i < 25; i++) {
      const fid = 1 + Math.floor(this.random() * 1_200_000);
      const r = await this.json(`${ref}/v1/castsByFid?fid=${fid}&pageSize=5&reverse=true`).catch(() => null);
      const m = (r?.body?.messages ?? []).find((x) => x.data?.type === 'MESSAGE_TYPE_CAST_ADD' && Number(x.data?.timestamp) < nowFc - SETTLED_S);
      if (m) return { fid, hash: m.hash };
    }
    return null;
  }

  /** One check of one egg's server. Returns { at, ok, reason?, ms? }. ok: null means the attester could not judge. */
  async check({ network, node, server, hatchery }) {
    const at = this.now();
    const ref = arguments[0].reference ?? this.reference[network]; // the genesis egg is checked against an outside node
    const [mine, theirs] = await Promise.all([
      this.json(`${ref}/v1/info`, 15_000).catch(() => null),
      this.json(`${node}/v1/info`, 8_000, { outside: true }).catch((e) => ({ error: String(e.message ?? e) })),
    ]);
    if (!mine?.ok) return { at, ok: null, reason: 'the attester\'s own node did not answer; this hour does not count' };
    if (!theirs?.ok) return { at, ok: false, reason: `no answer from /v1/info (${theirs?.error ?? `HTTP ${theirs?.status}`})` };
    const heights = (b) => Object.fromEntries((b?.shardInfos ?? []).filter((s) => Number(s.shardId) > 0).map((s) => [s.shardId, Number(s.maxHeight)]));
    const want = heights(mine.body), got = heights(theirs.body);
    for (const shard of Object.keys(want)) if (!(shard in got)) return { at, ok: false, reason: `shard ${shard} is missing` };
    const lagging = Object.keys(want).filter((shard) => want[shard] - got[shard] > MAX_LAG_BLOCKS);
    let behind = 0;
    if (lagging.length) {
      // Behind: it counts if it is catching up. Read both nodes again a little later; every lagging shard must be closer.
      await this.sleep(SYNC_PROBE_MS);
      const [mine2, theirs2] = await Promise.all([this.json(`${ref}/v1/info`, 15_000).catch(() => null), this.json(`${node}/v1/info`, 8_000, { outside: true }).catch(() => null)]);
      const want2 = heights(mine2?.body), got2 = heights(theirs2?.body);
      for (const shard of lagging) {
        const before = want[shard] - got[shard], after = want2[shard] - got2[shard];
        if (!(after < before)) return { at, ok: false, reason: `shard ${shard} is ${before} blocks behind and not catching up` };
        behind = Math.max(behind, after);
      }
    }
    for (let i = 0; i < 2 && !behind; i++) {
      const m = await this.pick(ref);
      if (!m) return { at, ok: null, reason: 'the attester could not pick a message to ask for; this hour does not count' };
      const r = await this.json(`${node}/v1/castById?fid=${m.fid}&hash=${m.hash}`, 5_000, { outside: true }).catch(() => null);
      if (!r?.ok || r.body?.hash !== m.hash) return { at, ok: false, reason: `it did not return message ${m.hash.slice(0, 10)}… (FID ${m.fid}) within 5 s` };
    }
    const h = await this.json(`${hatchery}/`, 8_000, { outside: true }).catch(() => null);
    if (!h?.ok) return { at, ok: false, reason: `its hatchery did not answer at ${hatchery}` };
    if (String(h.body?.attester).toLowerCase() !== server) return { at, ok: false, reason: `its hatchery answers with key ${h.body?.attester}, not ${server}` };
    return { at, ok: true, ms: theirs.ms, ...(behind ? { syncing: true, behind } : {}) };
  }

  /** Checks every egg that is due, then signs the ones that are ready. */
  async tick() {
    for (const egg of Object.values(this.state.eggs)) {
      if (egg.hatch) continue;
      const last = egg.checks.at(-1)?.at ?? 0;
      if (this.now() - last < this.checkEveryMs * 0.9) continue;
      const fid = egg.claim.fid;
      if (this.busy.has(`check:${fid}`)) continue;
      this.busy.add(`check:${fid}`);
      try {
        const r = await this.check(egg.claim);
        if (r.ok !== null) egg.checks.push(r); // hours the attester could not judge are left out
        else this.log(`FID ${fid}: ${r.reason}`);
        if (!egg.dna) this.fillDna(fid);
        await this.signEgg(egg);
        await this.signIfReady(egg);
        this.save();
      } finally {
        this.busy.delete(`check:${fid}`);
      }
    }
  }

  warmth(egg) {
    return warmth(egg, { now: this.now(), dayMs: this.dayMs, checkEveryMs: this.checkEveryMs });
  }

  /** The Egg: what puts the egg onchain (takeEgg). Signed once the DNA is in. */
  async signEgg(egg) {
    if (egg.egg || !egg.dna) return null;
    if (!egg.surname) {
      // The first surname no other egg holds onchain. Every attester walks the same list, so they agree.
      for (let k = 0; k < 50 && !egg.surname; k++) {
        const name = await surnameCandidate(egg.claim.fid, egg.dna, k);
        const holder = Number(await this.surnameTaken(name));
        if (!holder || holder === Number(egg.claim.fid)) egg.surname = name;
      }
      if (!egg.surname) throw new Error('no free surname in 50 tries');
    }
    const message = await eggOf(egg);
    const signature = await this.account.signTypedData({ domain: hatchDomain(this.contract), types: eggTypes, primaryType: 'Egg', message });
    egg.egg = { message: Object.fromEntries(Object.entries(message).map(([k, v]) => [k, String(v)])), signature, signer: this.address, at: this.now(), contract: this.contract };
    this.log(`FID ${egg.claim.fid}: egg signed`);
    return egg.egg;
  }

  /** The Hatch: after WARM_DAYS warm days. It names the being's surname, read from its DNA. */
  async signIfReady(egg) {
    if (egg.hatch || !egg.dna || !this.warmth(egg).ready) return null;
    const message = await hatchOf(egg);
    const signature = await this.account.signTypedData({ domain: hatchDomain(this.contract), types: hatchTypes, primaryType: 'Hatch', message });
    egg.hatch = { message: Object.fromEntries(Object.entries(message).map(([k, v]) => [k, String(v)])), signature, signer: this.address, at: this.now(), contract: this.contract };
    this.log(`FID ${egg.claim.fid}: hatched, signed`);
    return egg.hatch;
  }

  // ------------------------------------------------------------------ reading

  status(fid) {
    const egg = this.state.eggs[Number(fid)];
    if (!egg) return null;
    const w = this.warmth(egg);
    // The last day of checks, so a page can say whether the node is live and in sync: how fast it answered, and how
    // far behind it was if it was still catching up.
    const recent = egg.checks.slice(-24).map(({ at, ok, reason, ms, syncing, behind }) => ({ at, ok, ...(reason ? { reason } : {}), ...(ms != null ? { ms } : {}), ...(syncing ? { syncing, behind } : {}) }));
    return {
      fid: egg.claim.fid, network: egg.claim.network, node: egg.claim.node, to: egg.claim.to, server: egg.claim.server, hatchery: egg.claim.hatchery,
      laidAt: egg.laidAt, layingAt: egg.claim.at, dna: egg.dna, dnaError: egg.dna ? undefined : egg.dnaError,
      warmDays: w.warmDays, needed: w.needed, days: w.days.map(({ day, checks, passed, need, warm, done }) => ({ day, checks, passed, need, warm, done })),
      recent, egg: egg.egg ?? null, hatched: Boolean(egg.hatch), hatch: egg.hatch, attester: this.address,
    };
  }

  /**
   * Names under fatline.ink: <surname>.fatline.ink for every egg here that has a surname, pointing at the server
   * that runs its node. The master's router reads this to send each name's traffic, still encrypted, to that server.
   */
  names() {
    const out = [];
    for (const egg of Object.values(this.state.eggs)) {
      const label = String(egg.surname ?? egg.egg?.message?.surname ?? '').toLowerCase();
      if (!/^[a-z0-9]{1,12}$/.test(label) || RESERVED_NAMES.has(label)) continue;
      let host = null;
      try { host = new URL(egg.claim.node).hostname; } catch { continue; }
      out.push({ label, fid: Number(egg.claim.fid), host, hatched: Boolean(egg.hatch) });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  info() {
    return { attester: this.address, contract: this.contract, eggs: Object.keys(this.state.eggs).length,
      hatched: Object.values(this.state.eggs).filter((e) => e.hatch).length, rules: { checkEveryMs: this.checkEveryMs, dayMs: this.dayMs, maxLagBlocks: MAX_LAG_BLOCKS } };
  }
}
