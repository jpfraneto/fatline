// Log in to this client with your wallet, without the Farcaster app: scan a QR code with the wallet that owns your
// Farcaster account (its custody address), approve one signature, and this client gets its own app key, submitted
// to your own node. No relay, no Farcaster client in between, no transaction, no gas.
import { qrSvg } from './qr.mjs';
import { buildKeyAdd, fidOfCustody, waitForKey } from './identity.mjs';
import { loadAppKey, saveAppKey, sendMessage } from './writer.mjs';

export class WalletLogin {
  constructor({ config, networks, root }) {
    this.config = config;
    this.networks = networks;
    this.root = root;
    this.state = { step: 'idle' };
  }

  status() {
    const key = loadAppKey(this.config.dataDir);
    if (key) return { step: 'done', fid: key.fid };
    return this.state;
  }

  /** Starts a connection (or returns the one in progress). The page shows state.qr and polls status(). */
  async start() {
    if (loadAppKey(this.config.dataDir)) return this.status();
    if (['waiting', 'connected', 'signing', 'submitting'].includes(this.state.step)) return this.state;
    this.state = { step: 'starting' };
    let uriSeen;
    const gotUri = new Promise((r) => (uriSeen = r));
    const say = (t) => {
      const m = String(t).match(/(wc:\S+)/);
      if (m) { this.state = { step: 'waiting', uri: m[1], qr: qrSvg(m[1]) }; uriSeen(); }
    };
    this.run(say).catch((err) => { this.state = { step: 'error', error: String(err.message ?? err).slice(0, 300) }; uriSeen(); });
    await gotUri;
    return this.state;
  }

  async run(say) {
    const { phoneAccount } = await import('../../infra/payer.mjs');
    process.env.FATLINE_NO_BROWSER = '1'; // the client shows the QR itself
    const wallet = await phoneAccount({ root: this.root, say, page: { open: false } });
    try {
      this.state = { step: 'connected', address: wallet.address };
      const networkName = this.config.defaultNetwork;
      const network = this.networks[networkName];
      const node = await network.node();
      const fid = await fidOfCustody(node, wallet.address);
      if (!fid) throw new Error(`${wallet.address} doesn't own a Farcaster account. Connect the wallet that does (its custody address). For accounts made in the Farcaster app, that is the app's own wallet: its recovery phrase is in Settings → Advanced.`);
      this.state = { step: 'signing', address: wallet.address, fid };
      const { message, record } = await buildKeyAdd({ node, fid, custody: wallet, networkName });
      saveAppKey(this.config.dataDir, record); // before submitting, so the key is never registered without this machine holding it
      this.state = { step: 'submitting', address: wallet.address, fid };
      await sendMessage(node, message);
      const ok = await waitForKey(node, fid, record.publicKey);
      saveAppKey(this.config.dataDir, { ...record, state: ok ? 'active' : 'submitted', via: 'wallet', confirmedAt: new Date().toISOString() });
      this.state = { step: 'done', fid };
    } finally {
      await wallet.close?.();
    }
  }
}
