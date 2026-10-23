// Hetzner money watch: estimates how much prepaid credit is left and shouts on Telegram when it runs low.
//
//   node infra/budget-alert.mjs                    check now; send a Telegram alert if a threshold was crossed
//   node infra/budget-alert.mjs --set-balance 14.2 the real balance right now (from the Hetzner console)
//   node infra/budget-alert.mjs --hello            send one message saying the watch is on
//
// Hetzner's API has no balance endpoint, so this is an estimate: the last balance you set, minus every
// resource in the project (servers, volumes, IPs) at its hourly price since then. Resources deleted since
// the last --set-balance are missed, so set the balance again after deleting things.
// Secrets: ~/.hetzner-token, ~/.fatline-telegram-token, ~/.fatline-telegram-chat (never printed).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET = join(ROOT, '.fatline/budget.json');
const STATE = join(ROOT, '.fatline/budget-alert-state.json');
const HOUR = 3600_000;

// Hours of runway at which to alert. Below the last one it repeats every REPEAT_HOURS.
export const LEVELS = [48, 24, 12, 6, 3, 1, 0];
const REPEAT_HOURS = (runway) => (runway <= 0 ? 1 : runway <= 12 ? 2 : Infinity);

const secret = (name) => readFileSync(join(homedir(), name), 'utf8').trim();
const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);

async function hz(path) {
  const res = await fetch(`https://api.hetzner.cloud/v1${path}`, { headers: { authorization: `Bearer ${secret('.hetzner-token')}` } });
  if (!res.ok) throw new Error(`Hetzner ${path}: HTTP ${res.status}`);
  return res.json();
}

/** Every billed resource in the project with its hourly price (USD gross) and creation time. */
export async function resources() {
  const { pricing } = await hz('/pricing');
  const perGbHour = Number(pricing.volume.price_per_gb_month.gross) / 730;
  const out = [];
  for (const s of (await hz('/servers?per_page=50')).servers) {
    const p = pricing.server_types.find((t) => t.name === s.server_type.name)?.prices.find((x) => x.location === (s.location ?? s.datacenter?.location)?.name);
    out.push({ what: `server ${s.name} (${s.server_type.name})`, hourly: Number(p?.price_hourly.gross ?? 0), created: s.created });
  }
  for (const v of (await hz('/volumes?per_page=50')).volumes) out.push({ what: `volume ${v.name} (${v.size} GB)`, hourly: v.size * perGbHour, created: v.created });
  for (const ip of (await hz('/primary_ips?per_page=50')).primary_ips) {
    const p = pricing.primary_ips.find((t) => t.type === ip.type)?.prices.find((x) => x.location === (ip.location ?? ip.datacenter?.location)?.name);
    out.push({ what: `${ip.type} ${ip.ip}`, hourly: Number(p?.price_hourly.gross ?? 0), created: ip.created });
  }
  return out;
}

/** Pure math, so it can be tested: what's left now and how many hours that lasts. */
export function estimate(budget, list, now = Date.now()) {
  const since = Date.parse(budget.asOf);
  let spent = 0;
  for (const r of list) spent += r.hourly * Math.max(0, now - Math.max(since, Date.parse(r.created))) / HOUR;
  const burn = list.reduce((a, r) => a + r.hourly, 0);
  const left = budget.balanceUsd - spent;
  return { spent, left, burnPerHour: burn, burnPerDay: burn * 24, runwayHours: burn > 0 ? left / burn : Infinity, emptyAt: new Date(now + (burn > 0 ? (left / burn) * HOUR : 0)) };
}

/** Should we alert now? Once per level crossed; repeated near the end. */
export function shouldAlert(runwayHours, state, now = Date.now()) {
  const level = LEVELS.find((l, i) => runwayHours <= l && (i === LEVELS.length - 1 || runwayHours > LEVELS[i + 1]));
  if (level === undefined) return { send: false, level: null };
  if (state.level === undefined || state.level === null || level < state.level) return { send: true, level };
  const repeat = REPEAT_HOURS(runwayHours);
  return { send: now - (state.at ?? 0) >= repeat * HOUR, level };
}

