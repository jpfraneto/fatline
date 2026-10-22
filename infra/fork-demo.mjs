// Dev only, on a local fork of Base (./fatline contracts fork): launches a demo app through the
// running indexer exactly like the browser does (prepare → USDC permit → one transaction), then
// trades its coin on Uniswap v4 so the vault has real trading fees to harvest.
//
//   node infra/fork-demo.mjs [name] [symbol]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseAbi, parseSignature, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RPC = 'http://127.0.0.1:8545';
const API = process.env.INDEXER_URL ?? 'http://localhost:8787';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const LOCKER = '0xffA37784D619F228D8B379d287a4D7282e500762';
const [name = 'Opinions', symbol = 'OPINE'] = process.argv.slice(2);

const keyFile = join(ROOT, '.fatline/dev.key');
if (!existsSync(keyFile)) throw new Error('Run ./fatline contracts fork first (it creates and funds the dev wallet).');
const me = privateKeyToAccount(readFileSync(keyFile, 'utf8').trim());
const pub = createPublicClient({ chain: base, transport: http(RPC, { timeout: 180_000 }) });
if ((await pub.getChainId()) !== 8453 || !(await pub.request({ method: 'anvil_nodeInfo' }).catch(() => null))) {
  throw new Error('This only runs against a local anvil fork of Base on 127.0.0.1:8545.');
}
const wallet = createWalletClient({ account: me, chain: base, transport: http(RPC, { timeout: 180_000 }) });
const factoryAbi = parseAbi([
  'struct AppParams { address owner; address keeper; uint256 billingPeriod; string uri; bytes32 salt; }',
  'function launchAppWithPermit(AppParams p, bytes deployCalldata, uint256 deposit, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable returns (address, address)',
]);
const erc20 = parseAbi(['function nonces(address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']);

// 1. Launch, exactly like the browser.
const keeper = process.env.KEEPER ?? me.address;
const res = await fetch(`${API}/api/launch/prepare`, { method: 'POST', body: JSON.stringify({
  creator: me.address, keeper, name, symbol, description: 'Opinions without noise, from the network you choose.',
  experience: { type: 'link', url: 'https://github.com/farcasterorg/hypersnap' } }) });
const prep = await res.json();
if (!res.ok) throw new Error(prep.error);
const deposit = parseUnits('100', 6);
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const nonce = await pub.readContract({ address: USDC, abi: erc20, functionName: 'nonces', args: [me.address] });
const { v, r, s } = parseSignature(await me.signTypedData({
  domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC },
  types: { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
  primaryType: 'Permit', message: { owner: me.address, spender: prep.factory, value: deposit, nonce, deadline } }));
const params = { ...prep.params, billingPeriod: BigInt(prep.params.billingPeriod) };
const hash = await wallet.writeContract({ address: prep.factory, abi: factoryAbi, functionName: 'launchAppWithPermit', args: [params, prep.deployCalldata, deposit, deadline, Number(v), r, s], value: BigInt(prep.value) });
await pub.waitForTransactionReceipt({ hash });
const reward = await pub.readContract({ address: LOCKER, abi: parseAbi(['struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }', 'struct R { address token; PoolKey poolKey; uint256 positionId; uint256 numPositions; uint16[] rewardBps; address[] rewardAdmins; address[] rewardRecipients; }', 'function tokenRewards(address) view returns (R)']), functionName: 'tokenRewards', args: [await coinOf(prep.vault)] });
console.log(`Launched "${name}" in one transaction (${hash}).\n  vault ${prep.vault}\n  coin  ${reward.token}`);

// 2. Trade it: deploy the swap helper from the fork test and buy, then sell some.
const artifact = JSON.parse(readFileSync(join(ROOT, 'smart-contracts/out/LaunchOnBase.t.sol/Swapper.json'), 'utf8'));
const deployHash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object });
const swapper = (await pub.waitForTransactionReceipt({ hash: deployHash })).contractAddress;
await pub.request({ method: 'evm_increaseTime', params: [3600] });
for (let i = 0; i < 30; i++) await pub.request({ method: 'evm_mine', params: [] });
const send = async (args) => pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: swapper, abi: artifact.abi, functionName: 'swap', args }) });
await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: USDC, abi: erc20, functionName: 'transfer', args: [swapper, parseUnits('3000', 6)] }) });
await send([reward.poolKey, USDC, parseUnits('3000', 6)]);
const coins = await pub.readContract({ address: reward.token, abi: erc20, functionName: 'balanceOf', args: [swapper] });
await send([reward.poolKey, reward.token, coins / 3n]);
console.log(`Traded: bought with 3,000 USDC, sold a third back. Fees are waiting for the vault.\n  Open ${API}/#/app/${prep.vault}`);

async function coinOf(vault) {
  return pub.readContract({ address: vault, abi: parseAbi(['function coin() view returns (address)']), functionName: 'coin' });
}
