// fatline compute [--quote]   (default: AgentMetal, 1 day, medium plan + 700 GB disk, paid in USDC; then fatline node snapchain)
// fatline compute --provider agentmetal --plan medium --days 3 --disk 1000 --node [--quote]
// fatline compute --provider vpsagent [--sku server_small_1mo] [--region EU] [--max-usdc 20] [--vault 0x…] (client only, too small for a node)
// fatline compute wallet        (create or show this machine's paying wallet; fund it with USDC on Base)
// fatline compute disk --disk 700 (buy or retry the extra disk, then set up)
// fatline compute status        (how the rented server and its node are doing)
// fatline compute deploy        (re-run only the setup step on the rented server)
//
// Rents a server with ONE x402 payment and sets Fatline up on it.
// The payment is a single signed USDC authorization on Base. It buys a fixed amount of time;
// that time is the system's life. Renew it (or feed the Life contract) to keep it alive.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, parseAbi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { chooseOption, formatUsdc, readQuote, readReceipt, signPayment } from '../indexer/src/x402.mjs';
import { choosePayer, localWalletKey } from './payer.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.fatline');
const PUBLIC_FILE = join(STATE, 'compute.json');
const SECRET_FILE = join(STATE, 'compute.secret.json');
const WALLET_FILE = join(STATE, 'compute-wallet.key');
const SSH_KEY = join(STATE, 'ssh_ed25519');
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const CHAINS = { 8453: base, 84532: baseSepolia };

function defaultNetwork() {
  const file = [join(ROOT, 'fatline.config.json'), join(ROOT, 'fatline.config.example.json')].find(existsSync);
  return JSON.parse(readFileSync(file, 'utf8')).defaultNetwork;
}

function args() {
  const a = process.argv.slice(2);
  const get = (name, fallback) => {
    const i = a.indexOf(`--${name}`);
    return i >= 0 ? a[i + 1] : fallback;
  };
  // The default is the seller that can hold a full node: AgentMetal, by the day, with a 700 GB disk.
  const provider = get('provider', 'agentmetal');
  return {
    command: a[0] && !a[0].startsWith('--') ? a[0] : 'rent',
    quoteOnly: a.includes('--quote'),
    pay: get('pay'), // phone | browser | here
    yes: a.includes('--yes'), // the person already said yes to this price (an agent passes it after asking)
    provider,
    sku: get('sku'),
    plan: get('plan'),
    days: Number(get('days', '1')),
    // A node's disk: Snapchain keeps 1 day of blocks (~560 GB today); Hypersnap keeps everything (~730 GB).
    disk: Number(get('disk', provider !== 'agentmetal' ? '0' : (get('network') ?? defaultNetwork()) === 'hypersnap' ? '900' : '700')),
    node: a.includes('--node'),
    region: get('region', 'EU'),
    network: get('network') ?? defaultNetwork(),
    maxUsdc: Number(get('max-usdc', '50')),
    vault: get('vault', ''),
  };
}

