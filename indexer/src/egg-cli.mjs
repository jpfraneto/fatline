// fatline egg / fatline hatch: your node keeps an egg warm; after three warm days a Fatliner hatches.
//
//   fatline egg                         how warm your egg is, at every attester
//   fatline egg lay [--node URL] [--network farcaster|hypersnap] [--to 0x…]
//                                       sign the claim with this client's app key and give it to the attesters
//   fatline hatch                       collect the attesters' signatures and have the Fatliner minted
//
// The node must be your own and reachable from the internet (attesters check it every hour).
// Default node: the server `fatline compute` rented (.fatline/compute.json). Default address to hatch to:
// your account's custody address, read from a node.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { laidAtOf, normalizeNode, signClaim } from './egg.mjs';
import { attesterList, hatcheryConfig } from './hatchery-run.mjs';
import { Network } from './hub.mjs';
import { loadAppKey } from './writer.mjs';

const PORTS = { farcaster: 3381, hypersnap: 4381 };

function args() {
  const a = process.argv.slice(2);
  const get = (n) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  return { cmd: a[0] && !a[0].startsWith('--') ? a[0] : 'status', node: get('node'), network: get('network'), to: get('to'), hatchery: get('hatchery') };
}

const say = (s = '') => console.log(s);
const bar = (d) => '●'.repeat(Math.min(d.passed, d.need)) + '○'.repeat(Math.max(0, d.need - d.passed));

async function json(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init?.timeoutMs ?? 60_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: res.status });
  return body;
}

/** The attesters, from the Fatliners contract (every Fatline server reads the same one). */
async function attestersOf(config) {
  const hc = hatcheryConfig(config);
  const list = await attesterList(hc)();
  if (!list.length) throw new Error(hc.contract ? 'The contract has no attesters.' : 'No Fatliners contract and no attesters in fatline.config.json (hatchery).');
  return list.map((a, i) => ({ url: a.url.replace(/\/$/, ''), label: a.address ? `attester ${i + 1} (${a.url})` : a.url }));
}

function defaultNode(config, network) {
  const rented = join(config.dataDir, 'compute.json');
  if (existsSync(rented)) {
    const c = JSON.parse(readFileSync(rented, 'utf8'));
    if (c.ipv4) return `http://${c.ipv4}:${PORTS[network] ?? 3381}`;
  }
  return null;
}

async function custodyOf(config, network, fid) {
  const node = await new Network(network, config.networks[network]).node();
  const r = await json(`${node.url}/v1/onChainEventsByFid?fid=${fid}&event_type=EVENT_TYPE_ID_REGISTER`, { timeoutMs: 15_000 });
  const last = (r.events ?? []).at(-1);
  return last?.idRegisterEventBody?.to ?? null;
}

