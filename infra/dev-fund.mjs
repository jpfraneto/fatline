// Dev only, on a local fork of Base: gives an address 10,000 USDC and 1 ETH so you can try
// launching and trading without real money. It refuses to run against anything but 127.0.0.1.
import { createPublicClient, createTestClient, http, parseAbi, parseEther, parseUnits } from 'viem';
import { base } from 'viem/chains';

const RPC = 'http://127.0.0.1:8545';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const RICH = '0x498581fF718922c3f8e6A244956aF099B2652b2b'; // Uniswap v4 PoolManager holds plenty of USDC
const to = process.argv[2];

const test = createTestClient({ chain: base, mode: 'anvil', transport: http(RPC) });
const pub = createPublicClient({ chain: base, transport: http(RPC) });
await test.setBalance({ address: RICH, value: parseEther('1') });
await test.setBalance({ address: to, value: parseEther('1') });
await test.impersonateAccount({ address: RICH });
const hash = await test.extend(() => ({})).request({
  method: 'eth_sendTransaction',
  params: [{ from: RICH, to: USDC, data: (await import('viem')).encodeFunctionData({ abi: parseAbi(['function transfer(address,uint256)']), functionName: 'transfer', args: [to, parseUnits('10000', 6)] }) }],
});
await pub.waitForTransactionReceipt({ hash });
await test.stopImpersonatingAccount({ address: RICH });
const bal = await pub.readContract({ address: USDC, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [to] });
console.log(`Funded ${to} on the local fork: ${Number(bal) / 1e6} USDC, 1 ETH`);