function ask(question, { hidden = false } = {}) {
  return new Promise((done) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); done(answer.trim()); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const usdcBalance = (address) => createPublicClient({ chain: base, transport: http() })
  .readContract({ address: USDC_BASE, abi: erc20, functionName: 'balanceOf', args: [address] });

/** The wallet that pays: your phone wallet (QR), a browser wallet on this computer, or one made here. Never a pasted key. */
const payingAccount = (opts) => choosePayer({ root: ROOT, state: STATE, how: opts.pay, ask });

/** Says how paying works, and the balance of this machine's wallet if there is one. */
async function showPayer() {
  const w = localWalletKey(STATE);
  console.log(`  Paid by           your own wallet: scan a QR code with your phone wallet, or connect a browser
                    wallet on this computer. You approve each payment there; no key is ever typed here.`);
  if (w) {
    const address = privateKeyToAccount(w.key.startsWith('0x') ? w.key : `0x${w.key}`).address;
    console.log(`                    Or ${w.from}: ${address}, ${formatUsdc(await usdcBalance(address).catch(() => 0n))} USDC on Base`);
  }
}

/** A wallet only for compute, so no personal key is ever typed. Fund it with a little USDC on Base; it needs no ETH. */
async function wallet(opts = {}) {
  // fatline compute wallet --pay phone|browser: connect your own wallet and show its USDC. Nothing is signed.
  if (opts.pay && opts.pay !== 'here') {
    const account = await payingAccount(opts);
    try { console.log(`  USDC on Base: ${formatUsdc(await usdcBalance(account.address))} (a node needs ~12 for one day). Nothing was signed.`); }
    finally { await account.close(); }
    return;
  }
  mkdirSync(STATE, { recursive: true });
  if (existsSync(join(STATE, 'worker.key'))) {
    const worker = privateKeyToAccount(readFileSync(join(STATE, 'worker.key'), 'utf8').trim());
    console.log(`Paying with your worker wallet: ${worker.address}`);
    console.log(`USDC on Base:   ${formatUsdc(await usdcBalance(worker.address))}`);
    return;
  }
  if (!existsSync(WALLET_FILE)) {
    writeFileSync(WALLET_FILE, generatePrivateKey() + '\n', { mode: 0o600 });
    console.log('Created a new compute wallet. Its key is in .fatline/compute-wallet.key (mode 600, never committed).');
  }
  chmodSync(WALLET_FILE, 0o600);
  const account = privateKeyToAccount(readFileSync(WALLET_FILE, 'utf8').trim());
  console.log(`Compute wallet: ${account.address}`);
  console.log(`USDC on Base:   ${formatUsdc(await usdcBalance(account.address))}`);
  console.log('Send USDC on Base to that address. Payments are signatures (x402), so it needs no ETH.');
}

/** One x402 purchase: ask for the price, check it, sign it, send it. Returns the parsed response. */
async function buy({ url, body, account, provider, label }) {
  const p = provider;
  const send = (headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const first = await send();
  if (first.status !== 402) throw new Error(`${label}: expected a 402 price quote, got HTTP ${first.status}: ${await first.text()}`);
  const quote = await readQuote(first);
  const option = chooseOption(quote, [8453]);
  const header = await signPayment({ account, quote, option });
  const headers = { [header.name]: header.value, 'Idempotency-Key': randomUUID() };
  if (provider.paymentHeader) headers[provider.paymentHeader] = header.value;
  const paid = await send(headers);
  const text = await paid.text();
  if (!paid.ok) {
    let why = {}; try { why = JSON.parse(text); } catch {}
    if (why.error === 'quota_exceeded') {
      throw new Error(`${label}: nothing was paid. ${p.label ?? 'The seller'} says: "${why.message}"
  Its limit is per paying wallet, and it can still count a server that already expired.
  Pay from another wallet (--pay phone or --pay browser and pick a different account), or register with the seller to raise it (${why.docs ?? 'see its docs'}).`);
    }
    throw new Error(`${label}: the provider refused the payment (HTTP ${paid.status}), nothing was paid: ${why.message ?? text}`);
  }
  console.log(`  paid ${formatUsdc(option.amount)} USDC for ${label}`);
  return { result: JSON.parse(text), amount: option.amount, receipt: readReceipt(paid) };
}

function sshKey() {
  if (!existsSync(SSH_KEY)) {
    mkdirSync(STATE, { recursive: true });
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'fatline', '-f', SSH_KEY]);
  }
  return readFileSync(`${SSH_KEY}.pub`, 'utf8').trim();
}

