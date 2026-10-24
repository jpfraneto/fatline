// fatline egg / fatline hatch: your node keeps an egg warm; after three warm days a Fatliner hatches.
//
//   fatline egg                         no egg yet: mint it (the rules, a QR code, your wallet, checked on a node);
//                                       an egg: how warm it is, at every attester
//   fatline egg lay [--node URL] [--network farcaster|hypersnap] [--to 0x…]
//                                       sign the claim with this client's app key and give it to the attesters
//   fatline egg take                    put the egg onchain (lay does it; this retries)
//   fatline hatch                       collect the attesters' signatures; the egg becomes the Fatliner
//
// The node must be your own and reachable from the internet (attesters check it every hour).
// Default node: the server `fatline compute` rented (.fatline/compute.json). Default address to hatch to:
// your account's custody address, read from a node.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { laidAtOf, normalizeNode, signClaim } from './egg.mjs';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { attesterList, fatlinersAbi, hatcheryConfig } from './hatchery-run.mjs';
import { Network } from './hub.mjs';
import { loadAppKey } from './writer.mjs';

const PORTS = { farcaster: 3381, hypersnap: 4381 };

function args() {
  const a = process.argv.slice(2);
  const get = (n) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  return { cmd: a[0] && !a[0].startsWith('--') ? a[0] : 'status', node: get('node'), network: get('network'), to: get('to'), hatchery: get('hatchery'), fid: get('fid'), pay: get('pay') };
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
  if (!ok) { say('\nNo attester took the egg.'); process.exitCode = 1; return; }
  await take(config);
  say('\nYour node now keeps it warm. Attesters check it every hour; after three warm days: fatline hatch. See how it goes: fatline egg');
}

/** What the Fatliners contract says about this FID: nothing, an egg, or a Fatliner (with its surname). */
async function onchain(config, fid) {
  const hc = hatcheryConfig(config);
  if (!hc.contract || hc.chainId !== 8453) return null;
  const c = createPublicClient({ chain: base, transport: http(hc.rpc) });
  const read = (functionName) => c.readContract({ address: hc.contract, abi: fatlinersAbi, functionName, args: [BigInt(fid)] });
  const stage = Number(await read('stageOf').catch(() => -1));
  if (stage === 2) return `a Fatliner, $${await read('surnameOf')}`;
  return { 0: 'nothing yet (no egg onchain)', 1: 'an egg', [-1]: 'unknown (could not read Base)' }[stage];
}

