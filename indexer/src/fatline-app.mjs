// One node, one client, one contract. A Fatline client asks the Fatliners contract which smart contract its
// Fatline is tied to (appOf), and runs on it. The first one: Aster's client runs on Voices, its long posts.
//
// Which Fatline this client is: config.fatline.fid, or the genesis Fatliner (Aster) by default.
import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';

const abi = parseAbi(['function appOf(uint256) view returns (address)']);
const ZERO = '0x0000000000000000000000000000000000000000';

/** Reads appOf for this client's Fatline and, if Voices isn't configured, runs on that contract. */
export async function useFatlineApp(config, { client } = {}) {
  const d = config.deployments;
  const fid = Number(config.fatline?.fid ?? d?.Fatliners?.genesis?.fid);
  const contract = config.hatchery?.contract ?? d?.Fatliners?.address;
  config.fatlineApp = { fid, contract, app: null };
  if (!fid || !contract) return config.fatlineApp;
  try {
    client ??= createPublicClient({ chain: base, transport: http(config.hatchery?.rpc ?? 'https://mainnet.base.org', { timeout: 8_000 }) });
    const app = await client.readContract({ address: contract, abi, functionName: 'appOf', args: [BigInt(fid)] });
    if (app && app !== ZERO) {
      config.fatlineApp.app = app;
      if (!config.voices?.address && Number(config.voices?.chainId ?? 8453) === 8453) {
        config.voices = { ...config.voices, chainId: 8453, address: app, fromBlock: d.fromBlock ?? 0 };
        config.fatlineApp.runsOn = 'voices';
      }
    }
  } catch (err) {
    config.fatlineApp.error = String(err.shortMessage ?? err.message).slice(0, 160);
  }
  return config.fatlineApp;
}