const sshArgs = () => ['-i', SSH_KEY, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${join(STATE, 'known_hosts')}`, '-o', 'ConnectTimeout=20'];

/** Daily sellers (AgentMetal): rent N days, optionally add disk, optionally make it a read node. */
async function rentDaily(opts, p) {
  const plan = opts.plan ?? p.defaultPlan;
  const spec = p.plans[plan];
  if (!spec) throw new Error(`Unknown plan "${plan}". Known: ${Object.keys(p.plans).join(', ')}`);
  const days = opts.days;
  if (!(days >= 1 && days <= p.maxDays)) throw new Error(`--days must be 1-${p.maxDays}.`);
  const disk = opts.disk;
  if (disk && (disk < p.storage.minGb || disk > p.storage.maxGb)) throw new Error(`--disk must be ${p.storage.minGb}-${p.storage.maxGb} GB.`);

  console.log(`\nAsking ${p.label} for a price…`);
  const probe = await fetch(`${p.api}/v1/servers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan, days }) });
  if (probe.status !== 402) throw new Error(`Expected a 402 price quote, got HTTP ${probe.status}: ${await probe.text()}`);
  const serverUsdc = Number(formatUsdc(chooseOption(await readQuote(probe), [8453]).amount));
  const diskUsdc = disk ? +(disk * p.storage.usdPerGbDay * days).toFixed(2) : 0;
  const total = +(serverUsdc + diskUsdc).toFixed(2);

  console.log(`
  What you get      ${spec.vcpu} vCPU · ${spec.ramGb} GB RAM · ${spec.diskGb} GB disk${disk ? ` + ${disk} GB volume` : ''}
  How long          ${days} day${days === 1 ? "" : "s"}. Then it is renewed a day at a time, or it dies (2 h grace).
  Price             ${serverUsdc} USDC server${disk ? ` + ~${diskUsdc} USDC disk` : ''} = ~${total} USDC, prepaid, no refunds
  How               ${disk ? 'two signatures (server, then disk)' : 'one signature'}, USDC on Base, no ETH needed
  It will run       ${opts.node ? 'a Farcaster read node (Snapchain), keeping 1 day of blocks' : disk ? 'nothing yet: then fatline node snapchain (or hypersnap) installs your node on it' : 'the indexer + apps, reading from a node'}
  To stop paying    do nothing: it ends when its days end. Renewing is a day at a time.`);
  await showPayer();
  console.log('');
  if (opts.quoteOnly) return console.log('Quote only. Nothing was signed or paid. Rent it: fatline compute');
  if (total > opts.maxUsdc) throw new Error(`~${total} USDC is above --max-usdc ${opts.maxUsdc}. Nothing was paid.`);
  if (!opts.yes && (await ask('Type "pay" to continue: ')) !== 'pay') return console.log('Stopped. Nothing was signed.');

  const account = await payingAccount(opts);
  try {
    const balance = Number(formatUsdc(await usdcBalance(account.address)));
    if (balance < total) throw new Error(`${account.address} has ${balance} USDC on Base; this needs ~${total}. Send USDC on Base to it and run fatline compute again. Nothing was paid.`);
    await rentDailyPaid({ opts, p, plan, days, disk, account });
  } finally { await account.close(); }
  if (!opts.node && disk) {
    await waitForIp(p);
    console.log(`\nYour server is rented. Next, install your node on it: fatline node ${opts.network === 'hypersnap' ? 'hypersnap' : 'snapchain'}`);
    return;
  }
  await deployDaily(opts, p);
}

async function rentDailyPaid({ opts, p, plan, days, disk, account }) {
  const { result: server, receipt } = await buy({ url: `${p.api}/v1/servers`, body: { plan, days, ssh_key: sshKey() }, account, provider: p, label: `the server (${days} days)` });
  const id = server.id;
  mkdirSync(STATE, { recursive: true });
  writeFileSync(SECRET_FILE, JSON.stringify({ provider: opts.provider, rental_id: id, ...server }, null, 2), { mode: 0o600 });
  const record = {
    provider: opts.provider, plan, rentalId: id, ipv4: server.ipv4 ?? null, node: opts.node,
    paidUntil: server.expires_at ? new Date(server.expires_at).toISOString() : null,
    payer: account.address, txHash: receipt?.transaction ?? null, network: opts.network ?? null, diskGb: disk || null,
  };
  writeFileSync(PUBLIC_FILE, JSON.stringify(record, null, 2));
  console.log(`Rented server ${id} (${server.ipv4 ?? 'IP pending'}), alive until ${record.paidUntil}.`);

  if (disk) {
    // The disk is bought for a server that exists, so wait until it does.
    for (let i = 0; i < 40; i++) {
      const s = await (await fetch(`${p.api}/v1/servers/${id}`)).json().catch(() => ({}));
      if (s.status === 'running' || s.status === 'active' || s.ipv4) break;
      await sleep(15_000);
    }
    await buy({ url: `${p.api}/v1/servers/${id}/storage`, body: { gb: disk }, account, provider: p, label: `${disk} GB of disk` });
  }
}

