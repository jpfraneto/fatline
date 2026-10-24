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
    const say = (t) => { if (/^link: /.test(String(t))) uriSeen(); }; // run() has put the QR in this.state
    this.run(say).catch((err) => { this.state = { step: 'error', error: String(err.message ?? err).slice(0, 300) }; uriSeen(); });
    await gotUri;
    return this.state;
  }

  async run(say) {
    // Sign in with Farcaster: the QR opens the Farcaster app; the app shows what is approved and adds the key.
    const { startSignIn } = await import('./siwf.mjs');
    const s = await startSignIn(this.config);
    say(`link: ${s.url}`);
    this.state = { step: 'waiting', uri: s.url, qr: qrSvg(s.url), farcaster: true };
    const record = await s.wait({ onState: (st) => { if (st === 'approved') this.state = { step: 'submitting' }; } });
    this.state = { step: 'done', fid: record.fid };
  }
}