async function lay(config, opts) {
  const key = loadAppKey(config.dataDir);
  if (!key) throw new Error('This client has no app key. Run fatline identity first: the egg is signed with it.');
  const network = opts.network ?? key.network ?? config.defaultNetwork;
  const node = opts.node ?? defaultNode(config, network);
  if (!node) throw new Error('Which node keeps the egg warm? Pass --node http://<your server>:3381 (it must be reachable from the internet).');
  // The server's own hatchery: it becomes an attester when the egg hatches.
  const hatchery = (opts.hatchery ?? `http://${new URL(node).hostname}:8791`).replace(/\/$/, '');
  const server = (await json(`${hatchery}/`, { timeoutMs: 10_000 }).catch(() => null))?.attester?.toLowerCase();
  if (!server) throw new Error(`No hatchery answers at ${hatchery}. Your server runs one next to its node: fatline hatchery init, then fatline hatchery.`);
  const to = (opts.to ?? await custodyOf(config, network, key.fid))?.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(to ?? '')) throw new Error('Could not find your custody address. Pass --to 0x…');
  const signed = signClaim(key, { fid: key.fid, network, node, to, server, hatchery, at: Date.now() });

  say(`\nLaying an egg for FID ${key.fid}.`);
  say(`  kept warm by  ${normalizeNode(node)} (${network})`);
  say(`  hatches to    ${to}`);
  say(`  its hatchery  ${hatchery} (key ${server.slice(0, 10)}…), an attester once it hatches`);
  say(`  DNA from      the account's history up to ${new Date(laidAtOf(signed.claim.at) * 1000).toISOString()}`);
  say('  signed with   this client\'s app key (no seed phrase, no wallet)\n');
  let ok = 0;
  for (const a of await attestersOf(config)) {
    try {
      await json(`${a.url}/eggs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signed) });
      ok++;
      say(`  ✓ ${a.label ?? a.url}: laid. First check passed.`);
    } catch (err) {
      say(`  ✗ ${a.label ?? a.url}: ${err.message}`);
    }
  }
  say(ok ? '\nYour node now keeps it warm. Attesters check it every hour. See how it goes: fatline egg' : '\nNo attester took the egg.');
  if (!ok) process.exitCode = 1;
}

async function status(config) {
  const key = loadAppKey(config.dataDir);
  if (!key) throw new Error('This client has no app key. Run fatline identity, then fatline egg lay.');
  say(`\nFID ${key.fid}'s egg:`);
  let any = false;
  for (const a of await attestersOf(config)) {
    try {
      const s = await json(`${a.url}/eggs/${key.fid}`, { timeoutMs: 15_000 });
      any = true;
      say(`\n  ${a.label ?? a.url} (attester ${s.attester.slice(0, 8)}…)`);
      say(`  node ${s.node} · DNA ${s.dna ? `${s.dna.slice(0, 12)}…` : s.dnaError ? `failed: ${s.dnaError}` : 'being read'}`);
      for (const d of s.days) say(`    day ${d.day}  ${bar(d)}  ${d.passed}/${d.need} checks${d.warm ? '  warm' : d.done ? '  cold' : ''}`);
      const last = s.recent.at(-1);
      if (last) say(`    last check ${new Date(last.at).toISOString().slice(11, 16)} UTC: ${last.ok ? 'passed' : `failed: ${last.reason}`}`);
      say(s.hatched ? '    HATCHED. Run: fatline hatch' : `    ${s.warmDays} of ${s.needed} warm days`);
    } catch (err) {
      say(`\n  ${a.label ?? a.url}: ${err.status === 404 ? 'no egg here. Lay one: fatline egg lay' : err.message}`);
    }
  }
  if (!any) process.exitCode = 1;
}

async function hatch(config) {
  const key = loadAppKey(config.dataDir);
  if (!key) throw new Error('This client has no app key.');
  const sigs = [];
  const relays = [];
  for (const a of await attestersOf(config)) {
    try {
      const s = await json(`${a.url}/eggs/${key.fid}`, { timeoutMs: 15_000 });
      if (s.hatch) { sigs.push({ signer: s.hatch.signer, signature: s.hatch.signature, message: s.hatch.message, url: a.url }); relays.push(a); }
      say(`  ${a.label ?? a.url}: ${s.hatch ? 'signed' : `${s.warmDays}/${s.needed} warm days, not yet`}`);
    } catch (err) {
      say(`  ${a.label ?? a.url}: ${err.message}`);
    }
  }
  if (!sigs.length) throw new Error('No attester has signed yet. Keep your node running: fatline egg');
  // Everyone must have signed the same Hatch. If not, the DNA differs between attesters: say so.
  const same = sigs.filter((s) => JSON.stringify(s.message) === JSON.stringify(sigs[0].message));
  if (same.length < sigs.length) say(`  Note: ${sigs.length - same.length} attester(s) signed a different Hatch (a different DNA). Only matching ones count.`);
  for (const r of relays) {
    try {
      const out = await json(`${r.url}/eggs/${key.fid}/hatch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signatures: same }), timeoutMs: 120_000 });
      say(`\nBorn. Fatliner #${key.fid} → ${sigs[0].message.to}`);
      say(`  tx ${out.tx} (${out.status}), signed by ${out.signers.length} attesters`);
      return;
    } catch (err) {
      if (/^Already born/.test(err.message)) { say(`\n${err.message}`); return; }
      say(`  ${r.label ?? r.url} could not submit it: ${err.message}`);
    }
  }
  say('\nNobody submitted it. Anyone can, with a little ETH on Base: call hatch(h, signatures) on the Fatliners contract with');
  say(JSON.stringify({ h: same[0].message, signatures: same.map((s) => s.signature) }, null, 1));
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = args();
  const config = loadConfig();
  const run = { lay: () => lay(config, opts), status: () => status(config), hatch: () => hatch(config) }[opts.cmd];
  if (!run) { console.error(`Unknown: ${opts.cmd}. Try fatline egg, fatline egg lay, fatline hatch.`); process.exit(1); }
  run().catch((err) => { console.error(err.message); process.exit(1); });
}