/** Pays for more days on the rented server (daily sellers). */
async function renew(opts) {
  if (!existsSync(SECRET_FILE)) throw new Error('No rented server. Run fatline compute first.');
  const secret = JSON.parse(readFileSync(SECRET_FILE, 'utf8'));
  const p = JSON.parse(readFileSync(join(ROOT, 'infra/providers.json'), 'utf8')).providers[secret.provider];
  if (p?.kind !== 'daily') throw new Error('Only servers rented by the day can be renewed here.');
  const url = p.renew.url.replace('{rental_id}', secret.rental_id);
  if (!opts.yes && (await ask(`Pay for ${opts.days} more day${opts.days === 1 ? '' : 's'}? Type "pay": `)) !== 'pay') return console.log('Stopped. Nothing was signed.');
  const account = await payingAccount(opts);
  try {
    const { result } = await buy({ url, body: { days: opts.days }, account, provider: p, label: `${opts.days} more day${opts.days === 1 ? '' : 's'}` });
    const record = JSON.parse(readFileSync(PUBLIC_FILE, 'utf8'));
    if (result?.expires_at) { record.paidUntil = new Date(result.expires_at).toISOString(); writeFileSync(PUBLIC_FILE, JSON.stringify(record, null, 2)); }
    console.log(`Paid until ${record.paidUntil ?? '(the seller did not say)'}.`);
  } finally { await account.close(); }
}

/** Waits until a daily seller gives the server an IP, and saves it. */
async function waitForIp(p) {
  const secret = JSON.parse(readFileSync(SECRET_FILE, 'utf8'));
  const record = JSON.parse(readFileSync(PUBLIC_FILE, 'utf8'));
  let ip = record.ipv4;
  for (let i = 0; !ip && i < 40; i++) {
    ip = (await (await fetch(`${p.api}/v1/servers/${secret.rental_id}`)).json().catch(() => ({}))).ipv4;
    if (!ip) await sleep(15_000);
  }
  if (!ip) throw new Error('The server has no IP yet. Try again later: fatline compute deploy');
  record.ipv4 = ip;
  writeFileSync(PUBLIC_FILE, JSON.stringify(record, null, 2));
  return { ip, record };
}

async function deployDaily(opts, p) {
  const { ip, record } = await waitForIp(p);
  const target = `root@${ip}`;
  process.stdout.write(`Waiting for SSH on ${ip}`);
  for (let i = 0; i < 60; i++) {
    if (spawnSync('ssh', [...sshArgs(), target, 'true']).status === 0) break;
    process.stdout.write('.'); await sleep(10_000);
  }
  console.log('');
  if (record.node ?? opts.node) {
    const script = readFileSync(join(ROOT, 'infra/node-setup.sh'));
    const put = spawnSync('ssh', [...sshArgs(), target, 'cat > /root/node-setup.sh && chmod +x /root/node-setup.sh'], { input: script });
    if (put.status !== 0) throw new Error('Could not copy the node setup to the server.');
    // The snapshot takes hours, so the setup runs on the server by itself; this machine can disconnect.
    spawnSync('ssh', [...sshArgs(), target, 'setsid nohup /root/node-setup.sh > /root/node-setup.log 2>&1 < /dev/null &'], { stdio: 'inherit' });
    console.log(`The node is being set up on ${ip}. It streams a ~400 GB snapshot first (hours).`);
    console.log('Follow it with: fatline compute status');
    return;
  }
  await deploy(opts);
}