async function status(config) {
  const key = loadAppKey(config.dataDir);
  if (!key) throw new Error('This client has no app key. Run fatline identity, then fatline egg lay.');
  say(`\nFID ${key.fid}'s egg. Onchain: ${(await onchain(config, key.fid)) ?? 'no contract on Base in this config'}.`);
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

/**
 * Collects the attesters' signatures for this account's Egg ('egg': takeEgg) or Hatch ('hatch'), and has
 * an attester that relays submit them. Returns true when it is onchain (or already was).
 */
async function submit(config, kind, { quiet = false } = {}) {
  const key = loadAppKey(config.dataDir);
  if (!key) throw new Error('This client has no app key.');
  const field = kind === 'egg' ? 'egg' : 'hatch';
  const sigs = [];
  const relays = [];
  for (const a of await attestersOf(config)) {
    try {
      const s = await json(`${a.url}/eggs/${key.fid}`, { timeoutMs: 15_000 });
      const sig = s[field];
      if (sig) { sigs.push({ signer: sig.signer, signature: sig.signature, message: sig.message }); relays.push(a); }
      if (!quiet) say(`  ${a.label ?? a.url}: ${sig ? 'signed' : kind === 'egg' ? 'reading your history (the DNA), not signed yet' : `${s.warmDays}/${s.needed} warm days, not yet`}`);
    } catch (err) {
      if (!quiet) say(`  ${a.label ?? a.url}: ${err.message}`);
    }
  }
  if (!sigs.length) {
    if (quiet) return false;
    throw new Error(kind === 'egg' ? 'No attester has signed your egg yet. Try again in a few minutes: fatline egg take' : 'No attester has signed yet. Keep your node running: fatline egg');
  }
  // Everyone must have signed the same message. If not, the DNA differs between attesters: say so.
  const same = sigs.filter((s) => JSON.stringify(s.message) === JSON.stringify(sigs[0].message));
  if (same.length < sigs.length) say(`  Note: ${sigs.length - same.length} attester(s) signed something different (a different DNA). Only matching ones count.`);
  for (const r of relays) {
    try {
      const out = await json(`${r.url}/eggs/${key.fid}/${kind === 'egg' ? 'take' : 'hatch'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signatures: same }), timeoutMs: 120_000 });
      if (kind === 'egg') say(`\nYour egg is onchain: token #${key.fid}, an egg, held by ${sigs[0].message.to}. It can't be moved; it hatches where it is.`);
      else say(`\nBorn. Fatliner #${key.fid}, $${sigs[0].message.surname}.`);
      say(`  tx ${out.tx} (${out.status}), signed by ${out.signers.length} attester${out.signers.length === 1 ? '' : 's'}`);
      return true;
    } catch (err) {
      if (/^Already born|already onchain/.test(err.message)) { say(`\n${err.message}`); return true; }
      if (!quiet) say(`  ${r.label ?? r.url} could not submit it: ${err.message}`);
    }
  }
  if (quiet) return false;
  const fn = kind === 'egg' ? 'takeEgg(e, signatures)' : 'hatch(h, signatures)';
  say(`\nNobody submitted it. Anyone can, with a little ETH on Base: call ${fn} on the Fatliners contract with`);
  say(JSON.stringify({ message: same[0].message, signatures: same.map((s) => s.signature) }, null, 1));
  process.exitCode = 1;
  return false;
}

async function take(config) {
  // The attesters read the history first (seconds for most accounts, minutes for big ones).
  for (let i = 0; i < 20; i++) {
    if (await submit(config, 'egg', { quiet: true })) return;
    if (i === 0) say('\nPutting your egg onchain once the attesters have read your history (the DNA)…');
    await new Promise((r) => setTimeout(r, 15_000));
  }
  await submit(config, 'egg');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = args();
  const config = loadConfig();
  // fatline egg with no egg onchain yet: mint one (Aster, while it is reserved, is minted by its keeper's wallet).
  const eggOrMint = async () => {
    const { createPublicClient, http, parseAbi } = await import('viem');
    const c = createPublicClient({ chain: base, transport: http(config.hatchery?.rpc ?? 'https://mainnet.base.org') });
    const a = parseAbi(['function stageOf(uint256) view returns (uint8)', 'function genesisTo() view returns (address)']);
    const nft = config.deployments.Fatliners.address;
    const fid = Number(opts.fid ?? loadAppKey(config.dataDir)?.fid ?? 0);
    const has = fid ? Number(await c.readContract({ address: nft, abi: a, functionName: 'stageOf', args: [BigInt(fid)] })) : 0;
    if (has) return status(config);
    const { mintEgg } = await import('./egg-mint.mjs');
    const out = await mintEgg(config, opts);
    if (out?.layTo) {
      await lay(config, { ...opts, to: out.layTo });
      const me = Number(loadAppKey(config.dataDir)?.fid ?? opts.fid ?? 0);
      const now = me ? Number(await c.readContract({ address: nft, abi: a, functionName: 'stageOf', args: [BigInt(me)] })) : 0;
      if (now === 1) await (await import('./egg-mint.mjs')).showEgg(config, { fid: me, holder: out.layTo });
      else say('  When your egg is onchain, see it: fatline egg show');
      return;
    }
    return out;
  };
  const show = async () => {
    const { existsSync } = await import('node:fs');
    const fid = Number(opts.fid ?? loadAppKey(config.dataDir)?.fid ?? config.deployments.Fatliners.genesis.fid);
    const saved = join(config.dataDir, `egg-${fid}.html`);
    const { showEgg } = await import('./egg-mint.mjs');
    if (existsSync(saved) && !opts.fid) { const { spawn } = await import('node:child_process'); spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [saved], { detached: true, stdio: 'ignore' }).unref(); return say(`  Opened ${saved}`); }
    return showEgg(config, { fid });
  };
  const run = { lay: () => lay(config, opts), status: eggOrMint, mint: eggOrMint, show, take: () => take(config), hatch: () => submit(config, 'hatch') }[opts.cmd];
  if (!run) { console.error(`Unknown: ${opts.cmd}. Try fatline egg, fatline egg lay, fatline egg take, fatline hatch.`); process.exit(1); }
  run().then(() => process.exit(process.exitCode ?? 0), (err) => { console.error(err.shortMessage ?? err.message); process.exit(1); });
}

