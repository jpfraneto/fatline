// Small edits to fatline.config.json, used by ./fatline.
//   init [--network farcaster|hypersnap] [--node URL]   choose a network (asks when not given)
//   own-node <network> <url>                             mark a node as yours, first in line
//   contracts <chainId> <rpc>                            read the latest forge deployment (Voices, AppFactory) into the config
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'fatline.config.json');
const load = () => {
  if (!existsSync(FILE)) copyFileSync(join(ROOT, 'fatline.config.example.json'), FILE);
  return JSON.parse(readFileSync(FILE, 'utf8'));
};
const save = (c) => writeFileSync(FILE, JSON.stringify(c, null, 2) + '\n');

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (a) => { rl.close(); r(a.trim()); }));
}

function setOwnNode(c, network, url) {
  url = url.replace(/\/$/, '');
  // One URL can only be one network's node. Remove it everywhere, then put it first for this network.
  for (const n of Object.values(c.networks)) n.nodes = n.nodes.filter((x) => x.url !== url);
  c.networks[network].nodes.unshift({ url, own: true });
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const c = load();

if (cmd === 'init') {
  const names = Object.keys(c.networks);
  let network = flag('network');
  if (!network) {
    console.log('\nWhich network should Fatline read by default? Readers can still switch in the app.\n');
    names.forEach((n, i) => console.log(`  ${i + 1}. ${c.networks[n].label} — ${c.networks[n].about}`));
    const pick = await ask(`\nChoose 1-${names.length} [${names.indexOf(c.defaultNetwork) + 1}]: `);
    network = names[Number(pick) - 1] ?? c.defaultNetwork;
  }
  if (!c.networks[network]) throw new Error(`Unknown network ${network}. Choose: ${names.join(', ')}`);
  c.defaultNetwork = network;
  const node = flag('node') ?? (flag('network') ? '' : await ask(`URL of a ${c.networks[network].label} node you run elsewhere (Enter to skip): `));
  if (node) setOwnNode(c, network, node);
  save(c);
  console.log(`\nSaved fatline.config.json: default network ${c.networks[network].label}.`);
} else if (cmd === 'own-node') {
  const [network, url] = rest;
  if (!c.networks[network]) throw new Error(`Unknown network ${network}`);
  setOwnNode(c, network, url);
  save(c);
  console.log(`${url} is now your ${c.networks[network].label} node.`);
} else if (cmd === 'contracts') {
  const [chainId, rpc] = rest;
  const run = JSON.parse(readFileSync(join(ROOT, `smart-contracts/broadcast/Deploy.s.sol/${chainId}/run-latest.json`), 'utf8'));
  const created = Object.fromEntries(run.transactions.filter((t) => t.transactionType === 'CREATE').map((t) => [t.contractName, t.contractAddress]));
  const firstBlock = Math.min(...run.receipts.map((r) => Number(r.blockNumber)));
  if (created.Voices) c.voices = { chainId: Number(chainId), rpc, address: created.Voices, fromBlock: firstBlock };
  if (created.AppFactory) {
    c.launchpad = { ...c.launchpad, chainId: Number(chainId), rpc, factory: created.AppFactory, fromBlock: firstBlock };
    if (created.MockUSDC) c.launchpad.usdc = created.MockUSDC;
  }
  save(c);
  for (const [name, address] of Object.entries(created)) console.log(`  ${name.padEnd(10)} ${address}`);
  console.log(`Saved to fatline.config.json (indexing from block ${firstBlock}).`);
} else {
  console.log('usage: config-tool.mjs init | own-node <network> <url> | contracts <chainId> <rpc>');
  process.exit(1);
}
