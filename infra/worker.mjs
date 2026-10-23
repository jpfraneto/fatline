#!/usr/bin/env node
// fatline worker           where your worker stands: wallet, node, client, coin
// fatline worker new       make a worker wallet on this machine (a recovery phrase, shown once)
// fatline worker restore   bring a worker wallet back from its phrase (hidden prompt)
//
// Two kinds of keepers run Farcaster nodes with Fatline:
//   - a Fatline: one of the 777. Tied to a FID (fatline connect). A being with a name, a coin, a vault, a story.
//   - a worker: anyone, as many as they like. No FID, no being. A wallet made here rents a node (x402: it pays
//     in USDC on Base with signatures, so it needs no ETH and no card) and keeps a copy of the network.
//     What a worker gets: its own node of the Farcaster protocol and its own client to read it with.
//     (Posting needs a Farcaster account; a worker without one reads.)
// The phrase is made on this machine, shown once in your own terminal, and never saved. The key it derives
// (m/44'/60'/0'/0/0) is kept in .fatline/worker.key (mode 600, never committed); `fatline compute` pays with it.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createPublicClient, erc20Abi, formatUnits, http, toHex } from 'viem';
import { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = process.env.FATLINE_STATE ?? join(ROOT, '.fatline');
export const KEY_FILE = join(STATE, 'worker.key');
const INFO_FILE = join(STATE, 'worker.json');
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

function ask(q, { hidden = false } = {}) {
  return new Promise((done) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); };
    rl.on('close', () => done(''));
    rl.question(q, (a) => { if (hidden) process.stdout.write('\n'); done(a.trim()); rl.close(); });
  });
}

/** Saves the worker's key (never the phrase) and its public record. */
export function saveWorker(account, { state = STATE, how = 'new' } = {}) {
  mkdirSync(state, { recursive: true });
  const keyFile = join(state, 'worker.key');
  writeFileSync(keyFile, toHex(account.getHdKey().privateKey) + '\n', { mode: 0o600 });
  chmodSync(keyFile, 0o600);
  const info = { address: account.address, derivation: "m/44'/60'/0'/0/0", createdAt: new Date().toISOString(), how };
  writeFileSync(join(state, 'worker.json'), JSON.stringify(info, null, 2) + '\n');
  return info;
}

/** The steps from a wallet to a coin, and which one is next. */
export function readiness({ wallet, usdc, node, client, factory }) {
  const steps = [
    { id: 'wallet', label: 'Worker wallet', ok: Boolean(wallet), hint: 'fatline worker new' },
    { id: 'funds', label: 'USDC on Base, to pay for a server', ok: usdc != null && usdc > 0, hint: `send USDC on Base to ${wallet ?? 'your worker address'} (no ETH needed)` },
    { id: 'node', label: 'Your node, in sync', ok: node?.state === 'alive', hint: 'fatline compute --provider vpsagent, then fatline node farcaster' },
    { id: 'client', label: 'Your client, running', ok: Boolean(client), hint: 'fatline up' },
    { id: 'coin', label: 'Its coin, deployed without gas', ok: false, waiting: !factory, hint: factory ? 'not built yet: the gasless launch comes next' : 'waiting: the Fatline launch contracts are not on Base yet' },
  ];
  return { steps, next: steps.find((s) => !s.ok) ?? null };
}

async function get(url, ms = 6000) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.ok ? r : null; } catch { return null; }
}

async function bestNode() {
  const config = readJson(join(ROOT, 'fatline.config.json')) ?? {};
  const urls = Object.values(config.networks ?? {}).flatMap((n) => (n.nodes ?? []).filter((x) => x.own).map((x) => x.url));
  const { nodeState } = await import('./dashboard.mjs');
  for (const url of urls) {
    const r = await get(`${url}/v1/info`);
    const s = nodeState(r ? await r.json() : null);
    if (s.state !== 'down') return { url, ...s };
  }
  return null;
}

