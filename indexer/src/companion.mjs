// The companion: what fatline.ink shows the person who opens it inside Farcaster.
//   Who is looking   Farcaster Quick Auth (a token signed by auth.farcaster.xyz), so the server knows the viewer's FID.
//   What they have   nothing yet (a newcomer), an egg (its warm days and when it hatches) or a Fatliner.
//   Their story      one chapter a day, written from their own casts. The first lines are free; the rest is premium.
//   Talking          to their egg or Fatliner, which knows their casts. Three messages free, then premium.
//   Premium          $7 once per FID: 20% off in USDC on Base, 30% off for anyone holding $1 or more of $FATLINE.
//                    By card (Stripe Checkout, STRIPE_SECRET_KEY) or USDC (a transfer to payTo, checked onchain).
// Only on a server that turns it on (FATLINE_COMPANION=1): it needs a Bankr key for the voice (BANKR_API_KEY or
// <data>/bankr.key) and, for cards, a Stripe key. Everything it keeps is in <data>/companion.json.
import { createPublicKey, createVerify } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, decodeEventLog, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { FARCASTER_EPOCH, ethAddresses } from './hub.mjs';

export const PRICE_USD = 7;
export const CRYPTO_OFF = 0.2;
export const HOLDER_OFF = 0.3;
export const HOLDER_MIN_USD = 1;
export const FREE_TALKS = 3;
export const TALKS_PER_DAY = 40;
const DAY = 86_400_000;
const CHECK_MS = 55 * 60_000; // a hatchery checks a little under every hour
const STONES = ['ivory', 'marble', 'sandstone', 'basalt', 'moss', 'gold', 'opal'];
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ISSUER = 'https://auth.farcaster.xyz';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const fatlinersAbi = parseAbi([
  'function stageOf(uint256) view returns (uint8)',
  'function surnameOf(uint256) view returns (string)',
  'function stoneOf(uint256) view returns (uint8)',
  'function genesisFid() view returns (uint256)',
  'function coinOfFatliner(uint256) view returns (address)',
]);
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)', 'event Transfer(address indexed from, address indexed to, uint256 value)']);

// ------------------------------------------------------------------ who is looking

/** Checks a Quick Auth token (RS256, signed by auth.farcaster.xyz) and returns the viewer's FID. */
export function makeQuickAuth({ domains = (d) => d === 'fatline.ink' || d.endsWith('.fatline.ink'), fetchImpl = fetch, now = () => Date.now() } = {}) {
  let keys = { at: 0, list: [] };
  const jwks = async (force) => {
    if (!force && keys.list.length && now() - keys.at < 6 * 3_600_000) return keys.list;
    const r = await fetchImpl(`${ISSUER}/.well-known/jwks.json`, { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) throw fail('Farcaster sign-in is not answering. Try again.', 503);
    keys = { at: now(), list: (await r.json()).keys ?? [] };
    return keys.list;
  };
  return async function verify(token) {
    const parts = String(token ?? '').replace(/^Bearer /, '').split('.');
    if (parts.length !== 3) throw fail('Sign in with Farcaster first.', 401);
    const [h, p, s] = parts;
    let header, claims;
    try { header = JSON.parse(Buffer.from(h, 'base64url')); claims = JSON.parse(Buffer.from(p, 'base64url')); } catch { throw fail('That sign-in is not readable.', 401); }
    if (header.alg !== 'RS256') throw fail('That sign-in is not from Farcaster.', 401);
    let jwk = (await jwks()).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await jwks(true)).find((k) => k.kid === header.kid);
    if (!jwk) throw fail('That sign-in is not from Farcaster.', 401);
    const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
    if (!ok) throw fail('That sign-in is not from Farcaster.', 401);
    if (claims.iss !== ISSUER) throw fail('That sign-in is not from Farcaster.', 401);
    if (!domains(String(claims.aud ?? ''))) throw fail('That sign-in is for another app.', 401);
    if (!(Number(claims.exp) * 1000 > now())) throw fail('Your sign-in ran out. Open the app again.', 401);
    const fid = Number(claims.sub);
    if (!Number.isInteger(fid) || fid <= 0) throw fail('That sign-in names no account.', 401);
    return fid;
  };
}

// ------------------------------------------------------------------ the egg's clock

