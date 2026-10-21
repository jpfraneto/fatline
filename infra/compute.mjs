// ./infinicaster compute [--quote] [--sku server_small_1mo] [--region EU] [--network farcaster] [--max-usdc 20] [--vault 0x…]
// ./infinicaster compute deploy        (re-run only the setup step on the rented server)
//
// Rents a server with ONE x402 payment and sets Infinicaster up on it.
// The payment is a single signed USDC authorization on Base. It buys a fixed amount of time;
// that time is the system's life. Renew it (or feed the Life contract) to keep it alive.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { chooseOption, formatUsdc, readQuote, readReceipt, signPayment } from '../indexer/src/x402.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.infinicaster');
const PUBLIC_FILE = join(STATE, 'compute.json');
const SECRET_FILE = join(STATE, 'compute.secret.json');
const CHAINS = { 8453: base, 84532: baseSepolia };

function defaultNetwork() {
  const file = [join(ROOT, 'infinicaster.config.json'), join(ROOT, 'infinicaster.config.example.json')].find(existsSync);
  return JSON.parse(readFileSync(file, 'utf8')).defaultNetwork;
}

function args() {
  const a = process.argv.slice(2);
  const get = (name, fallback) => {
    const i = a.indexOf(`--${name}`);
    return i >= 0 ? a[i + 1] : fallback;
  };
  return {
    command: a[0] && !a[0].startsWith('--') ? a[0] : 'rent',
    quoteOnly: a.includes('--quote'),
    provider: get('provider', 'vpsagent'),
    sku: get('sku'),
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

async function rent(opts) {
  const providers = JSON.parse(readFileSync(join(ROOT, 'infra/providers.json'), 'utf8')).providers;
  const p = providers[opts.provider];
  if (!p) throw new Error(`Unknown provider "${opts.provider}". Known: ${Object.keys(providers).join(', ')}`);
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

  if ((await ask('Type "pay" to sign this payment: ')) !== 'pay') return console.log('Stopped. Nothing was signed.');
  const key = process.env.X402_PRIVATE_KEY || (await ask('Private key of the paying wallet (hidden, never saved): ', { hidden: true }));
  const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);

  const chain = CHAINS[option.chainId];
  const balance = await createPublicClient({ chain, transport: http() }).readContract({
    address: option.asset, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [account.address],
  });
  if (balance < option.amount) throw new Error(`${account.address} has ${formatUsdc(balance)} USDC on Base; it needs ${formatUsdc(option.amount)}. Nothing was paid.`);

  const header = await signPayment({ account, quote, option });
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
  console.log(`Rented. Rental ${rental.rental_id}, alive until ${record.paidUntil}. Credentials saved to .infinicaster/compute.secret.json (mode 600).`);
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
  throw new Error('The server did not become ready in 20 minutes. Check later with: ./infinicaster compute deploy');
}

/** Copies this repository to the server and runs infra/server-setup.sh there. */
async function deploy(opts) {
  if (!existsSync(SECRET_FILE)) throw new Error('No rental found. Run ./infinicaster compute first.');
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
  writeFileSync(askpass, '#!/bin/sh\nprintf "%s\\n" "$INFINICASTER_SSH_PASSWORD"\n');
  chmodSync(askpass, 0o700);
  const env = { ...process.env, SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: process.env.DISPLAY ?? ':0', INFINICASTER_SSH_PASSWORD: password };
  const sshOpts = ['-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${join(STATE, 'known_hosts')}`, '-o', 'ConnectTimeout=20'];
  const target = `root@${ip}`;

  console.log(`Copying Infinicaster to ${ip}…`);
  const tar = execFileSync('tar', [
    '-czf', '-', '--exclude=node_modules', '--exclude=.git', '--exclude=dist', '--exclude=out', '--exclude=cache',
    '--exclude=.infinicaster', '--exclude=research/sources', '--exclude=apps/voice', '--exclude=apps/checklist',
    '--exclude=broadcast', '-C', ROOT, '.',
  ], { maxBuffer: 512 * 1024 * 1024 });
  const copy = spawnSync('ssh', [...sshOpts, target, 'mkdir -p /opt/infinicaster/.infinicaster && tar -xzf - -C /opt/infinicaster'], { input: tar, env, stdio: ['pipe', 'inherit', 'inherit'] });
  if (copy.status !== 0) throw new Error('Copying to the server failed.');
  spawnSync('ssh', [...sshOpts, target, 'cat > /opt/infinicaster/.infinicaster/compute.json'], { input: JSON.stringify(record), env });
  // The server renews its own rental, so it keeps the rental token (not the paying key, which never leaves this machine).
  spawnSync('ssh', [...sshOpts, target, 'umask 077 && cat > /opt/infinicaster/.infinicaster/compute.secret.json'], { input: readFileSync(SECRET_FILE), env });

  // Prefer key login from now on, if this machine has a public key.
  const pub = ['id_ed25519.pub', 'id_rsa.pub'].map((f) => join(homedir(), '.ssh', f)).find(existsSync);
  if (pub) spawnSync('ssh', [...sshOpts, target, 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys'], { input: readFileSync(pub), env });

  const network = opts.network ?? record.network ?? '';
  console.log('Running the setup on the server (Node.js, build, services, HTTPS)…');
  const setup = spawnSync('ssh', [...sshOpts, target, `INFINICASTER_IP=${ip} INFINICASTER_NETWORK=${network} INFINICASTER_VAULT=${opts.vault} bash /opt/infinicaster/infra/server-setup.sh`], { env, stdio: 'inherit' });
  if (setup.status !== 0) throw new Error('Setup on the server failed. Fix it and re-run: ./infinicaster compute deploy');

  console.log(`\nInfinicaster is alive at https://${ip.replaceAll('.', '-')}.sslip.io until ${record.paidUntil}.`);
  console.log(`SSH: ssh root@${ip}${pub ? '' : ' (password in .infinicaster/compute.secret.json)'}`);
}

const opts = args();
(opts.command === 'deploy' ? deploy(opts) : rent(opts)).catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
