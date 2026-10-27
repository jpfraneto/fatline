// The node keeps its own bills paid, without holding the money.
//
// payCompute() on a vault can be called by anyone, and it only ever pays the vault's keeper: the payee its holder
// chose (for Aster, the USDC top-up address of the card that pays Hetzner). So the node only spends gas to trigger it.
// It never receives USDC, and it refuses to trigger a vault whose payee is the node's own key: the node must never
// hold the treasury. The vault pays up to one billing period ahead (30 days), so the payee stays a month funded.
import { vaultAbi } from './launchpad.mjs';

const DAY_S = 86_400n;

/** What to do for one vault right now. Pure: the decision only. */
export function decide({ amount, rate, paidThrough, payee, self, nowS }) {
  if (payee.toLowerCase() === self.toLowerCase()) return { pay: false, why: 'its payee is this node: set a separate one with setKeeper' };
  if (amount === 0n) return { pay: false, why: 'nothing to pay' };
  const urgent = paidThrough < nowS + DAY_S; // less than a day left
  if (amount < rate * DAY_S && !urgent) return { pay: false, why: 'less than a day is due' };
  return { pay: true, why: urgent ? 'less than a day paid' : 'a day or more is due' };
}

/** Triggers payCompute on each vault when due. vaults: addresses. Returns one line per vault. */
export async function triggerPayments({ client, wallet, vaults, log = console.log }) {
  const self = wallet.account.address;
  const out = [];
  for (const vault of vaults) {
    try {
      const read = (functionName) => client.readContract({ address: vault, abi: vaultAbi, functionName });
      const [[amount], rate, paidThrough, payee] = await Promise.all([read('computeDue'), read('ratePerSecond'), read('paidThrough'), read('keeper')]);
      const d = decide({ amount, rate, paidThrough, payee, self, nowS: BigInt(Math.floor(Date.now() / 1000)) });
      if (!d.pay) { out.push({ vault, paid: false, why: d.why }); continue; }
      const hash = await wallet.writeContract({ address: vault, abi: vaultAbi, functionName: 'payCompute' });
      const receipt = await client.waitForTransactionReceipt({ hash });
      log(`[pay] ${vault}: paid ${Number(amount) / 1e6} USDC to ${payee} (tx ${hash}, ${receipt.status})`);
      out.push({ vault, paid: receipt.status === 'success', amount: String(amount), payee, tx: hash });
    } catch (err) {
      out.push({ vault, paid: false, why: String(err.shortMessage ?? err.message).slice(0, 200) });
    }
  }
  return out;
}