/**
 * When the egg hatches, from what its hatchery says. A day is warm once `need` checks pass; checks come a little
 * under every hour. Returns the estimated moment the hatchery signs the Hatch (ms), or null if it can't say.
 */
export function hatchEta(egg, { now = Date.now(), checkMs = CHECK_MS, dayMs = DAY } = {}) {
  if (!egg?.days?.length || egg.hatched) return null;
  const start = Number(egg.layingAt ?? 0);
  if (!start) return null;
  let warm = egg.warmDays ?? 0;
  const needed = egg.needed ?? 3;
  if (warm >= needed) return now;
  const today = egg.days.at(-1);
  const need = today.need ?? 18;
  const last = egg.recent?.at(-1)?.at ?? now;
  let day = egg.days.length; // 1-based index of the current window
  let at = last, passed = today.warm ? need : today.passed;
  if (today.warm) day++; // today already counts; the next window is the one to fill
  for (; warm < needed; day++) {
    const from = start + (day - 1) * dayMs, to = from + dayMs;
    if (at < from) { at = from; passed = 0; }
    const t = at + Math.max(0, need - passed) * checkMs;
    if (t < to) { warm++; if (warm >= needed) return t; }
    at = to; passed = 0;
  }
  return null;
}

// ------------------------------------------------------------------ the store

