// Moves Fatline's app account (@fatline) to a recovery phrase, so a person can sign in to it in the Farcaster app.
// Its custody was the genesis server's attester key: a raw key, which the Farcaster app can't import.
//
//   node src/app-custody.mjs new        ON THE OWNER'S OWN COMPUTER, in a terminal (never through an agent's shell):
//                                       makes a 24-word phrase and shows it once; you write it down and type one word
//                                       back; the screen is cleared. Then the new address signs the transfer (EIP-712,
//                                       no gas), and its key goes straight to the genesis server over SSH as
//                                       app-custody.key.pending (mode 600). Nothing is printed but the address.
//   node src/app-custody.mjs transfer   ON THE GENESIS SERVER: the current custody sends IdRegistry.transfer on
//                                       Optimism, checks the new owner onchain, then makes app-custody.key live.
//                                       From then on the server signs Sign in with Farcaster requests with it.
//
// The attester key is not touched: it stays the hatchery's key, which the Fatliners contract knows.
// Recovery stays where it was (the keeper's warplet). The account's posting key, casts and follows are unchanged.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { optimism } from 'viem/chains';
import { english, generateMnemonic, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { ID_REGISTRY_ADDRESS, ViemLocalEip712Signer } from '@farcaster/core';

const FID = 3356653n;
const MASTER = '46.225.208.199';
const RPC = process.env.OP_RPC ?? 'https://mainnet.optimism.io';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const abi = parseAbi([
  'function idOf(address) view returns (uint256)',
  'function custodyOf(uint256) view returns (address)',
  'function nonces(address) view returns (uint256)',
  'function transfer(address to, uint256 deadline, bytes sig)',
]);
const op = createPublicClient({ chain: optimism, transport: http(RPC) });

async function makeNew() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Run this yourself, in a terminal window of your own: it shows a recovery phrase, which must never pass through an agent or a chat.');
    process.exit(1);
  }
  const custody = await op.readContract({ address: ID_REGISTRY_ADDRESS, abi, functionName: 'custodyOf', args: [FID] });
  console.log(`\n  @fatline (FID ${FID}) is owned today by ${custody}, a raw key on the genesis server.`);
  console.log('  This makes a new 24-word recovery phrase for it. You will sign in to the Farcaster app with it.\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  if ((await rl.question('  Nobody can see your screen? [y/N] ')).trim().toLowerCase() !== 'y') { console.log('  Stopped. Nothing was made.'); process.exit(0); }

  const phrase = generateMnemonic(english, 256);
  const account = mnemonicToAccount(phrase); // m/44'/60'/0'/0/0, the address the Farcaster app uses
  if (await op.readContract({ address: ID_REGISTRY_ADDRESS, abi, functionName: 'idOf', args: [account.address] })) throw new Error('That address already owns an account. Run again.');
  const words = phrase.split(' ');
  console.log('\n  Write these 24 words down, on paper, in order. They are @fatline from now on.\n');
  for (let i = 0; i < 24; i += 4) console.log('  ' + words.slice(i, i + 4).map((w, j) => `${String(i + j + 1).padStart(2)}. ${w.padEnd(10)}`).join('  '));
  const n = 3 + Math.floor(Math.random() * 20);
  for (;;) {
    const a = (await rl.question(`\n  Written down? Type word number ${n} to continue: `)).trim().toLowerCase();
    if (a === words[n - 1]) break;
    console.log('  That is not it. Check what you wrote.');
  }
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); // clear the screen and its scrollback
  rl.close();

  const nonce = await op.readContract({ address: ID_REGISTRY_ADDRESS, abi, functionName: 'nonces', args: [account.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 24 * 3600);
  const sig = await new ViemLocalEip712Signer(account).signTransfer({ fid: FID, to: account.address, nonce, deadline });
  if (sig.isErr()) throw new Error(sig.error.message);
  const transfer = { fid: Number(FID), to: account.address, deadline: Number(deadline), sig: `0x${Buffer.from(sig.value).toString('hex')}` };

  // The key goes straight to the genesis server (it signs Sign in with Farcaster requests as @fatline), pending until the transfer.
  const pk = `0x${Buffer.from(account.getHdKey().privateKey).toString('hex')}`;
  const ssh = (cmd, input) => spawnSync('ssh', ['-i', join(ROOT, '.fatline/ssh_ed25519'), '-o', 'IdentitiesOnly=yes', '-o', `UserKnownHostsFile=${join(ROOT, '.fatline/known_hosts')}`, '-o', 'BatchMode=yes', `root@${MASTER}`, cmd], { input, encoding: 'utf8' });
  const put = ssh('umask 077 && cat > /root/.fatline/app-custody.key.pending', pk + '\n');
  if (put.status !== 0) throw new Error(`Could not reach the genesis server: ${put.stderr}`);
  ssh('cat > /root/.fatline/app-custody-transfer.json', JSON.stringify(transfer, null, 1));
  writeFileSync(join(ROOT, '.fatline/app-custody-transfer.json'), JSON.stringify(transfer, null, 1)); // public data: no key
  console.log(`\n  Done. @fatline's new address: ${account.address}`);
  console.log('  Its signature for the transfer and its key are on the genesis server. The screen was cleared.');
  console.log('  Tell your agent "done". Keep the paper safe: whoever has those words has @fatline.\n');
}

async function transfer() {
  const data = '/root/.fatline';
  const t = JSON.parse(readFileSync(join(data, 'app-custody-transfer.json'), 'utf8'));
  const pending = join(data, 'app-custody.key.pending');
  if (!existsSync(pending)) throw new Error('No pending key. Run "new" first, on the owner\'s computer.');
  const k = readFileSync(pending, 'utf8').trim();
  if (privateKeyToAccount(k).address.toLowerCase() !== t.to.toLowerCase()) throw new Error('The pending key is not the transfer\'s new address.');
  const now = await op.readContract({ address: ID_REGISTRY_ADDRESS, abi, functionName: 'custodyOf', args: [FID] });
  if (now.toLowerCase() !== t.to.toLowerCase()) {
    const a = readFileSync(join(data, 'attester.key'), 'utf8').trim();
    const from = privateKeyToAccount(a.startsWith('0x') ? a : `0x${a}`);
    if (from.address.toLowerCase() !== now.toLowerCase()) throw new Error(`The custody is ${now}, not this server's key.`);
    const wallet = createWalletClient({ account: from, chain: optimism, transport: http(RPC) });
    const { request } = await op.simulateContract({ account: from, address: ID_REGISTRY_ADDRESS, abi, functionName: 'transfer', args: [t.to, BigInt(t.deadline), t.sig] });
    const hash = await wallet.writeContract(request);
    console.log(`sent ${hash}`);
    const r = await op.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') throw new Error(`The transfer failed: ${hash}`);
  }
  const after = await op.readContract({ address: ID_REGISTRY_ADDRESS, abi, functionName: 'custodyOf', args: [FID] });
  if (after.toLowerCase() !== t.to.toLowerCase()) throw new Error(`Custody is still ${after}.`);
  renameSync(pending, join(data, 'app-custody.key'));
  console.log(`@fatline (FID ${FID}) is owned by ${after} now; the server signs Sign in with Farcaster with app-custody.key.`);
}

const cmd = process.argv[2];
await ({ new: makeNew, transfer }[cmd] ?? (() => { console.log('Usage: node src/app-custody.mjs new | transfer'); process.exit(1); }))();