export function alertText(e, list) {
  const h = e.runwayHours;
  const when = e.emptyAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const head = h <= 0 ? '🚨🚨🚨 HETZNER CREDIT IS GONE (estimate). The nodes may be shut down any moment.'
    : h <= 12 ? `🚨🚨 HETZNER MONEY ALMOST OUT: ~${h.toFixed(1)} hours left. Top up NOW.`
    : h <= 24 ? `🚨 Hetzner money low: ~${h.toFixed(0)} hours left. Please top up today.`
    : `⚠️ Hetzner money: ~${(h / 24).toFixed(1)} days left.`;
  return [
    head,
    `Left: ~$${e.left.toFixed(2)} · burning $${e.burnPerDay.toFixed(2)}/day · empty around ${when}.`,
    `Running: ${list.map((r) => r.what).join(', ')}.`,
    'Card auto-reload is off. Top up in the Hetzner console, then run: node infra/budget-alert.mjs --set-balance <new balance>',
  ].join('\n');
}

// No topic saved yet: take the newest forum topic the bot has seen a message in, and save it for next time
// (other agents read the same file).
async function findThread() {
  const file = join(homedir(), '.fatline-telegram-thread');
  if (existsSync(file)) return;
  const res = await fetch(`https://api.telegram.org/bot${secret('.fatline-telegram-token')}/getUpdates?limit=100`);
  const chat = secret('.fatline-telegram-chat');
  const msgs = ((await res.json()).result ?? []).map((u) => u.message).filter((m) => m && String(m.chat.id) === chat && m.is_topic_message && m.message_thread_id);
  if (msgs.length) writeFileSync(file, `${msgs.at(-1).message_thread_id}\n`, { mode: 0o600 });
}

export async function telegram(text) {
  await findThread().catch(() => {});
  const res = await fetch(`https://api.telegram.org/bot${secret('.fatline-telegram-token')}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: secret('.fatline-telegram-chat'), text,
      // A forum group with General closed needs a topic: put its id in ~/.fatline-telegram-thread.
      ...(existsSync(join(homedir(), '.fatline-telegram-thread')) ? { message_thread_id: Number(secret('.fatline-telegram-thread')) } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Telegram: HTTP ${res.status} ${(await res.json().catch(() => ({}))).description ?? ''}`.trim());
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--set-balance');
  if (i >= 0) {
    const balanceUsd = Number(args[i + 1]);
    if (!(balanceUsd >= 0)) throw new Error('Usage: --set-balance <USD>');
    writeFileSync(BUDGET, JSON.stringify({ balanceUsd, asOf: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
    writeFileSync(STATE, JSON.stringify({ hello: true }) + '\n');
    console.log(`Balance set to $${balanceUsd} as of now.`);
  }
  const budget = readJson(BUDGET, null);
  if (!budget) throw new Error('No balance yet. Run: node infra/budget-alert.mjs --set-balance <USD>');
  const list = await resources();
  const e = estimate(budget, list);
  console.log(alertText(e, list));
  const state = readJson(STATE, {});
  // The first message that gets through says the watch is on (retried every run until Telegram accepts it).
  if (args.includes('--hello') || !state.hello) {
    try {
      await telegram(`👀 Money watch is on. I'll shout here when the Hetzner credit gets low.\n${alertText(e, list)}`);
      state.hello = true;
      writeFileSync(STATE, JSON.stringify(state) + '\n');
    } catch (err) {
      console.log(`Hello not delivered yet: ${err.message}`);
    }
  }
  const { send, level } = shouldAlert(e.runwayHours, state);
  if (send) {
    await telegram(alertText(e, list));
    writeFileSync(STATE, JSON.stringify({ ...state, level, at: Date.now() }) + '\n');
    console.log('Alert sent.');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(async (err) => {
    console.error(err.message);
    // A broken watch is itself worth knowing about.
    try { await telegram(`⚠️ The Hetzner money watch failed: ${err.message}`); } catch {}
    process.exit(1);
  });
}
