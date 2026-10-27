// The node keeps its own bills paid, without holding the money.
//
// payCompute() on a vault can be called by anyone, and it only ever moves USDC, only to the vault's payee (its
// "keeper", chosen by the holder: for Aster, the deposit address of the card that pays Hetzner). So the node only
// spends gas. Its only write is payCompute: it never sends ETH or any token anywhere, and never calls withdraw/sweep.
//
// Onchain, each call moves at most rate × billingPeriod (the holder sets both). Here, on top, the config's policy
// (fatline.config.json → "pay"); with no policy, or an unverified payee, or mode "dry-run", it only says what it would do:
//   payee          the address the vault must be paying (else: nothing)
//   payeeVerified  true only once the card's provider confirms USDC on Base to it AND a test deposit arrived
//   mode           "dry-run" (default) | "live"
//   reserveUsdc    the vault never goes below this (default 50)
//   maxPerTransferUsdc  skip any payment larger than this (default 10)
//   periodDays     the billing period a launch sets (default 1: small payments, daily)
import { vaultAbi } from './launchpad.mjs';

const DAY_S = 86_400n;
const usdc = (n) => BigInt(Math.round(Number(n) * 1e6));
const fmt = (u) => (Number(u) / 1e6).toFixed(2);

export function payPolicy(p = {}) {
  return {
    payee: /^0x[0-9a-fA-F]{40}$/.test(p.payee ?? '') ? p.payee.toLowerCase() : null,
    verified: p.payeeVerified === true,
    live: p.mode === 'live',
    reserve: usdc(Math.max(1, Number(p.reserveUsdc ?? 50))), // never the whole balance
    maxPer: usdc(Number(p.maxPerTransferUsdc ?? 10)),
    periodDays: Math.min(31, Math.max(1, Number(p.periodDays ?? 1))),
  };
}

/** What to do for one vault right now. Pure: the decision only. */
export function decide({ amount, rate, paidThrough, payee, available, self, nowS, policy = payPolicy() }) {
  const no = (why) => ({ pay: false, why });
  if (payee.toLowerCase() === self.toLowerCase()) return no('its payee is this node: set a separate one with setKeeper');
  if (amount === 0n) return no('nothing to pay');
  const urgent = paidThrough < nowS + DAY_S; // less than a day left
  if (amount < rate * DAY_S && !urgent) return no('less than a day is due');
  if (!policy.payee) return no(`dry run: would pay ${fmt(amount)} USDC to ${payee} (no payee in the config)`);
  if (payee.toLowerCase() !== policy.payee) return no(`the vault pays ${payee}, the config expects ${policy.payee}: nothing sent`);
  if (amount > policy.maxPer) return no(`${fmt(amount)} USDC is over the ${fmt(policy.maxPer)} cap: lower the vault's billing period`);
  if (available - amount < policy.reserve) return no(`would leave ${fmt(available - amount)} USDC, under the ${fmt(policy.reserve)} reserve`);
  if (!policy.verified || !policy.live) return { pay: false, dryRun: true, why: `dry run: would pay ${fmt(amount)} USDC to ${payee}${policy.verified ? '' : ' (payee not verified)'}` };
  return { pay: true, why: urgent ? 'less than a day paid' : 'a day or more is due' };
}

/** Triggers payCompute on each vault when the policy allows. vaults: addresses. Returns one line per vault. */
export async function triggerPayments({ client, wallet, vaults, policy = payPolicy(), log = console.log }) {
  const self = wallet.account.address;
  const out = [];
  for (const vault of vaults) {
    try {
      const read = (functionName) => client.readContract({ address: vault, abi: vaultAbi, functionName });
      const [[amount], rate, paidThrough, payee, balance, pending] = await Promise.all(
        ['computeDue', 'ratePerSecond', 'paidThrough', 'keeper', 'balance', 'pendingFees'].map(read));
      const d = decide({ amount, rate, paidThrough, payee, available: balance + pending, self, nowS: BigInt(Math.floor(Date.now() / 1000)), policy });
      if (!d.pay) { if (d.dryRun) log(`[pay] ${vault}: ${d.why}`); out.push({ vault, paid: false, why: d.why }); continue; }
      const hash = await wallet.writeContract({ address: vault, abi: vaultAbi, functionName: 'payCompute' }); // the only write
      const receipt = await client.waitForTransactionReceipt({ hash });
      log(`[pay] ${vault}: paid ${fmt(amount)} USDC to ${payee} (tx ${hash}, ${receipt.status})`);
      out.push({ vault, paid: receipt.status === 'success', amount: String(amount), payee, tx: hash });
    } catch (err) {
      out.push({ vault, paid: false, why: String(err.shortMessage ?? err.message).slice(0, 200) });
    }
  }
  return out;
}
