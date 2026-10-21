// Builds the Clanker v4 `deployToken` call for an Infinicaster app coin, using the official SDK.
// The coin is paired with USDC and 100% of its trading fees go to the app's vault, in USDC,
// with the vault as the only fee admin. AppFactory checks all of this onchain and reverts otherwise.
//
//   node indexer/src/launch.mjs <vault> <tokenAdmin> <name> <symbol> [image] [chainId] [startMarketCapUsd]
// prints the calldata hex (used by the fork test and by ./infinicaster launch).
import { Clanker } from 'clanker-sdk/v4';
import { keccak256, toHex } from 'viem';

export const USDC = { 8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' };
const SUPPLY = 100_000_000_000; // every Clanker coin: 100 billion, 18 decimals
const TICK_SPACING = 200;
const RANGE = 110_400; // same width as Clanker's "Standard" position (~$27K to ~$1.5B with WETH)

/**
 * Starting tick for a USDC pair at a given market cap. Prices in a pool are raw units:
 * USDC has 6 decimals and the coin 18, so 1 USD per coin = 1e6 / 1e18 raw.
 */
export function usdcStartTick(marketCapUsd) {
  const rawPrice = (marketCapUsd / SUPPLY) * 1e6 / 1e18;
  const tick = Math.log(rawPrice) / Math.log(1.0001);
  return Math.floor(tick / TICK_SPACING) * TICK_SPACING;
}

export async function buildLaunch({ vault, tokenAdmin, name, symbol, image = '', description = '', chainId = 8453, startMarketCapUsd = 25_000, salt }) {
  const start = usdcStartTick(startMarketCapUsd);
  const clanker = new Clanker({});
  const tx = await clanker.getDeployTransaction({
    chainId,
    name,
    symbol,
    image,
    tokenAdmin,
    salt: salt ?? keccak256(toHex(`${vault}:${symbol}:${Date.now()}`)),
    metadata: { description },
    context: { interface: 'Infinicaster' },
    pool: {
      pairedToken: USDC[chainId],
      tickIfToken0IsClanker: start,
      tickSpacing: TICK_SPACING,
      positions: [{ tickLower: start, tickUpper: start + RANGE, positionBps: 10_000 }],
    },
    rewards: { recipients: [{ recipient: vault, admin: vault, bps: 10_000, token: 'Paired' }] },
  });
  const { encodeFunctionData } = await import('viem');
  return {
    clanker: tx.address,
    data: encodeFunctionData({ abi: tx.abi, functionName: tx.functionName, args: tx.args }),
    value: tx.value ?? 0n,
    expectedToken: tx.expectedAddress ?? null,
    startTick: start,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [vault, tokenAdmin, name, symbol, image, chainId, mcap] = process.argv.slice(2);
  const out = await buildLaunch({ vault, tokenAdmin, name, symbol, image, chainId: Number(chainId ?? 8453), startMarketCapUsd: Number(mcap ?? 25_000), salt: keccak256(toHex(`${vault}:${symbol}`)) });
  process.stdout.write(out.data);
}