/** Buys (or retries buying) the extra disk for the rented server, then continues the setup. */
async function addDisk(opts) {
  const secret = JSON.parse(readFileSync(SECRET_FILE, 'utf8'));
  const p = JSON.parse(readFileSync(join(ROOT, 'infra/providers.json'), 'utf8')).providers[secret.provider];
  if (p?.kind !== 'daily') throw new Error('Extra disk is only sold by daily providers.');
  if (!opts.disk) throw new Error('Say how much: compute disk --disk 700');
  const account = await payingAccount(opts);
  try { await buy({ url: `${p.api}/v1/servers/${secret.rental_id}/storage`, body: { gb: opts.disk }, account, provider: p, label: `${opts.disk} GB of disk` }); }
  finally { await account.close(); }
  await deployDaily(opts, p);
}

async function status() {
  if (!existsSync(PUBLIC_FILE)) throw new Error('No rented server. Run fatline compute first.');
  const record = JSON.parse(readFileSync(PUBLIC_FILE, 'utf8'));
  console.log(`Server ${record.rentalId} at ${record.ipv4} (${record.provider}), paid until ${record.paidUntil}`);
  const remote = `tail -n 4 /root/node-setup.log 2>/dev/null; echo; df -h /mnt/HC_Volume_* / 2>/dev/null | sed 1d | awk '{print "disk " $6 ": " $3 " used, " $4 " free"}'; free -g | awk '/Mem|Swap/ {print $1 " " $3 "/" $2 " GB"}'; curl -s -m 5 localhost:3381/v1/info | jq -c '.shardInfos[]? | {shard: .shardId, height: .maxHeight, blockDelay}' 2>/dev/null`;
  spawnSync('ssh', [...sshArgs(), `root@${record.ipv4}`, remote], { stdio: 'inherit' });
}


