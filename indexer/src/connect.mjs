// ./fatline connect [--network farcaster|hypersnap] [--open]
// ./fatline connect show
// ./fatline connect forget
//
// You are your FID. This proves which Farcaster account you are, with your phone, and no seed phrase:
//   1. It opens a Sign In with Farcaster request for fatline.ink and shows it as a QR code (the arch in the middle).
//   2. You scan it with your phone's camera. The Farcaster app asks you to sign in; that signs a short
//      message (EIP-4361) with your account's custody address, the address that owns your FID.
//   3. Here, on your machine, it checks the signature, that the message is the one it asked for (domain,
//      nonce, expiry), and recovers the address that signed it.
//   4. The handshake: it asks your node which FID that address owns. Only if your node agrees is it saved.
// The relay (relay.farcaster.xyz, Farcaster's) only carries the request and the signed message between your
// phone and this machine; it decides nothing. The proof is saved in .fatline/identity.json: public data, no keys.
// Posting as yourself still needs an app key: ./fatline identity.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { recoverMessageAddress } from 'viem';
import { parseSiweMessage } from 'viem/siwe';
import { loadConfig } from './config.mjs';
import { Network } from './hub.mjs';
import { fidOfCustody } from './identity.mjs';
import { showQr } from './qr.mjs';

export const RELAY = 'https://relay.farcaster.xyz';
export const DOMAIN = 'fatline.ink';
const URI = 'https://fatline.ink';
const WAIT_MS = 5 * 60_000;

const identityPath = (config) => join(config.dataDir, 'identity.json');
export const loadIdentity = (config) => (existsSync(identityPath(config)) ? JSON.parse(readFileSync(identityPath(config), 'utf8')) : null);

/**
 * Checks a completed sign-in on this machine: the message is ours and unexpired, the signature recovers to the
 * address in it, and the node says that address owns the FID. Returns the identity, or throws saying why not.
 */
export async function verify({ message, signature, fid, nonce, node, now = new Date(), fidOf = fidOfCustody }) {
  const m = parseSiweMessage(message);
  if (m.domain !== DOMAIN) throw new Error(`The message is for ${m.domain}, not ${DOMAIN}.`);
  if (m.nonce !== nonce) throw new Error('The message answers a different request (nonce). Run connect again.');
  if (m.expirationTime && m.expirationTime < now) throw new Error('The sign-in expired. Run connect again.');
  if (m.notBefore && m.notBefore > now) throw new Error('The sign-in is not valid yet.');
  const claimed = (m.resources ?? []).map((r) => /^farcaster:\/\/fid\/(\d+)$/.exec(r)?.[1]).find(Boolean);
  if (!claimed || Number(claimed) !== Number(fid)) throw new Error('The message does not name the FID it claims.');
  const signer = await recoverMessageAddress({ message, signature });
  if (signer.toLowerCase() !== m.address.toLowerCase()) throw new Error('The signature was not made by the address in the message.');
  const owned = await fidOf(node, signer);
  if (owned !== Number(fid)) {
    throw new Error(`Your node (${node.url}) says ${signer} ${owned ? `owns FID ${owned}` : 'owns no FID'}, not ${fid}. Nothing was saved.`);
  }
  return { fid: Number(fid), custody: signer };
}

async function relay(path, { body, token } = {}) {
  const res = await fetch(RELAY + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`The Farcaster relay answered HTTP ${res.status} on ${path}.`);
  return res.json();
}

function openInBrowser(url) {
  const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawnSync(cmd[0], cmd[1], { stdio: 'ignore' });
}

async function connect(opts, config) {
  const networkName = opts.network ?? config.defaultNetwork;
  const network = new Network(networkName, config.networks[networkName]);
  const node = await network.node();
  const nonce = randomBytes(12).toString('hex');
  const channel = await relay('/v1/channel', { body: { siweUri: URI, domain: DOMAIN, nonce, acceptAuthAddress: false } });

  const tty = process.stdout.isTTY;
  console.log(`\n  \x1b[1mYou are your FID.\x1b[0m Scan this with your phone's camera and sign in with the Farcaster app.\n`);
  if (tty) await showQr(channel.url);
  console.log(`\n  On this device instead: ${channel.url}`);
  console.log(`  \x1b[2mRelay: ${RELAY} (Farcaster's; it carries the request, it decides nothing). Checked by: ${node.url}${node.own ? ' (your node)' : ` (${node.label ?? 'not yours'})`}\x1b[0m\n`);
  if (opts.open || !tty) openInBrowser(channel.url);

  const deadline = Date.now() + WAIT_MS;
  let s;
  for (;;) {
    s = await relay('/v1/channel/status', { token: channel.channelToken }).catch(() => null);
    if (s?.state === 'completed') break;
    if (Date.now() > deadline) throw new Error('No sign-in after 5 minutes. Run ./fatline connect again when you have your phone.');
    await new Promise((r) => setTimeout(r, 1500));
  }

  process.stdout.write('  Signed. Checking it here, and asking your node… ');
  const who = await verify({ message: s.message, signature: s.signature, fid: s.fid, nonce, node });
  console.log('yes.\n');
  const identity = {
    fid: who.fid, username: s.username ?? null, displayName: s.displayName ?? null, pfp: s.pfpUrl ?? null,
    custody: who.custody, network: networkName, node: node.url, verifiedAt: new Date().toISOString(),
    proof: { message: s.message, signature: s.signature },
  };
  writeFileSync(identityPath(config), JSON.stringify(identity, null, 2) + '\n');
  console.log(`  \x1b[1mFID ${identity.fid}${identity.username ? ` · @${identity.username}` : ''}\x1b[0m`);
  console.log(`  signed by its custody address ${identity.custody}`);
  console.log(`  confirmed by ${node.url}${node.own ? ', your own node' : ''}`);
  console.log(`  \x1b[2mSaved to .fatline/identity.json (public: the signed message, no keys). Forget it: ./fatline connect forget\x1b[0m\n`);
}

async function main() {
  const a = process.argv.slice(2);
  const get = (n) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  const config = loadConfig();
  if (a[0] === 'show') {
    const id = loadIdentity(config);
    console.log(id ? `FID ${id.fid}${id.username ? ` (@${id.username})` : ''}, custody ${id.custody}, confirmed by ${id.node} on ${id.verifiedAt.slice(0, 10)}.` : 'Not connected. Run ./fatline connect');
    return;
  }
  if (a[0] === 'forget') { rmSync(identityPath(config), { force: true }); console.log('Forgotten. Nothing else was touched.'); return; }
  await connect({ network: get('network'), open: a.includes('--open') }, config);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`\n  ${err.message}`); process.exit(1); });
}
