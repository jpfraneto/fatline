// Who signs an x402 payment. Never a pasted key or seed phrase. Three ways:
//
//   phone    your own wallet app (MetaMask, Rainbow, Coinbase Wallet, Trust, …): scan a QR code (WalletConnect),
//            approve the connection, then approve each payment on the phone. Needs a WalletConnect project ID
//            Fatline's own project ID is built in; WALLETCONNECT_PROJECT_ID or "walletConnectProjectId" in
//            fatline.config.json replaces it (free at dashboard.reown.com).
//   browser  a wallet extension in a browser on this computer (MetaMask, Rabby, Coinbase Wallet, …): a page opens on
//            localhost, you connect and approve each payment there. No third party at all.
//   here     a wallet made on this machine (fatline compute wallet, or a worker: fatline worker new). You send it
//            USDC; it signs by itself. Only its key is kept, in .fatline (mode 600).
//
// Each returns an "account" with { address, signTypedData, close }, which is all x402.mjs needs. Phone and browser
// accounts can also send a transaction from the person's wallet (sendTransaction), e.g. to launch a coin.
// What a wallet signs is checked here before it is sent: the signature must recover to the connected address.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAddress, verifyTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const BASE = 8453;
/** Fatline's WalletConnect (Reown) project ID. Public by design: it only identifies the app to the relay. */
export const FATLINE_PROJECT_ID = '5a5650980fe997fdbb17c6242c184713';

export function localWalletKey(state) {
  if (process.env.X402_PRIVATE_KEY) return { from: 'X402_PRIVATE_KEY', key: process.env.X402_PRIVATE_KEY };
  for (const [file, from] of [[join(state, 'worker.key'), 'your worker wallet'], [join(state, 'compute-wallet.key'), "this machine's wallet"]]) {
    if (existsSync(file)) return { from, key: readFileSync(file, 'utf8').trim() };
  }
  return null;
}

export function projectId(root) {
  if (process.env.WALLETCONNECT_PROJECT_ID) return process.env.WALLETCONNECT_PROJECT_ID;
  for (const f of ['fatline.config.json', 'fatline.config.example.json']) {
    try { const id = JSON.parse(readFileSync(join(root, f), 'utf8')).walletConnectProjectId; if (id) return id; } catch {}
  }
  return FATLINE_PROJECT_ID;
}

