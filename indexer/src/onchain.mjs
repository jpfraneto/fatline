// Transactions you sign in your own wallet, on the Fatline QR page (it shows the function, the contract and a link
// to its code on Basescan). Never a seed phrase or a key file.
//
//   fatline genesis claim            take Aster's egg: only the wallet it is reserved for can (claimGenesis)
//   fatline app set <0x…> [--fid N]  tie one smart contract to your egg: an app, or your own coin. Once, while it is
//                                    an egg (its hatching days), then final (setApp)
//   add --pay browser to use a browser wallet extension instead of a phone
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { createPublicClient, encodeFunctionData, formatEther, getAddress, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { loadConfig } from './config.mjs';
import { loadAppKey } from './writer.mjs';

const abi = parseAbi([
  'function claimGenesis()',
  'function setApp(uint256 fid, address app)',
  'function genesisTo() view returns (address)',
  'function genesisFid() view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function stageOf(uint256) view returns (uint8)',
  'function appOf(uint256) view returns (address)',
]);
const ZERO = '0x0000000000000000000000000000000000000000';

function args() {
  const a = process.argv.slice(2);
  const get = (n) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  return { cmd: a[0], sub: a[1], target: a[2], fid: get('fid'), pay: get('pay') ?? 'phone' };
}

async function send(config, { from, fn, functionName, callArgs = [], title, detail }) {
  const contract = config.deployments.Fatliners.address;
  const client = createPublicClient({ chain: base, transport: http(config.hatchery?.rpc ?? 'https://mainnet.base.org') });
  const call = { address: contract, abi, functionName, args: callArgs };
  await client.simulateContract({ ...call, account: from });
  console.log(`\n  ${fn} on Fatliners ${contract}\n  Simulated on Base as ${from}: OK.`);
  const { choosePayer } = await import('../../infra/payer.mjs');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const account = await choosePayer({ root, state: config.dataDir, how: args().pay, ask: (q) => rl.question(q), page: { title, detail, tx: { fn, contract, name: 'Fatliners' } } }).finally(() => rl.close());
  try {
    if (!account.sendTransaction) throw new Error('Sign it in your own wallet: --pay phone (QR code) or --pay browser.');
    if (account.address.toLowerCase() !== from.toLowerCase()) throw new Error(`You connected ${account.address}; this needs ${from}. Nothing was sent.`);
    console.log(`  ${formatEther(await client.getBalance({ address: from }))} ETH for gas.`);
    const hash = await account.sendTransaction({ to: contract, data: encodeFunctionData(call) });
    console.log(`  Sent: ${hash}. Waiting for Base…`);
    const r = await client.waitForTransactionReceipt({ hash });
    console.log(`${r.status === 'success' ? 'Done' : 'FAILED'}: https://basescan.org/tx/${hash}`);
    return r.status === 'success';
  } finally {
    await account.close?.();
  }
}

async function main() {
  const o = args();
  const config = loadConfig();
  const d = config.deployments;
  const client = createPublicClient({ chain: base, transport: http(config.hatchery?.rpc ?? 'https://mainnet.base.org') });
  const read = (functionName, a = []) => client.readContract({ address: d.Fatliners.address, abi, functionName, args: a });
  if (o.cmd === 'genesis' && o.sub === 'claim') {
    const to = await read('genesisTo');
    if (to === ZERO) throw new Error(`Aster's egg was already claimed: it belongs to ${await read('ownerOf', [await read('genesisFid')])}.`);
    return send(config, { from: to, fn: 'claimGenesis()', functionName: 'claimGenesis', title: "Take Aster's egg",
      detail: `Aster, the first Fatliner, is reserved for ${to.slice(0, 6)}…${to.slice(-4)}. Scan with that wallet and approve one transaction: the egg becomes yours, and it hatches after three warm days on the genesis server.` });
  }
  if (o.cmd === 'app' && o.sub === 'set') {
    if (!/^0x[0-9a-fA-F]{40}$/.test(o.target ?? '')) throw new Error('Usage: fatline app set <contract address> [--fid N]');
    const app = getAddress(o.target);
    const fid = BigInt(o.fid ?? loadAppKey(config.dataDir)?.fid ?? d.Fatliners.genesis.fid);
    if (Number(await read('stageOf', [fid])) !== 1) throw new Error(`#${fid} is not an egg. The app is set while it hatches, once.`);
    if ((await read('appOf', [fid])) !== ZERO) throw new Error(`#${fid} already runs on ${await read('appOf', [fid])}. It is final.`);
    const holder = await read('ownerOf', [fid]);
    return send(config, { from: holder, fn: `setApp(${fid}, ${app.slice(0, 8)}…)`, functionName: 'setApp', callArgs: [fid, app], title: `The contract of #${fid}`,
      detail: `Ties ${app.slice(0, 8)}…${app.slice(-6)} to #${fid}: the smart contract its client runs on. Once, and final. Scan with the wallet that holds #${fid}.` });
  }
  console.error('Usage: fatline genesis claim   ·   fatline app set <0x…> [--fid N]   (add --pay browser for a browser wallet)');
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((ok) => process.exit(ok === false ? 1 : process.exitCode ?? 0), (err) => { console.error(err.shortMessage ?? err.message); process.exit(1); });
}
