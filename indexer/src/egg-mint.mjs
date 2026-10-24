// fatline egg, when you have no egg yet: mint it to the wallet tied to your Farcaster account.
//
//   1. where you are: your node, your FID
//   2. the rules, in four lines, before anything is signed
//   3. a QR code (the Fatline wallet page): connect the wallet tied to your FID
//   4. a node checks that tie: the wallet is your account's custody address, or one of its verified addresses
//   5. the mint: Aster (the genesis egg) with claimGenesis() from the wallet it is reserved for; any other egg is
//      laid on your server and minted to that wallet (the attesters sign it; anyone can submit it)
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { createPublicClient, encodeFunctionData, getAddress, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { fidOfCustody } from './identity.mjs';
import { Network } from './hub.mjs';
import { loadAppKey } from './writer.mjs';

const abi = parseAbi([
  'function claimGenesis()',
  'function genesisTo() view returns (address)',
  'function genesisFid() view returns (uint256)',
  'function stageOf(uint256) view returns (uint8)',
]);
const ZERO = '0x0000000000000000000000000000000000000000';
const say = (s = '') => console.log(s);
const ok = (s) => say(`  ✓ ${s}`);

/** Is `address` tied to `fid`: its custody address, or a verified Ethereum address? Read from a node. */
export async function tieOf(node, address, fid) {
  const a = address.toLowerCase();
  const custodyFid = await fidOfCustody(node, address).catch(() => null);
  if (custodyFid && (!fid || custodyFid === Number(fid))) return { fid: custodyFid, how: 'custody address' };
  if (!fid) return null;
  const res = await fetch(`${node.url}/v1/verificationsByFid?fid=${fid}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
  const found = (res?.messages ?? []).some((m) => String(m.data?.verificationAddAddressBody?.address ?? '').toLowerCase() === a);
  return found ? { fid: Number(fid), how: 'verified address' } : null;
}

export async function mintEgg(config, opts = {}) {
  const d = config.deployments;
  const contract = d.Fatliners.address;
  const client = createPublicClient({ chain: base, transport: http(config.hatchery?.rpc ?? 'https://mainnet.base.org') });
  const read = (functionName, args = []) => client.readContract({ address: contract, abi, functionName, args });

  // 1. Where you are.
  const networkName = config.defaultNetwork;
  const network = new Network(networkName, config.networks[networkName]);
  // Any node in sync will do for the checks (yours may still be downloading): yours, then the public ones.
  const node = (await network.node().catch(() => null)) ?? { url: 'https://crackle.farcaster.xyz:3381', label: 'crackle.farcaster.xyz (not yours: yours is still being born)', own: false };
  const key = loadAppKey(config.dataDir);
  let known = null; try { known = JSON.parse(readFileSync(join(config.dataDir, 'identity.json'), 'utf8')).fid; } catch {}
  const fid = Number(opts.fid ?? key?.fid ?? known ?? 0) || null;
  say('\nYour egg');
  say(node ? `  node     ${node.label ?? node.url}${node.own ? ' (yours)' : ' (not yours: yours is still catching up)'}` : '  node     none answering yet (run fatline status)');
  say(`  account  ${fid ? `FID ${fid}` : 'not known yet (fatline identity, or the wallet will tell)'}`);

  // 2. The rules, before anything is signed.
  say('\nThe rules, before you sign:');
  say('  · It is an NFT minted to your wallet: token #<your FID>, an egg.');
  say('  · It hatches after three warm days: your node answering, in sync, holding real data, checked every hour.');
  say('  · If your node stops, the egg dies: it is burned, and your account sleeps seven days before another.');
  say('  · It changes hands only by sale, in USDC (8% to the builder), and wakes with its new holder\'s account.');

  // 3. The wallet.
  const genesisTo = await read('genesisTo');
  const genesisFid = Number(await read('genesisFid'));
  const forAster = genesisTo !== ZERO;
  const { choosePayer } = await import('../../infra/payer.mjs');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const page = forAster
    ? { title: 'Mint your egg', detail: `Scan with the wallet tied to your Farcaster account. Aster (#${genesisFid}), the first egg, is reserved for ${genesisTo.slice(0, 6)}…${genesisTo.slice(-4)}.`, tx: { fn: 'claimGenesis()', contract, name: 'Fatliners' } }
    : { title: 'Mint your egg', detail: 'Scan with the wallet tied to your Farcaster account (its custody address, or a verified one). Your egg is minted to it.' };
  const wallet = await choosePayer({ root, state: config.dataDir, how: opts.pay ?? 'phone', ask: (q) => rl.question(q), page }).finally(() => rl.close());
  try {
    ok(`connected ${wallet.address}`);

    // 4. The node checks the tie.
    if (!node) throw new Error('No node answers, so the tie between this wallet and your account can\'t be checked. Try again in a minute.');
    const tie = await tieOf(node, wallet.address, fid);
    if (tie) ok(`${node.label ?? node.url} says ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)} is the ${tie.how} of FID ${tie.fid}`);
    else if (!(forAster && wallet.address.toLowerCase() === genesisTo.toLowerCase())) {
      throw new Error(`${node.label ?? node.url} doesn't know ${wallet.address} as the custody or a verified address of ${fid ? `FID ${fid}` : 'any account'}. Connect the wallet tied to your account (or verify this one in your Farcaster app). Nothing was minted.`);
    } else say(`  · ${node.label ?? node.url} doesn't list this wallet for ${fid ? `FID ${fid}` : 'your FID'} yet; Aster is reserved for it, so that's enough.`);

    // 5. The mint.
    if (forAster) {
      if (wallet.address.toLowerCase() !== genesisTo.toLowerCase()) throw new Error(`Aster is reserved for ${genesisTo}; you connected ${wallet.address}. Nothing was minted.`);
      if (!wallet.sendTransaction) throw new Error('Mint from your own wallet: --pay phone (QR code) or --pay browser.');
      await client.simulateContract({ address: contract, abi, functionName: 'claimGenesis', account: wallet.address });
      ok('simulated on Base: it works');
      const hash = await wallet.sendTransaction({ to: contract, data: encodeFunctionData({ abi, functionName: 'claimGenesis' }) });
      say(`  · sent ${hash}, waiting for Base…`);
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error(`The transaction failed: https://basescan.org/tx/${hash}`);
      ok(`Aster's egg is yours: token #${genesisFid}, an egg, in ${wallet.address}`);
      say(`    https://basescan.org/tx/${hash}`);
      say('\nThe genesis server starts counting its warm days within five minutes. Watch it: fatline egg  ·  open your client: fatline up');
      return true;
    }
    say('\n  · laying your egg on your server, to be minted to this wallet…');
    return { layTo: getAddress(wallet.address) };
  } finally {
    await wallet.close?.();
  }
}
