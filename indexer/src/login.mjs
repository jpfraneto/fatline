// Log in to this client from the Cast button. Two ways, both give this client its own app key (it can cast, like
// and follow, never move the account), and the key never leaves this machine:
//   - The Farcaster app: a QR code (or the same link, to open on this device). The app shows what you approve
//     and adds the key itself.
//   - A browser wallet that owns the account (its custody address, e.g. MetaMask holding your Farcaster recovery
//     phrase): one EIP-712 signature (a gasless KEY_ADD), no transaction, submitted to your node. No relay, no app.
import { rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { qrSvg } from './qr.mjs';
import { buildKeyAdd, fidOfCustody, savedFid, waitForKey } from './identity.mjs';
import { appKeyPath, loadAppKey, saveAppKey, sendMessage } from './writer.mjs';

/** viem's typed-data arguments as JSON a wallet takes (eth_signTypedData_v4): numbers as strings, bytes as hex. */
export function typedDataJson({ domain, types, primaryType, message }) {
  const plain = (v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? `0x${Buffer.from(v).toString('hex')}` : Array.isArray(v) ? v.map(plain) : v);
  const fields = { name: 'string', version: 'string', chainId: 'uint256', verifyingContract: 'address', salt: 'bytes32' };
  const EIP712Domain = Object.keys(fields).filter((k) => domain[k] !== undefined).map((name) => ({ name, type: fields[name] }));
  return {
    domain: Object.fromEntries(Object.entries(domain).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])),
    types: { EIP712Domain, ...types }, primaryType,
    message: Object.fromEntries(Object.entries(message).map(([k, v]) => [k, plain(v)])),
  };
}

export class WalletLogin {
  /** owner: the FID this Fatline belongs to (on a server). Only that account's key is kept; null = any (this machine). */
  constructor({ config, networks, root, owner = null }) {
    this.config = config;
    this.networks = networks;
    this.root = root;
    this.owner = owner ? Number(owner) : null;
    this.state = { step: 'idle' };
    this.session = null; // the newest sign-in; only the browser that started it can follow it
    this.gen = 0;
  }

  status() { return this.state; }

  /** Throws unless this FID may hold this client's key. */
  check(fid) {
    if (this.owner && Number(fid) !== this.owner) throw Object.assign(new Error(`That is FID ${fid}. This Fatline belongs to FID ${this.owner}.`), { status: 403 });
  }

  begin(state) {
    this.walletWait?.reject(new Error('Replaced by a new sign-in.'));
    this.walletWait = null;
    this.session = randomBytes(16).toString('hex');
    this.state = state;
    return ++this.gen;
  }

  /** Starts a Farcaster-app sign-in. The page shows state.qr (or opens state.uri) and polls status(). */
  async start() {
    const gen = this.begin({ step: 'starting', farcaster: true });
    const set = (st) => { if (gen === this.gen) this.state = st; };
    let uriSeen;
    const gotUri = new Promise((r) => (uriSeen = r));
    (async () => {
      const { startSignIn } = await import('./siwf.mjs');
      const s = await startSignIn(this.config);
      // farcaster:// opens the app on this device; the https link redirects into the app (or its store page).
      const token = /[?&]token=([^&]+)/.exec(s.url)?.[1];
      const web = token ? `https://client.warpcast.com/deeplinks/signed-key-request?token=${token}` : s.url;
      set({ step: 'waiting', uri: s.url, web, qr: qrSvg(s.url), farcaster: true });
      uriSeen();
      const record = await s.wait({ accept: (fid) => this.check(fid), onState: (st) => { if (st === 'approved') set({ step: 'submitting', farcaster: true }); } });
      set({ step: 'done', fid: record.fid });
    })().catch((err) => { set({ step: 'error', error: friendly(err) }); uriSeen(); });
    await gotUri;
    return { ...this.state, session: this.session };
  }

  /**
   * A browser wallet: the page sends the wallet's address; this finds the FID it owns and returns the KEY_ADD to
   * sign. Then walletSign() gets the signature and the key goes to the node.
   */
  async walletStart({ address } = {}) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(address ?? ''))) throw Object.assign(new Error('That is not a wallet address.'), { status: 400 });
    const networkName = this.config.defaultNetwork;
    const node = await this.networks[networkName].node();
    this.begin({ step: 'finding', wallet: true });
    const fid = await fidOfCustody(node, address, this.owner ?? savedFid(this.config)); // fast when the FID is known
    if (!fid) {
      this.state = { step: 'idle' };
      throw Object.assign(new Error('This wallet does not own a Farcaster account. Use the wallet that owns it, or the Farcaster app.'), { status: 400 });
    }
    try { this.check(fid); } catch (err) { this.state = { step: 'idle' }; throw err; }
    // The library asks the custody wallet for two signatures: the key request (who asks for the key: the account
    // itself) and the KEY_ADD. Each one waits here until the page sends it (walletSign).
    let asked = 0;
    let nextTyped;
    const custody = {
      address,
      signTypedData: (args) => new Promise((resolve, reject) => {
        this.walletWait = { resolve, reject };
        this.state = { step: 'signing', wallet: true, fid, address, n: ++asked, of: 2, node: node.label ?? node.url, typedData: typedDataJson(args) };
        nextTyped?.();
      }),
    };
    const changed = () => new Promise((r) => { nextTyped = r; });
    const first = changed();
    const built = buildKeyAdd({ node, fid, custody, networkName });
    this.walletDone = built.then(async ({ message, record }) => {
      this.state = { step: 'submitting', wallet: true };
      saveAppKey(this.config.dataDir, record); // before submitting, so the key is never registered without this machine holding it
      await sendMessage(node, message);
      if (!(await waitForKey(node, fid, record.publicKey))) throw new Error(`${node.label ?? node.url} took the key but does not show it yet. Check in a minute with: fatline identity show`);
      saveAppKey(this.config.dataDir, { ...record, state: 'active', via: 'browser wallet', confirmedAt: new Date().toISOString() });
      this.state = { step: 'done', fid };
    }).catch((err) => {
      const key = loadAppKey(this.config.dataDir);
      if (key?.state === 'submitted') rmSync(appKeyPath(this.config.dataDir), { force: true });
      this.state = { step: 'error', error: friendly(err) };
    }).finally(() => nextTyped?.());
    this.walletNext = changed;
    await first;
    return { ...this.state, session: this.session };
  }

  /** The page's signature for the request it was shown. Returns the next request to sign, or where it stands. */
  async walletSign({ signature } = {}) {
    if (!this.walletWait) throw Object.assign(new Error('No signature was asked for. Start again.'), { status: 409 });
    const wait = this.walletWait;
    this.walletWait = null;
    if (!/^0x[0-9a-fA-F]{130}$/.test(String(signature ?? ''))) {
      wait.reject(new Error('The wallet did not sign. Nothing was added.'));
      throw Object.assign(new Error('The wallet did not return a signature.'), { status: 400 });
    }
    const next = this.walletNext();
    wait.resolve(signature);
    // Either the library asks for the next signature, or it is past signing (submitting, done or error).
    await Promise.race([next, new Promise((r) => setTimeout(r, 2_000))]);
    if (this.state.step === 'signing' && this.state.typedData && !this.walletWait) this.state = { step: 'submitting', wallet: true };
    return this.state;
  }
}

function friendly(err) {
  const m = String(err?.message ?? err);
  if (/timeout|aborted/i.test(m)) return `Farcaster did not answer in time (${m.slice(0, 120)}). It happens: try again in a minute.`;
  return m.slice(0, 300);
}