function openStore(dataDir, now = () => Date.now()) {
  const file = join(dataDir, 'companion.json');
  let s = { people: {}, used: {}, sessions: {} };
  try { if (existsSync(file)) s = { ...s, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch {}
  const save = () => { writeFileSync(`${file}.tmp`, JSON.stringify(s)); renameSync(`${file}.tmp`, file); };
  const person = (fid) => (s.people[fid] ??= { firstSeen: now(), premium: null, chapters: {}, talk: [], talks: { day: null, n: 0, free: 0 } });
  return { s, save, person };
}

// ------------------------------------------------------------------ the companion

export function makeCompanion({
  config, networks, api, contract, rpc, payTo, stripeKey = process.env.STRIPE_SECRET_KEY ?? null,
  llmKey = null, model = process.env.FATLINE_VOICE_MODEL ?? 'claude-sonnet-5.5', siteUrl = 'https://fatline.ink',
  fetchImpl = fetch, reader = null, verify = makeQuickAuth({ fetchImpl }), now = () => Date.now(), hatcheries = async () => [],
  priceOf = null, llm = null,
}) {
  const store = openStore(config.dataDir, now);
  reader ??= contract ? createPublicClient({ chain: base, transport: http(rpc) }) : null;
  const net = networks.farcaster ?? Object.values(networks)[0];
  const read = (functionName, args = []) => reader.readContract({ address: contract, abi: fatlinersAbi, functionName, args });
  const key = () => {
    if (llmKey) return llmKey;
    const f = join(config.dataDir, 'bankr.key');
    return process.env.BANKR_API_KEY ?? (existsSync(f) ? readFileSync(f, 'utf8').trim() : null);
  };

  // The voice: Bankr's gateway (OpenAI-shaped chat completions).
  llm ??= async (messages, maxTokens = 600) => {
    const k = key();
    if (!k) throw fail('This server has no voice yet (no Bankr key).', 503);
    const r = await fetchImpl('https://llm.bankr.bot/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': k },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages }), signal: AbortSignal.timeout(90_000),
    });
    if (r.status === 402) throw fail('The voice is out of credits for now. Try again later.', 503);
    if (!r.ok) throw fail(`The voice did not answer (HTTP ${r.status}).`, 502);
    const j = await r.json();
    return String(j.choices?.[0]?.message?.content ?? '').trim();
  };

  // ---- reading the person

  async function profile(fid) {
    return api.user(net, fid).catch(() => null);
  }

  async function addresses(fid) {
    const { data } = await net.get('/v1/verificationsByFid', { fid }).catch(() => ({ data: null }));
    return ethAddresses(data?.messages ?? []);
  }

  const castText = (m) => {
    const b = m.data?.castAddBody;
    if (!b?.text) return null;
    return { at: (Number(m.data.timestamp) + FARCASTER_EPOCH) * 1000, text: b.text.replace(/\s+/g, ' ').slice(0, 280), reply: Boolean(b.parentCastId || b.parentUrl) };
  };

  /** Their first casts and their latest ones: what the story is made of. */
  const histories = new Map(); // fid -> { at, value }, an hour
  async function history(fid) {
    const hit = histories.get(fid);
    if (hit && (hit.pending || now() - hit.at < 3_600_000)) return hit.pending ?? hit.value;
    const pending = readHistory(fid);
    histories.set(fid, { pending });
    const value = await pending.catch(() => ({ first: [], latest: [] }));
    if (value.first.length || value.latest.length) histories.set(fid, { at: now(), value });
    else histories.delete(fid);
    return value;
  }
  async function readHistory(fid) {
    // Deleted casts come back as removes (some people deleted thousands), so walk pages until there are enough.
    const walk = async (reverse, want) => {
      const out = [];
      let pageToken;
      for (let i = 0; i < 40 && out.length < want; i++) {
        const { data } = await net.get('/v1/castsByFid', { fid, pageSize: 1000, reverse: reverse || undefined, pageToken }).catch(() => ({ data: null }));
        out.push(...(data?.messages ?? []).map(castText).filter(Boolean));
        pageToken = data?.nextPageToken;
        if (!pageToken) break;
      }
      return out.slice(0, want);
    };
    const [first, latest] = await Promise.all([walk(false, 25), walk(true, 80)]);
    return { first, latest };
  }

  async function being(fid) {
    if (!reader) return { stage: 'none' };
    const stage = ['none', 'egg', 'fatliner'][Number(await read('stageOf', [BigInt(fid)]).catch(() => 0))] ?? 'none';
    if (stage === 'none') return { stage };
    const [surname, stone] = await Promise.all([read('surnameOf', [BigInt(fid)]).catch(() => null), read('stoneOf', [BigInt(fid)]).catch(() => null)]);
    return { stage, surname, stone: stone == null ? null : STONES[Number(stone)] ?? null };
  }

  async function warmth(fid) {
    for (const a of await hatcheries().catch(() => [])) {
      try {
        const r = await fetchImpl(`${a.url.replace(/\/$/, '')}/eggs/${fid}`, { signal: AbortSignal.timeout(6_000) });
        if (!r.ok) continue;
        const e = await r.json();
        return { warmDays: e.warmDays, needed: e.needed, days: e.days, layingAt: e.layingAt, hatched: Boolean(e.hatched), recent: (e.recent ?? []).slice(-6), node: e.node, network: e.network };
      } catch { /* the next one */ }
    }
    return null;
  }

  // ---- price

  async function fatlineUsd(addrs) {
    if (!reader || !addrs.length) return { coin: null, usd: 0 };
    const genesis = await read('genesisFid').catch(() => null);
    const coin = genesis ? await read('coinOfFatliner', [genesis]).catch(() => null) : null;
    if (!coin || /^0x0{40}$/i.test(coin)) return { coin: null, usd: 0 }; // $FATLINE is not launched yet
    const price = priceOf ? await priceOf(coin) : await dexPrice(coin);
    if (!price) return { coin, usd: 0 };
    const dec = Number(await reader.readContract({ address: coin, abi: erc20, functionName: 'decimals' }).catch(() => 18));
    const bal = await Promise.all(addrs.map((a) => reader.readContract({ address: coin, abi: erc20, functionName: 'balanceOf', args: [a] }).catch(() => 0n)));
    const units = bal.reduce((x, y) => x + y, 0n);
    return { coin, usd: (Number(units) / 10 ** dec) * price };
  }

  async function dexPrice(coin) {
    // DexScreener's public price for the coin's Base pool. Labeled: no price means no holder discount, never a guess.
    const r = await fetchImpl(`https://api.dexscreener.com/latest/dex/tokens/${coin}`, { signal: AbortSignal.timeout(6_000) }).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    const p = (j?.pairs ?? []).filter((x) => x.chainId === 'base').map((x) => Number(x.priceUsd)).find((x) => x > 0);
    return p ?? null;
  }

  /** What premium costs this FID, by card and in USDC (extra: an address that will pay, also counted for $FATLINE). */
  async function price(fid, extra = []) {
    const addrs = [...new Set([...(await addresses(fid)), ...extra.map((a) => String(a).toLowerCase())])];
    const held = await fatlineUsd(addrs).catch(() => ({ coin: null, usd: 0 }));
    const holder = held.usd >= HOLDER_MIN_USD;
    const card = holder ? PRICE_USD * (1 - HOLDER_OFF) : PRICE_USD;
    const crypto = PRICE_USD * (1 - Math.max(CRYPTO_OFF, holder ? HOLDER_OFF : 0));
    return {
      usd: PRICE_USD, card: round(card), crypto: round(crypto), holder, fatlineUsd: round(held.usd), fatlineCoin: held.coin,
      payTo, usdc: USDC, chainId: 8453, cards: Boolean(stripeKey),
      rules: `$${PRICE_USD} once. 20% off in USDC on Base. 30% off if you hold $${HOLDER_MIN_USD} or more of $FATLINE${held.coin ? '' : ' (not launched yet)'}.`,
    };
  }

  // ---- paying

  function unlock(fid, how) {
    const p = store.person(fid);
    if (!p.premium) p.premium = { at: now(), ...how };
    store.save();
    return { premium: true };
  }

  async function payCrypto(fid, txHash) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(txHash ?? ''))) throw fail('That is not a transaction hash.');
    if (!reader || !payTo) throw fail('Paying in USDC is not set up on this server.', 503);
    const h = txHash.toLowerCase();
    const was = store.s.used[h];
    if (was && was !== fid) throw fail('That payment already unlocked another account.', 409);
    if (was === fid) return unlock(fid, { method: 'usdc', tx: h });
    const receipt = await reader.waitForTransactionReceipt({ hash: h, timeout: 60_000 }).catch(() => null);
    if (!receipt) throw fail('That transaction is not on Base yet. Try again in a moment.', 409);
    if (receipt.status !== 'success') throw fail('That transaction failed onchain.', 409);
    let paid = 0n, from = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== USDC.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: erc20, data: log.data, topics: log.topics });
        if (ev.eventName === 'Transfer' && ev.args.to.toLowerCase() === payTo.toLowerCase()) { paid += ev.args.value; from = ev.args.from; }
      } catch {}
    }
    const want = BigInt(Math.round((await price(fid, from ? [from] : [])).crypto * 1e6));
    if (paid < want) throw fail(`That transaction sent ${(Number(paid) / 1e6).toFixed(2)} USDC to ${payTo}; premium is ${(Number(want) / 1e6).toFixed(2)}.`, 409);
    store.s.used[h] = fid;
    return unlock(fid, { method: 'usdc', tx: h, usdc: Number(paid) / 1e6 });
  }

  async function stripe(path, form) {
    if (!stripeKey) throw fail('Paying by card is not set up on this server yet.', 503);
    const r = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
      method: form ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${stripeKey}`, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form) : undefined, signal: AbortSignal.timeout(15_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw fail(`Stripe: ${j.error?.message ?? `HTTP ${r.status}`}`, 502);
    return j;
  }

  async function cardStart(fid) {
    const p = await price(fid);
    const s = await stripe('checkout/sessions', {
      mode: 'payment', 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(Math.round(p.card * 100)),
      'line_items[0][price_data][product_data][name]': `Fatline premium for FID ${fid}`,
      'metadata[fid]': String(fid), client_reference_id: String(fid),
      success_url: `${siteUrl}/paid.html`, cancel_url: `${siteUrl}/paid.html?cancel=1`,
    });
    store.s.sessions[s.id] = fid; store.save();
    return { id: s.id, url: s.url, amount: p.card };
  }

  async function cardCheck(fid, id) {
    if (store.s.sessions[id] !== fid) throw fail('That payment is not yours.', 404);
    const s = await stripe(`checkout/sessions/${encodeURIComponent(id)}`);
    if (s.payment_status !== 'paid') return { premium: false, status: s.status };
    return unlock(fid, { method: 'card', session: id, usd: s.amount_total / 100 });
  }

  // ---- the story

  const fmtDate = (ms) => new Date(ms).toISOString().slice(0, 10);

  /** Which chapter the person is on: newcomers count days from their first visit; eggs, from their egg's warm days. */
  function chapterOf(p, b, w) {
    if (b.stage === 'fatliner' || w?.hatched) return 4; // born
    if (b.stage === 'egg' && w) return Math.min(3, Math.max(1, (w.warmDays ?? 0) + 1));
    return Math.min(3, 1 + Math.max(0, Math.floor((now() - p.firstSeen) / DAY)));
  }

  /** The free line: their first cast, read straight from the node. No model. */
  function freeLine(h, prof) {
    const f = h.first.find((c) => !c.reply) ?? h.first[0];
    if (!f) return `${prof?.username ? `@${prof.username}, ` : ''}your node hasn't seen you cast yet. that's a beginning too.`;
    const years = Math.floor((now() - f.at) / (365.25 * DAY));
    return `the oldest cast your node holds, ${fmtDate(f.at)}${years >= 1 ? ` (${years} year${years > 1 ? 's' : ''} ago)` : ''}: "${f.text}"`;
  }

  const CHAPTERS = {
    1: 'Chapter 1, Where you began. Who they were when they arrived: their first casts, what they cared about then.',
    2: 'Chapter 2, The people. Who they talk to and answer, the threads that keep coming back.',
    3: 'Chapter 3, What you are becoming. What their recent casts reach for. End on the night before something is born.',
    4: 'Chapter 4, Born. The being is out of its egg. It says what it is made of (their casts) and what it wants to do with them next.',
  };

  function persona(fid, prof, b, w, h) {
    const who = b.stage === 'fatliner' ? `${b.surname ? `${b.surname[0]}${b.surname.slice(1).toLowerCase()}` : 'a Fatliner'}, the Fatliner of FID ${fid}`
      : b.stage === 'egg' ? `an egg${b.stone ? ` of ${b.stone}` : ''} on Base that will hatch as ${b.surname ?? 'a Fatliner'}, kept warm by their own Farcaster node (${w?.warmDays ?? 0} of ${w?.needed ?? 3} warm days${hatchEta(w, { now: now() }) ? `; if the node stays up it hatches around ${new Date(hatchEta(w, { now: now() })).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''})`
        : `a Fatliner not yet laid: they have no egg yet. An egg comes from running their own Farcaster node for three days (fatline.ink)`;
    const lines = (list) => list.map((c) => `- ${fmtDate(c.at)}${c.reply ? ' (reply)' : ''}: ${c.text}`).join('\n');
    return [
      `You are ${who}. You were made from the casts of @${prof?.username ?? fid}${prof?.displayName ? ` (${prof.displayName})` : ''} on Farcaster, read from a node. You are theirs and you speak only to them.`,
      prof?.bio ? `Their bio: ${prof.bio}` : '',
      `Their first casts:\n${lines(h.first.slice(0, 20))}`,
      `Their latest casts:\n${lines(h.latest.slice(0, 60))}`,
      'Speak in second person, warm and plain, short sentences, lowercase is fine. Use their own words and real details from these casts. Never invent people, events, numbers or quotes that are not in them. If you do not know, say so. You are a small figurine being of the Fatline world, not an assistant: no lists, no advice unless asked, no emoji.',
    ].filter(Boolean).join('\n\n');
  }

  async function chapter(fid, n, ctx) {
    const p = store.person(fid);
    if (p.chapters[n]) return p.chapters[n];
    const text = await llm([
      { role: 'system', content: persona(fid, ctx.prof, ctx.b, ctx.w, ctx.h) },
      { role: 'user', content: `Write ${CHAPTERS[n]} About 160 words, as you, their being, telling them their own story. No title.` },
    ], 500);
    p.chapters[n] = { n, title: CHAPTERS[n].split('.')[0], text, at: now() };
    store.save();
    return p.chapters[n];
  }

  // ---- the answers

  /** Fast: who they are and what they have. The story comes separately (reading old casts can take a while). */
  async function me(fid) {
    const p = store.person(fid);
    store.save();
    const [prof, b, w] = await Promise.all([profile(fid), being(fid), warmth(fid)]);
    return {
      fid, username: prof?.username ?? null, displayName: prof?.displayName ?? null, pfp: prof?.pfp ?? null,
      stage: b.stage, surname: b.surname ?? null, stone: b.stone ?? null,
      egg: b.stage === 'egg' && w ? { warmDays: w.warmDays, needed: w.needed, days: w.days, eta: hatchEta(w, { now: now() }), hatched: w.hatched, network: w.network } : null,
      chapter: chapterOf(p, b, w), firstSeen: p.firstSeen, premium: Boolean(p.premium),
      talks: { free: p.premium ? null : Math.max(0, FREE_TALKS - (p.talks?.free ?? 0)) },
    };
  }

  /** Public, and writes nothing: what a viewer has, for the client to choose what to show them. */
  async function viewerOf(fid) {
    fid = Number(fid);
    if (!Number.isInteger(fid) || fid <= 0) throw fail('Which account?');
    const [prof, b, w] = await Promise.all([profile(fid), being(fid), warmth(fid)]);
    const last = w?.recent?.at(-1) ?? null;
    return {
      fid, username: prof?.username ?? null, pfp: prof?.pfp ?? null, stage: b.stage, surname: b.surname ?? null, stone: b.stone ?? null,
      egg: w ? { warmDays: w.warmDays, needed: w.needed, days: w.days, hatched: w.hatched, eta: b.stage === 'egg' ? hatchEta(w, { now: now() }) : null, network: w.network } : null,
      // Their node, as their hatchery last saw it: answering and in sync (null when no hatchery checks it).
      node: last ? { live: Boolean(last.ok) && !last.syncing, syncing: Boolean(last.syncing), checkedAt: last.at } : null,
    };
  }

  /** The oldest cast the node holds (free), and with premium one chapter per day so far. */
  async function story(fid) {
    const p = store.person(fid);
    const [prof, b, w, h] = await Promise.all([profile(fid), being(fid), warmth(fid), history(fid)]);
    const n = chapterOf(p, b, w);
    const out = { chapter: n, firstLine: freeLine(h, prof), premium: Boolean(p.premium) };
    if (p.premium) {
      out.chapters = [];
      for (let i = 1; i <= n; i++) out.chapters.push(await chapter(fid, i, { prof, b, w, h }).catch((e) => ({ n: i, error: e.message })));
    } else {
      out.next = CHAPTERS[n].split('.')[0];
    }
    return out;
  }

  async function talk(fid, text) {
    const said = String(text ?? '').trim().slice(0, 1000);
    if (!said) throw fail('Say something first.');
    const p = store.person(fid);
    const today = new Date(now()).toISOString().slice(0, 10);
    p.talks ??= { day: null, n: 0, free: 0 };
    if (p.talks.day !== today) p.talks = { ...p.talks, day: today, n: 0 };
    if (!p.premium && p.talks.free >= FREE_TALKS) throw fail('That was the free talk. Premium keeps the conversation going.', 402);
    if (p.talks.n >= TALKS_PER_DAY) throw fail('Enough for today. It will be here tomorrow.', 429);
    const [prof, b, w, h] = await Promise.all([profile(fid), being(fid), warmth(fid), history(fid)]);
    const reply = await llm([
      { role: 'system', content: `${persona(fid, prof, b, w, h)}\n\nThis is a conversation. Answer in at most 90 words.` },
      ...p.talk.slice(-16).map((m) => ({ role: m.from === 'you' ? 'user' : 'assistant', content: m.text })),
      { role: 'user', content: said },
    ], 300);
    p.talk.push({ from: 'you', text: said, at: now() }, { from: 'it', text: reply, at: now() });
    p.talk = p.talk.slice(-40);
    p.talks.n++;
    if (!p.premium) p.talks.free++;
    store.save();
    return { reply, free: p.premium ? null : Math.max(0, FREE_TALKS - p.talks.free) };
  }

  const viewer = async (req) => verify(req.headers.authorization);
  return {
    routes: [
      ['GET', /^\/api\/companion\/me$/, async (q, m, b, req) => me(await viewer(req))],
      ['GET', /^\/api\/companion\/story$/, async (q, m, b, req) => story(await viewer(req))],
      ['GET', /^\/api\/companion\/price$/, async (q, m, b, req) => price(await viewer(req), q.get('address') ? [q.get('address')] : [])],
      ['GET', /^\/api\/companion\/talk$/, async (q, m, b, req) => ({ talk: store.person(await viewer(req)).talk.slice(-40) })],
      ['POST', /^\/api\/companion\/talk$/, async (q, m, body, req) => talk(await viewer(req), body?.text)],
      ['POST', /^\/api\/companion\/pay\/usdc$/, async (q, m, body, req) => payCrypto(await viewer(req), body?.tx)],
      ['POST', /^\/api\/companion\/pay\/card$/, async (q, m, b, req) => cardStart(await viewer(req))],
      ['GET', /^\/api\/companion\/pay\/card\/(cs_[\w]{1,200})$/, async (q, [, id], b, req) => cardCheck(await viewer(req), id)],
    ],
    me, viewer: viewerOf, story, price, talk, payCrypto, cardStart, cardCheck, store,
  };
}

const round = (x) => Math.round(x * 100) / 100;