async function status() {
  const info = readJson(INFO_FILE);
  const config = readJson(join(ROOT, 'fatline.config.json')) ?? readJson(join(ROOT, 'fatline.config.example.json')) ?? {};
  let usdc = null;
  if (info) {
    try {
      const client = createPublicClient({ chain: base, transport: http(config.launchpad?.rpc ?? 'https://mainnet.base.org') });
      usdc = Number(formatUnits(await client.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [info.address] }), 6));
    } catch { usdc = null; }
  }
  const node = await bestNode();
  const client = await get('http://127.0.0.1:8787/', 3000);
  const r = readiness({ wallet: info?.address, usdc, node, client, factory: config.launchpad?.factory });
  console.log(`\n  \x1b[1mWorker\x1b[0m${info ? `  ${info.address}` : '  (none on this machine yet)'}`);
  console.log('  \x1b[2mNo FID, no being: a keeper of the network. Its reward is its own node and its own client.\x1b[0m\n');
  for (const s of r.steps) {
    const mark = s.ok ? '\x1b[32m✓\x1b[0m' : s.waiting ? '\x1b[33m…\x1b[0m' : ' ';
    let extra = '';
    if (s.id === 'funds' && usdc != null) extra = ` (${usdc.toFixed(2)} USDC)`;
    if (s.id === 'node' && node) extra = ` (${node.url}: ${node.state}${node.behind != null ? `, ${node.behind} blocks behind` : ''})`;
    console.log(`  ${mark} ${s.label}${extra}${s.ok ? '' : `\n      ${s.hint}`}`);
  }
  console.log('');
}

async function create() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('A worker wallet shows its recovery phrase once, so it has to be made in your own terminal (not through an agent). Run: fatline worker new');
    process.exit(1);
  }
  if (existsSync(KEY_FILE)) {
    console.error(`This machine already has a worker: ${readJson(INFO_FILE)?.address}. One per machine; to replace it, move .fatline/worker.key and .fatline/worker.json away first.`);
    process.exit(1);
  }
  const phrase = generateMnemonic(english);
  const words = phrase.split(' ');
  console.log('\n  Your worker\'s recovery phrase. Write it on paper. It is shown once and never saved;');
  console.log('  with it you can bring this worker back on any machine (fatline worker restore).\n');
  for (let i = 0; i < 12; i += 4) console.log('    ' + words.slice(i, i + 4).map((w, k) => `${String(i + k + 1).padStart(2)}. ${w.padEnd(10)}`).join(''));
  console.log('');
  const [a, b] = [Math.floor(Math.random() * 6), 6 + Math.floor(Math.random() * 6)];
  if ((await ask(`  To check you wrote it down, type word ${a + 1}: `)).toLowerCase() !== words[a]
    || (await ask(`  And word ${b + 1}: `)).toLowerCase() !== words[b]) {
    process.stdout.write('\x1b[2J\x1b[H');
    console.log('  That didn\'t match. Nothing was saved. Run fatline worker new again.');
    process.exit(1);
  }
  process.stdout.write('\x1b[2J\x1b[H'); // the phrase leaves the screen
  const info = saveWorker(mnemonicToAccount(phrase));
  console.log(`  Worker wallet: \x1b[1m${info.address}\x1b[0m\n  Key: .fatline/worker.key (mode 600). The phrase is not stored anywhere on this machine.`);
  await status();
}

async function restore() {
  if (!process.stdin.isTTY) { console.error('Run this in your own terminal: fatline worker restore'); process.exit(1); }
  const phrase = (await ask('  Recovery phrase (hidden): ', { hidden: true })).toLowerCase().split(/\s+/).join(' ');
  let account;
  try { account = mnemonicToAccount(phrase); } catch { console.error('  That is not a valid phrase. Nothing was saved.'); process.exit(1); }
  const info = saveWorker(account, { how: 'restored' });
  console.log(`  Worker restored: ${info.address}`);
  await status();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  ({ new: create, restore }[cmd] ?? status)().catch((err) => { console.error(`\n  ${err.message}`); process.exit(1); });
}