async function rent(opts) {
  const providers = JSON.parse(readFileSync(join(ROOT, 'infra/providers.json'), 'utf8')).providers;
  const p = providers[opts.provider];
  if (!p) throw new Error(`Unknown provider "${opts.provider}". Known: ${Object.keys(providers).join(', ')}`);
  if (p.kind === 'daily') return rentDaily(opts, p);
  const sku = opts.sku ?? p.defaultSku;
  const spec = p.skus[sku];
  if (!spec) throw new Error(`Unknown sku "${sku}". Known: ${Object.keys(p.skus).join(', ')}`);

  const body = JSON.stringify({ sku, region: opts.region });
  const request = (headers = {}) => fetch(p.rent.url, { method: p.rent.method, headers: { 'content-type': 'application/json', ...headers }, body });

  console.log(`\nAsking ${p.label} for a price…`);
  const first = await request();
  if (first.status !== 402) throw new Error(`Expected a 402 price quote, got HTTP ${first.status}: ${await first.text()}`);
  const quote = await readQuote(first);
  const option = chooseOption(quote, [8453]);
  const usdc = Number(formatUsdc(option.amount));

  console.log(`
  What you get      ${spec.vcpu} vCPU · ${spec.ramGb} GB RAM · ${spec.diskGb} GB disk · ${opts.region}
  How long it lives ${spec.days} days (that is the system's life; renew to extend it)
  Price             ${formatUsdc(option.amount)} USDC on Base (chain ${option.chainId})
  Paid to           ${option.payTo}
  How               one signature → one USDC transfer, no ETH needed for gas
  ${p.payOnSuccess ? 'Charged only once the server is reachable; a failed setup costs nothing.' : ''}
  Network           ${opts.network} (readers can switch in the app)
  It will run       the indexer + apps, reading from a node (the disk is too small for a full node).
`);
  if (opts.quoteOnly) return console.log('Quote only. Nothing was signed or paid.');
  if (usdc > opts.maxUsdc) throw new Error(`Price ${usdc} USDC is above --max-usdc ${opts.maxUsdc}. Nothing was paid.`);

  if ((await ask('Type "pay" to continue: ')) !== 'pay') return console.log('Stopped. Nothing was signed.');
  const account = await payingAccount(opts);

  const chain = CHAINS[option.chainId];
  const balance = await createPublicClient({ chain, transport: http() }).readContract({
    address: option.asset, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [account.address],
  });
  if (balance < option.amount) throw new Error(`${account.address} has ${formatUsdc(balance)} USDC on Base; it needs ${formatUsdc(option.amount)}. Nothing was paid.`);

  const header = await signPayment({ account, quote, option }).finally(() => account.close());
  console.log(`Signed by ${account.address}. Sending…`);
  const paid = await request({ [header.name]: header.value });
  const text = await paid.text();
  if (!paid.ok) throw new Error(`The provider refused the payment (HTTP ${paid.status}): ${text}`);
  const rental = JSON.parse(text);
  const receipt = readReceipt(paid);

  mkdirSync(STATE, { recursive: true });
  writeFileSync(SECRET_FILE, JSON.stringify({ provider: opts.provider, ...rental }, null, 2));
  chmodSync(SECRET_FILE, 0o600);
  const record = {
    provider: opts.provider, sku, region: opts.region, rentalId: rental.rental_id, ipv4: rental.ipv4 ?? null,
    paidUntil: rental.expires_at ? new Date(rental.expires_at).toISOString() : null,
    payer: account.address, amountUsdc: formatUsdc(option.amount), txHash: receipt?.transaction ?? null,
    network: opts.network ?? null,
  };
  writeFileSync(PUBLIC_FILE, JSON.stringify(record, null, 2));
  console.log(`Rented. Rental ${rental.rental_id}, alive until ${record.paidUntil}. Credentials saved to .fatline/compute.secret.json (mode 600).`);
  await deploy(opts);
}

async function waitForServer(secret, provider) {
  const url = provider.instance.replace('{rental_id}', secret.rental_id).replace('{root_token}', encodeURIComponent(secret.root_token));
  const deadline = Date.now() + 20 * 60_000;
  process.stdout.write('Waiting for the server to boot');
  while (Date.now() < deadline) {
    const res = await fetch(url).catch(() => null);
    const s = res?.ok ? await res.json() : null;
    if (s?.phase === 'ready' && s.ipv4) { process.stdout.write(' ready\n'); return s; }
    if (s?.phase === 'expired') throw new Error('The rental expired before it became ready.');
    process.stdout.write('.');
    await sleep(15_000);
  }
  throw new Error('The server did not become ready in 20 minutes. Check later with: fatline compute deploy');
}

