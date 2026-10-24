// fatline coin launch: a Fatliner's coin, through the one launchpad.
//
//   fatline coin launch                       simulate launching $FATLINE (Aster, FID 18350) against Base right now
//   fatline coin launch --go --seed-file F    do it: signed by the Fatliner's holder (the key comes from F, used once)
//   options: --fid N --name "…" --image URL --keeper 0x… --mcap 25000
//
// The ticker is not an option: it is the Fatliner's surname, read from its DNA when it hatched
// (Fatliners.surnameOf), and the launchpad refuses any other. $FATLINE (Aster) launches first.
//
// One transaction, AppFactory.launchFatline: the Fatliner's vault (owned by whoever holds the Fatliner) and its
// Clanker v4 coin, paired with USDC, with 100% of the trading fees going to that vault. The keeper is the
// server that keeps the Fatliner alive: it pays itself for compute from the vault, in USDC.
// Only the holder of the Fatliner can do this, once. Defaults: the genesis Fatliner, Aster, $FATLINE.
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, formatEther, http, parseAbi } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { loadConfig } from './config.mjs';
import { buildLaunch } from './launch.mjs';

const factoryAbi = parseAbi([
  'struct AppParams { address owner; address keeper; uint256 billingPeriod; string uri; bytes32 salt; }',
  'function launchFatline(uint256 fid, AppParams p, bytes deployCalldata, uint256 deposit) payable returns (address vault, address coin)',
  'function predictFatlinerVault(uint256 fid) view returns (address)',
  'function vaultOfFatliner(uint256 fid) view returns (address)',
  'function coinOfFatliner(uint256 fid) view returns (address)',
  'function coinsLaunched() view returns (uint256)',
]);
const nftAbi = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function isFatliner(uint256) view returns (bool)',
  'function surnameOf(uint256) view returns (string)',
  'function genesisFid() view returns (uint256)',
]);
const ZERO = '0x0000000000000000000000000000000000000000';

function args() {
  const a = process.argv.slice(2);
  const get = (n) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  return { print: a.includes('--print'), go: a.includes('--go'), seedFile: get('seed-file'), fid: get('fid'), name: get('name'), image: get('image'), keeper: get('keeper'), mcap: get('mcap') };
}

export async function planFatlineLaunch(config, opts = {}) {
  const d = config.deployments;
  const g = d.Fatliners.genesis;
  const fid = Number(opts.fid ?? g.fid);
  const isGenesis = fid === g.fid;
  const client = createPublicClient({ chain: base, transport: http(process.env.FATLINERS_RPC ?? config.hatchery?.rpc ?? 'https://mainnet.base.org') });
  const nft = (functionName, args = [BigInt(fid)]) => client.readContract({ address: d.Fatliners.address, abi: nftAbi, functionName, args });
  const pad = (functionName, args = [BigInt(fid)]) => client.readContract({ address: d.AppFactory.address, abi: factoryAbi, functionName, args });
  if (!(await nft('isFatliner'))) throw new Error(`#${fid} is not a hatched Fatliner. Only Fatliners have coins.`);
  const [holder, ticker, vault, existingCoin, launched] = await Promise.all([nft('ownerOf'), nft('surnameOf'), pad('predictFatlinerVault'), pad('coinOfFatliner'), pad('coinsLaunched', [])]);
  if (existingCoin !== ZERO) throw new Error(`Fatliner #${fid} already has its coin: ${existingCoin}`);
  if (launched === 0n && !isGenesis) throw new Error(`$${g.ticker} (Aster) launches first. Then every other Fatliner can.`);
  const titled = ticker.charAt(0) + ticker.slice(1).toLowerCase();
  const name = opts.name ?? (isGenesis ? `${g.name} Fatline` : titled);
  const image = opts.image ?? (isGenesis ? 'https://fatline.ink/img/world/aster.jpg' : '');
  const keeper = opts.keeper ?? (isGenesis ? g.server : null);
  if (!keeper) throw new Error('Which server keeps it alive? Pass --keeper 0x… (that server\'s wallet pays itself from the vault).');
  const launch = await buildLaunch({
    vault, tokenAdmin: holder, name, symbol: ticker, image, chainId: 8453, startMarketCapUsd: Number(opts.mcap ?? 25_000),
    description: `${name}: Fatliner #${fid}. 100% of this coin's trading fees go to its vault, in USDC, and keep its Farcaster node alive. fatline.ink/f/${ticker}`,
  });
  const params = { owner: holder, keeper, billingPeriod: 30n * 86_400n, uri: `https://fatline.ink/f/${ticker}`, salt: `0x${'0'.repeat(64)}` };
  return { client, fid, ticker, name, image, holder, vault, keeper, launch, params, factory: d.AppFactory.address };
}

async function main() {
  const opts = args();
  const config = loadConfig();
  const p = await planFatlineLaunch(config, opts);
  console.log(`\n$${p.ticker} · ${p.name} · Fatliner #${p.fid}`);
  console.log(`  holder (signs)   ${p.holder}`);
  console.log(`  its vault        ${p.vault} (100% of the coin's fees, in USDC; every Fatliner's resale royalty too, if this is Aster)`);
  console.log(`  keeper (server)  ${p.keeper}`);
  console.log(`  pair             USDC on Base, Clanker v4, starting market cap ~$${Number(opts.mcap ?? 25_000).toLocaleString('en')}`);
  console.log(`  coin will be     ${p.launch.expectedToken ?? '(known after the transaction)'}`);
  const call = { address: p.factory, abi: factoryAbi, functionName: 'launchFatline', args: [BigInt(p.fid), p.params, p.launch.data, 0n], value: p.launch.value ?? 0n };
  const sim = await p.client.simulateContract({ ...call, account: p.holder });
  console.log(`\nSimulated on Base just now, as the holder: OK. Vault ${sim.result[0]}, coin ${sim.result[1]}.`);
  if (opts.print) {
    // The transaction, for a wallet or a tool to send as the holder.
    const { encodeFunctionData } = await import('viem');
    console.log(JSON.stringify({ from: p.holder, to: p.factory, value: String(call.value), data: encodeFunctionData(call) }));
    return;
  }
  if (!opts.go) {
    console.log('Nothing was sent. To launch it: fatline coin launch --go --seed-file <the holder\'s seed phrase file>');
    return;
  }
  if (!opts.seedFile) throw new Error('--go needs --seed-file: the holder signs this, nobody else can.');
  const phrase = readFileSync(opts.seedFile.replace(/^~(?=\/)/, process.env.HOME), 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join(' ').trim();
  const account = mnemonicToAccount(phrase.toLowerCase().split(/\s+/).join(' '));
  if (account.address.toLowerCase() !== p.holder.toLowerCase()) throw new Error(`That phrase is ${account.address}, not the holder ${p.holder}. Nothing was sent.`);
  const wallet = createWalletClient({ account, chain: base, transport: http(config.hatchery?.rpc ?? 'https://mainnet.base.org') });
  const gas = await p.client.getBalance({ address: account.address });
  console.log(`\nSending, from ${account.address} (${formatEther(gas)} ETH for gas)…`);
  const hash = await wallet.writeContract(call);
  const receipt = await p.client.waitForTransactionReceipt({ hash });
  console.log(`${receipt.status === 'success' ? 'Launched' : 'FAILED'}: ${hash} (block ${receipt.blockNumber})`);
  console.log(`  $${p.ticker}  ${sim.result[1]}\n  vault    ${sim.result[0]}\n  page     https://fatline.ink/base/${sim.result[1]}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.shortMessage ?? err.message); process.exit(1); });
}
