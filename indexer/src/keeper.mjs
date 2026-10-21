// The keeper: the server paying for its own life.
//
// Every hour it pays itself from the app's vault (the vault harvests the coin's trading fees
// first), and when its rented server is close to expiring, it renews the rental over x402 with
// that USDC. If the vault is empty, nothing can be paid, the rental runs out and the app dies.
//
// Needs: KEEPER_PRIVATE_KEY (the server's own wallet, with a little ETH on Base for gas)
//        and the app's vault address in the config (keeper.vault).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { vaultAbi } from './launchpad.mjs';
import { chooseOption, formatUsdc, readQuote, signPayment } from './x402.mjs';

const HOUR = 3_600_000;
const RENEW_BEFORE_MS = 3 * 24 * HOUR;
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)']);

export class Keeper {
  constructor({ client, chain, privateKey, vault, root, dataDir, launchpad = null, log = console.log }) {
    this.launchpad = launchpad;
    this.client = client;
    this.account = privateKeyToAccount(privateKey);
    this.wallet = createWalletClient({ account: this.account, chain, transport: http(client.transport.url) });
    this.vault = vault;
    this.root = root;
    this.dataDir = dataDir;
    this.log = (msg) => log(`[keeper] ${msg}`);
    this.last = null;
  }

  async payIfDue() {
    const read = (functionName) => this.client.readContract({ address: this.vault, abi: vaultAbi, functionName });
    const [[amount], rate, paidThrough] = await Promise.all([read('computeDue'), read('ratePerSecond'), read('paidThrough')]);
    // Pay once a day's worth is due, or right away if the app is about to stop being paid for.
    const urgent = Number(paidThrough) * 1000 < Date.now() + HOUR;
    if (amount === 0n || (amount < rate * 86_400n && !urgent)) return null;
    const hash = await this.wallet.writeContract({ address: this.vault, abi: vaultAbi, functionName: 'payCompute' });
    await this.client.waitForTransactionReceipt({ hash });
    this.log(`paid itself ${formatUsdc(amount)} USDC for compute (tx ${hash})`);
    return { amount, hash };
  }

  async renewIfNeeded() {
    const secretFile = join(this.dataDir, 'compute.secret.json');
    const publicFile = join(this.dataDir, 'compute.json');
    if (!existsSync(secretFile)) return null; // not a rented server (or rented by hand)
    const secret = JSON.parse(readFileSync(secretFile, 'utf8'));
    const record = existsSync(publicFile) ? JSON.parse(readFileSync(publicFile, 'utf8')) : {};
    const until = record.paidUntil ? Date.parse(record.paidUntil) : secret.expires_at;
    if (!until || until - Date.now() > RENEW_BEFORE_MS) return null;

    const provider = JSON.parse(readFileSync(join(this.root, 'infra/providers.json'), 'utf8')).providers[secret.provider];
    const url = provider.renew.url.replace('{rental_id}', secret.rental_id).replace('{root_token}', encodeURIComponent(secret.root_token));
    const first = await fetch(url, { method: provider.renew.method });
    if (first.status !== 402) throw new Error(`renew: expected a 402 quote, got ${first.status}`);
    const quote = await readQuote(first);
    const option = chooseOption(quote, [8453, 84532]);
    const have = await this.client.readContract({ address: option.asset, abi: erc20, functionName: 'balanceOf', args: [this.account.address] });
    if (have < option.amount) {
      this.log(`cannot renew: has ${formatUsdc(have)} USDC, needs ${formatUsdc(option.amount)}. The app dies on ${new Date(until).toISOString()} unless its vault is fed.`);
      return null;
    }
    const header = await signPayment({ account: this.account, quote, option });
    const paid = await fetch(url, { method: provider.renew.method, headers: { [header.name]: header.value } });
    if (!paid.ok) throw new Error(`renew refused: HTTP ${paid.status} ${await paid.text()}`);
    const body = await paid.json().catch(() => ({}));
    if (body.expires_at) record.paidUntil = new Date(body.expires_at).toISOString();
    writeFileSync(publicFile, JSON.stringify(record, null, 2));
    this.log(`renewed the server for ${formatUsdc(option.amount)} USDC${body.expires_at ? `, now alive until ${record.paidUntil}` : ' (expiry updates once it settles)'}`);
    return body;
  }

  /** Posts people's free check-ins onchain in one batch; the contract verifies and counts them. */
  async relayCheckIns() {
    if (!this.launchpad) return null;
    const today = Number(await this.client.readContract({ address: this.vault, abi: vaultAbi, functionName: 'today' }));
    const rows = this.launchpad.pendingCheckIns(this.vault, today - 1);
    if (!rows.length) return null;
    const hash = await this.wallet.writeContract({
      address: this.vault, abi: vaultAbi, functionName: 'checkInFor',
      args: [rows.map((r) => r.person), rows.map((r) => BigInt(r.day)), rows.map((r) => r.signature)],
    });
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    this.launchpad.markSubmitted(rows);
    this.log(`posted ${rows.length} check-ins onchain (tx ${hash}, gas ${receipt.gasUsed})`);
    return { count: rows.length, hash };
  }

  async tick() {
    const result = { at: new Date().toISOString() };
    try { result.paid = await this.payIfDue(); } catch (err) { result.payError = err.shortMessage ?? err.message; }
    try { result.renewed = await this.renewIfNeeded(); } catch (err) { result.renewError = err.message; }
    if (result.payError) this.log(`pay: ${result.payError}`);
    if (result.renewError) this.log(`renew: ${result.renewError}`);
    this.last = result;
    return result;
  }

  start(intervalMs = HOUR, checkInMs = 5 * 60_000) {
    const loop = async () => { await this.tick(); this.timer = setTimeout(loop, intervalMs); };
    loop();
    const relay = async () => {
      try { await this.relayCheckIns(); } catch (err) { this.log(`check-ins: ${err.shortMessage ?? err.message}`); }
      this.relayTimer = setTimeout(relay, checkInMs);
    };
    relay();
    this.log(`running as ${this.account.address} for vault ${this.vault}`);
  }

  status() {
    return { address: this.account.address, vault: this.vault, last: this.last };
  }
}