/** Copies this repository to the server and runs infra/server-setup.sh there. */
async function deploy(opts) {
  if (!existsSync(SECRET_FILE)) throw new Error('No rental found. Run fatline compute first.');
  const secret = JSON.parse(readFileSync(SECRET_FILE, 'utf8'));
  const record = JSON.parse(readFileSync(PUBLIC_FILE, 'utf8'));
  const provider = JSON.parse(readFileSync(join(ROOT, 'infra/providers.json'), 'utf8')).providers[secret.provider];
  const status = await waitForServer(secret, provider);
  const ip = status.ipv4;
  const password = status.connection?.password ?? status.root_password ?? secret.root_password;
  record.ipv4 = ip;
  writeFileSync(PUBLIC_FILE, JSON.stringify(record, null, 2));

  // ssh reads the password from a tiny helper instead of a prompt or a command-line argument.
  const askpass = join(STATE, 'askpass.sh');
  writeFileSync(askpass, '#!/bin/sh\nprintf "%s\\n" "$FATLINE_SSH_PASSWORD"\n');
  chmodSync(askpass, 0o700);
  const env = { ...process.env, SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: process.env.DISPLAY ?? ':0', FATLINE_SSH_PASSWORD: password };
  const sshOpts = ['-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${join(STATE, 'known_hosts')}`, '-o', 'ConnectTimeout=20'];
  const target = `root@${ip}`;

  console.log(`Copying Fatline to ${ip}…`);
  const tar = execFileSync('tar', [
    '-czf', '-', '--exclude=node_modules', '--exclude=.git', '--exclude=dist', '--exclude=out', '--exclude=cache',
    '--exclude=.fatline', '--exclude=research/sources', '--exclude=apps/voice', '--exclude=apps/checklist',
    '--exclude=broadcast', '-C', ROOT, '.',
  ], { maxBuffer: 512 * 1024 * 1024 });
  const copy = spawnSync('ssh', [...sshOpts, target, 'mkdir -p /opt/fatline/.fatline && tar -xzf - -C /opt/fatline'], { input: tar, env, stdio: ['pipe', 'inherit', 'inherit'] });
  if (copy.status !== 0) throw new Error('Copying to the server failed.');
  spawnSync('ssh', [...sshOpts, target, 'cat > /opt/fatline/.fatline/compute.json'], { input: JSON.stringify(record), env });
  // The server renews its own rental, so it keeps the rental token (not the paying key, which never leaves this machine).
  spawnSync('ssh', [...sshOpts, target, 'umask 077 && cat > /opt/fatline/.fatline/compute.secret.json'], { input: readFileSync(SECRET_FILE), env });

  // Prefer key login from now on, if this machine has a public key.
  const pub = ['id_ed25519.pub', 'id_rsa.pub'].map((f) => join(homedir(), '.ssh', f)).find(existsSync);
  if (pub) spawnSync('ssh', [...sshOpts, target, 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys'], { input: readFileSync(pub), env });

  const network = opts.network ?? record.network ?? '';
  console.log('Running the setup on the server (Node.js, build, services, HTTPS)…');
  const setup = spawnSync('ssh', [...sshOpts, target, `FATLINE_IP=${ip} FATLINE_NETWORK=${network} FATLINE_VAULT=${opts.vault} bash /opt/fatline/infra/server-setup.sh`], { env, stdio: 'inherit' });
  if (setup.status !== 0) throw new Error('Setup on the server failed. Fix it and re-run: fatline compute deploy');

  console.log(`\nFatline is alive at https://${ip.replaceAll('.', '-')}.sslip.io until ${record.paidUntil}.`);
  console.log(`SSH: ssh root@${ip}${pub ? '' : ' (password in .fatline/compute.secret.json)'}`);
}

const opts = args();
const commands = {
  rent,
  renew,
  down: async () => {
    if (!existsSync(PUBLIC_FILE)) return console.log('No server rented with USDC from this machine. Nothing is costing money here.');
    const r = JSON.parse(readFileSync(PUBLIC_FILE, 'utf8'));
    console.log(`Server ${r.rentalId} (${r.provider}) is prepaid until ${r.paidUntil}. Nothing more is charged: it stops when that time ends, unless it is renewed.`);
  },
  wallet,
  disk: addDisk,
  status,
  deploy: async (o) => {
    const secret = existsSync(SECRET_FILE) ? JSON.parse(readFileSync(SECRET_FILE, 'utf8')) : {};
    const p = JSON.parse(readFileSync(join(ROOT, 'infra/providers.json'), 'utf8')).providers[secret.provider];
    return p?.kind === 'daily' ? deployDaily(o, p) : deploy(o);
  },
};
if (!commands[opts.command]) { console.error(`Unknown: compute ${opts.command}. Use: compute [--quote], compute renew --days N, compute wallet, compute status, compute deploy, compute down, compute hetzner`); process.exit(1); }
// Exit when done: a wallet connection (WalletConnect) can leave sockets open.
commands[opts.command](opts).then(() => process.exit(0), (err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