/** viem's typed-data arguments → the JSON a wallet's eth_signTypedData_v4 expects (with EIP712Domain, no bigints). */
export function typedDataJson({ domain, types, primaryType, message }) {
  const order = [['name', 'string'], ['version', 'string'], ['chainId', 'uint256'], ['verifyingContract', 'address'], ['salt', 'bytes32']];
  const EIP712Domain = order.filter(([k]) => domain[k] !== undefined).map(([name, type]) => ({ name, type }));
  return JSON.stringify({ types: { EIP712Domain, ...types }, domain, primaryType, message }, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/** Wraps a remote signer so every signature is verified against the connected address before it is used. */
export function checkedAccount(address, sign, close = async () => {}) {
  address = getAddress(address);
  return {
    address,
    close,
    async signTypedData(args) {
      const signature = await sign(args);
      const ok = await verifyTypedData({ address, ...args, signature }).catch(() => false);
      if (!ok) throw new Error('The wallet returned a signature that is not from the connected address. Smart-contract wallets that are not deployed yet cannot sign USDC transfers; use a regular wallet (MetaMask, Rainbow, Rabby, Trust).');
      return signature;
    },
  };
}

export function hereAccount(state) {
  const w = localWalletKey(state);
  if (!w) throw new Error('No wallet on this machine. Make one with fatline compute wallet (or fatline worker new) and send it USDC on Base.');
  const a = privateKeyToAccount(w.key.startsWith('0x') ? w.key : `0x${w.key}`);
  return { address: a.address, from: w.from, signTypedData: (x) => a.signTypedData(x), close: async () => {} };
}

/** Phone: WalletConnect v2. Shows a QR code, waits for the wallet to connect, then sends each payment to it. */
export async function phoneAccount({ root, say = console.log }) {
  const id = projectId(root);
  if (!id) throw new Error('Paying from a phone wallet needs a WalletConnect project ID (free at dashboard.reown.com): set WALLETCONNECT_PROJECT_ID or add "walletConnectProjectId" to fatline.config.json. Or pay with --pay browser.');
  const { SignClient } = await import('@walletconnect/sign-client');
  const { showQr } = await import('../indexer/src/qr.mjs');
  const client = await SignClient.init({
    projectId: id, logger: 'silent',
    metadata: { name: 'Fatline', description: 'Pay for your Farcaster node', url: 'https://fatline.ink', icons: ['https://fatline.ink/img/world/aster.jpg'] },
  });
  const { uri, approval } = await client.connect({
    optionalNamespaces: { eip155: { chains: [`eip155:${BASE}`], methods: ['eth_signTypedData_v4', 'eth_sendTransaction'], events: ['accountsChanged', 'chainChanged'] } },
  });
  say('\n  Scan this with your wallet app (or its WalletConnect scanner), then approve the connection:\n');
  await showQr(uri);
  say(`\n  Or paste this into a desktop wallet: ${uri}\n  Waiting for your wallet…`);
  const session = await approval();
  const account = session.namespaces.eip155?.accounts?.find((a) => a.startsWith(`eip155:${BASE}:`)) ?? session.namespaces.eip155?.accounts?.[0];
  if (!account) throw new Error('The wallet connected without an address on Base.');
  const address = account.split(':')[2];
  const peer = session.peer?.metadata?.name ?? 'your wallet';
  say(`  Connected: ${address} (${peer})`);
  const close = async () => { await client.disconnect({ topic: session.topic, reason: { code: 6000, message: 'done' } }).catch(() => {}); await client.core.relayer.transportClose().catch(() => {}); };
  return {
    ...checkedAccount(address, async (args) => {
      say(`  Approve the payment on your phone (${peer})…`);
      return client.request({ topic: session.topic, chainId: `eip155:${BASE}`, request: { method: 'eth_signTypedData_v4', params: [address, typedDataJson(args)] } });
    }, close),
    from: peer,
    /** Sends a transaction from the connected wallet, on Base. Returns its hash once the person approves. */
    async sendTransaction({ to, data, value = 0n }) {
      say(`  Approve the transaction on your phone (${peer})…`);
      return client.request({ topic: session.topic, chainId: `eip155:${BASE}`, request: { method: 'eth_sendTransaction', params: [{ from: address, to, data, value: `0x${BigInt(value).toString(16)}` }] } });
    },
  };
}

/** Browser: a page on localhost talks to the wallet extension; this process hands it each payment to sign. */
export async function browserAccount({ say = console.log, open = true } = {}) {
  let address = null, job = null, waitAddress, gotAddress = new Promise((r) => (waitAddress = r));
  const pending = new Map();
  const server = createServer(async (req, res) => {
    const body = await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
    const json = (code, x) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(x)); };
    if (req.url === '/' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
    if (req.method !== 'POST' || req.headers['x-fatline'] !== token) return json(403, { error: 'no' });
    const msg = JSON.parse(body || '{}');
    if (req.url === '/address') { address = getAddress(msg.address); waitAddress(address); return json(200, { ok: true }); }
    if (req.url === '/next') return json(200, job ? { id: job.id, typedData: job.typedData, tx: job.tx, label: job.label } : { wait: true });
    if (req.url === '/signed') {
      const p = pending.get(msg.id); if (!p) return json(404, {});
      pending.delete(msg.id); job = null;
      msg.error ? p.reject(new Error(`The wallet refused: ${msg.error}`)) : p.resolve(msg.signature);
      return json(200, { ok: true });
    }
    json(404, {});
  });
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/#${token}`;
  say(`\n  Open this in the browser that has your wallet extension, and connect:\n    ${url}`);
  if (open) { const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'; spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).on('error', () => {}).unref(); }
  say('  Waiting for your wallet…');
  await gotAddress;
  say(`  Connected: ${address}`);
  let n = 0;
  const close = async () => { server.close(); };
  return {
    ...checkedAccount(address, (args) => new Promise((resolve, reject) => {
      const id = ++n;
      pending.set(id, { resolve, reject });
      job = { id, typedData: typedDataJson(args), label: `${Number(args.message.value) / 1e6} USDC` };
      say('  Approve the payment in your browser wallet…');
    }), close),
    from: 'your browser wallet',
    /** Sends a transaction from the browser wallet, on Base. Returns its hash once the person approves. */
    sendTransaction: ({ to, data, value = 0n }) => new Promise((resolve, reject) => {
      const id = ++n;
      pending.set(id, { resolve, reject });
      job = { id, tx: { from: address, to, data, value: `0x${BigInt(value).toString(16)}` }, label: 'a transaction' };
      say('  Approve the transaction in your browser wallet…');
    }),
  };
}

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fatline · pay</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#17120d;color:#f1e4c8;font:17px/1.5 system-ui,sans-serif}main{max-width:30em;padding:24px}h1{font:700 30px Georgia,serif;margin:0 0 10px}button{font:600 16px system-ui;padding:12px 18px;border:0;border-radius:10px;background:#f1e4c8;color:#17120d;cursor:pointer}p{color:#c9b48d}#log{font:14px ui-monospace,monospace;white-space:pre-wrap;color:#f1e4c8}</style>
<main><h1>Fatline · your wallet</h1><p>Fatline asks your wallet to approve things on Base: USDC payments for your node (x402, no ETH needed), or a transaction like launching your coin. Each one shows in your wallet before you approve. Nothing moves until you do.</p>
<button id="go">Connect wallet</button><div id="log"></div></main>
<script>
const T = location.hash.slice(1), log = (t) => (document.getElementById('log').textContent += t + '\\n');
const post = (p, b) => fetch(p, { method: 'POST', headers: { 'x-fatline': T }, body: JSON.stringify(b) }).then((r) => r.json());
document.getElementById('go').onclick = async () => {
  const eth = window.ethereum;
  if (!eth) return log('No wallet extension found in this browser. Install one (MetaMask, Rabby, Coinbase Wallet) or pay from your phone instead.');
  try {
    const [address] = await eth.request({ method: 'eth_requestAccounts' });
    try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }); } catch (e) { log('Switch your wallet to Base, then try again.'); }
    await post('/address', { address });
    log('Connected ' + address + '. Go back to the terminal; payments will appear here.');
    document.getElementById('go').remove();
    for (;;) {
      const j = await post('/next', {});
      if (j.wait) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      log('Sign ' + j.label + '…');
      try { const signature = j.tx ? await eth.request({ method: 'eth_sendTransaction', params: [j.tx] }) : await eth.request({ method: 'eth_signTypedData_v4', params: [address, j.typedData] }); await post('/signed', { id: j.id, signature }); log(j.tx ? 'Sent.' : 'Signed.'); }
      catch (e) { await post('/signed', { id: j.id, error: e.message || String(e) }); log('Refused: ' + (e.message || e)); }
    }
  } catch (e) { log('Error: ' + (e.message || e)); }
};
</script>`;

/** Picks how to pay: --pay phone|browser|here, else asks. */
export async function choosePayer({ root, state, how, ask, say = console.log }) {
  const hasHere = Boolean(localWalletKey(state));
  if (!how) {
    if (!process.stdin.isTTY) how = hasHere ? 'here' : 'browser';
    else {
      say(`\n  How do you want to pay?
    1  your phone wallet: scan a QR code (WalletConnect)
    2  a wallet extension in a browser on this computer
    3  ${hasHere ? `the wallet on this machine (${localWalletKey(state).from})` : 'a wallet made here (fatline compute wallet first, then send it USDC)'}`);
      const a = await ask('  1, 2 or 3 (1): ');
      how = { '': 'phone', 1: 'phone', 2: 'browser', 3: 'here' }[a] ?? a;
    }
  }
  if (how === 'phone') return phoneAccount({ root, say });
  if (how === 'browser') return browserAccount({ say });
  if (how === 'here') return hereAccount(state);
  throw new Error(`Unknown way to pay "${how}". Use --pay phone, --pay browser or --pay here.`);
}
