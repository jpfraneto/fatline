// fatline identity [--network farcaster]
// fatline identity show
// fatline identity revoke
//
// Gives this client its own app key for your Farcaster account, with no transaction and no gas:
//   a QR code (or its link) opens the Farcaster app; you approve there; the app adds the key (siwf.mjs).
// The key can only cast, react, follow and edit your profile; it can never add or remove keys.
// Never a recovery phrase: asking people to type or move theirs is a trap. The other way in is the client's Cast
// button with a wallet that already holds the account (login.mjs), one EIP-712 signature (buildKeyAdd below).
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import {
  FarcasterNetwork, MessageType, NobleEd25519Signer, ViemLocalEip712Signer,
  getFarcasterTime, makeKeyAdd, makeKeyAddBody, makeKeyRemove, makeKeyRemoveBodySelfRevoke,
} from '@farcaster/core';
import { loadConfig } from './config.mjs';
import { Network } from './hub.mjs';
import { appKeyPath, loadAppKey, saveAppKey, sendMessage } from './writer.mjs';

export const SCOPES = [
  MessageType.CAST_ADD, MessageType.CAST_REMOVE,
  MessageType.REACTION_ADD, MessageType.REACTION_REMOVE,
  MessageType.LINK_ADD, MessageType.LINK_REMOVE,
  MessageType.USER_DATA_ADD,
];
const TTL_SECONDS = 90 * 24 * 60 * 60; // the maximum; it slides forward every time the key is used
const hex = (b) => `0x${Buffer.from(b).toString('hex')}`;

function args() {
  const a = process.argv.slice(2);
  const get = (n) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  return { command: a[0] && !a[0].startsWith('--') ? a[0] : 'add', fid: get('fid'), network: get('network'), seedFile: get('seed-file'), dryRun: a.includes('--dry-run'), phrase: a.includes('--phrase') };
}

async function get(node, path, params, timeoutMs = 15_000) {
  const url = new URL(node.url + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new Error(`${node.url} did not answer ${url.pathname} within ${Math.round(timeoutMs / 1000)} seconds.`);
    throw new Error(`${node.url} is not reachable (${err.cause?.code ?? err.message}).`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url.pathname} -> HTTP ${res.status}`);
  return res.json();
}

/** The address that owns this FID now (its last register or transfer), according to the node. One fast query. */
export async function custodyOfFid(node, fid) {
  const res = await get(node, '/v1/onChainEventsByFid', { fid, event_type: 'EVENT_TYPE_ID_REGISTER' });
  const moves = (res?.events ?? []).filter((e) => /^(register|transfer)$/i.test(e.idRegisterEventBody?.eventType ?? ''))
    .sort((a, b) => (a.blockNumber - b.blockNumber) || (a.logIndex - b.logIndex));
  return moves.at(-1)?.idRegisterEventBody?.to?.toLowerCase() ?? null;
}

/**
 * The FID whose current owner is this address, according to the node. With `fid` (the one the person claims), it
 * first asks who owns that FID, which is fast; the lookup by address can take 20-30 seconds on a node when the
 * address owns nothing, so it is only the fallback, with a long wait.
 */
export async function fidOfCustody(node, address, fid) {
  if (fid) {
    const owner = await custodyOfFid(node, fid).catch(() => null);
    if (owner === address.toLowerCase()) return Number(fid);
  }
  const event = await get(node, '/v1/onChainIdRegistryEventByAddress', { address: address.toLowerCase() }, 60_000);
  if (!event?.fid) return null;
  const owner = event.idRegisterEventBody?.to?.toLowerCase();
  return owner === address.toLowerCase() ? Number(event.fid) : null;
}

/** The FID fatline connect proved and saved (.fatline/identity.json), if any. */
export function savedFid(config) {
  try { return Number(JSON.parse(fs.readFileSync(`${config.dataDir}/identity.json`, 'utf8')).fid) || undefined; } catch { return undefined; }
}

export async function waitForKey(node, fid, key, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await get(node, '/v1/signersByFid', { fid }).catch(() => null);
    if (res?.signers?.some((s) => s.key?.toLowerCase() === key.toLowerCase())) return true;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

/**
 * A new app key for `fid`, authorized by its custody account: a local account (from a seed phrase) or a wallet
 * (WalletConnect), anything with { address, signTypedData }. One EIP-712 signature, no transaction, no gas.
 */
export async function buildKeyAdd({ node, fid, custody, networkName, appSigner = null }) {
  const signers = await get(node, '/v1/signersByFid', { fid });
  const nonce = Number(signers?.currentUserNonce ?? 0) + 1;
  // appSigner: a key kept somewhere else (a visitor's browser, visitor.mjs): this machine never sees it.
  const privateKey = appSigner ? null : randomBytes(32);
  appSigner ??= new NobleEd25519Signer(privateKey);
  const key = (await appSigner.getSignerKey())._unsafeUnwrap();
  const now = getFarcasterTime()._unsafeUnwrap();
  const local = { address: custody.address, type: 'local', signTypedData: (args) => custody.signTypedData(args) };
  const body = await makeKeyAddBody(
    { fid: BigInt(fid), key, scopes: SCOPES, ttl: TTL_SECONDS, nonce, deadline: now + 60 * 60 },
    new ViemLocalEip712Signer(local),
  );
  if (body.isErr()) throw new Error(`Could not build the key authorization: ${body.error.message}`);
  const message = (await makeKeyAdd(body.value, { fid, network: FarcasterNetwork.MAINNET }, appSigner))._unsafeUnwrap();
  const record = {
    fid, publicKey: hex(key), ...(privateKey ? { privateKey: hex(privateKey) } : {}), scopes: SCOPES.map((s) => MessageType[s]),
    network: networkName, node: node.url, nonce, addedAt: new Date().toISOString(), state: 'submitted',
  };
  return { message, record };
}

async function add(opts, config) {
  const networkName = opts.network ?? config.defaultNetwork;
  const network = new Network(networkName, config.networks[networkName]);
  const node = await network.node();
  console.log(`\nNetwork: ${network.label}. Node: ${node.url}${node.own ? ' (yours)' : ' (not yours, labeled in the app)'}`);
  const existing = loadAppKey(config.dataDir);
  if (existing && !opts.dryRun) {
    console.log(`This client already has an app key for FID ${existing.fid} (${existing.publicKey.slice(0, 10)}…).`);
    console.log('To replace it, run fatline identity revoke first.');
    return;
  }

  // Never a seed phrase: asking people to type or move theirs is a trap. The Farcaster app (a QR code), or the
  // Cast button in the client with the wallet that already holds the account.
  if (opts.seedFile || opts.phrase) {
    console.log('\nFatline never asks for a recovery phrase. Scan the QR code below with the Farcaster app, or press Cast in your client.');
  }
  {
    const { startSignIn } = await import('./siwf.mjs');
    const s = await startSignIn(config);
    const { showQr } = await import('./qr.mjs');
    const { openWalletPage } = await import('../../infra/wallet-page.mjs');
    const page = await openWalletPage({ uri: s.url, title: 'Sign in with Farcaster', detail: 'Scan with your phone\'s camera: it opens the Farcaster app. Approve, and this client gets its own key: it can cast, like and follow, never move your account. The Farcaster app pays; no recovery phrase, no other wallet.' }).catch(() => null);
    console.log(`\nSign in with Farcaster: scan this with your phone (it opens the Farcaster app)${page ? `, or use the page in your browser (${page.url})` : ''}:\n`);
    await showQr(s.url);
    const token = /[?&]token=([^&]+)/.exec(s.url)?.[1];
    console.log(`\n  Or open this link on your phone: ${token ? `https://client.warpcast.com/deeplinks/signed-key-request?token=${token}` : s.url}`);
    console.log('  (An app key is a second key for YOUR account, not a new account: it can cast, like and follow, never move the account.)');
    console.log('  If the Farcaster app says "unavailable", that is their service: try again in a minute, or press Cast in your client and use a browser wallet.');
    console.log('  Waiting for your approval in the Farcaster app…');
    const record = await s.wait({ onState: (st) => page?.status(st === 'approved' ? 'Approved. Adding the key onchain…' : 'Waiting for your approval in the Farcaster app…') });
    page?.status(`Done: this client can post as FID ${record.fid}.`, true); page?.close();
    console.log(`\nDone. This client can now post as FID ${record.fid}. The key is in ${appKeyPath(config.dataDir)} (mode 600).`);
    return;
  }

}

async function show(opts, config) {
  const key = loadAppKey(config.dataDir);
  if (!key) return console.log('This client has no app key yet. Run: fatline identity');
  const network = new Network(key.network, config.networks[key.network]);
  const node = await network.node();
  const res = await get(node, '/v1/signersByFid', { fid: key.fid });
  const found = res?.signers?.find((s) => s.key?.toLowerCase() === key.publicKey.toLowerCase());
  console.log(`FID ${key.fid}, app key ${key.publicKey}`);
  console.log(`Scopes: ${key.scopes.join(', ')}`);
  console.log(found ? `Active on ${node.url} (${found.source ?? 'registered'})` : `Not visible on ${node.url} (pending, expired or revoked)`);
}

/** Removes the key using the key itself (no seed phrase needed), then deletes it from this machine. */
async function revoke(opts, config) {
  const key = loadAppKey(config.dataDir);
  if (!key) return console.log('No app key on this machine.');
  const network = new Network(key.network, config.networks[key.network]);
  const node = await network.node();
  const signer = new NobleEd25519Signer(Buffer.from(key.privateKey.slice(2), 'hex'));
  // Self-revocation uses the app nonce of the FID that requested the key (here, the account itself).
  const signers = await get(node, '/v1/signersByFid', { fid: key.fid, requesterFids: key.fid });
  const appNonce = Number(signers?.requesterFidNonces?.[String(key.fid)] ?? 0) + 1;
  const body = makeKeyRemoveBodySelfRevoke({
    key: Buffer.from(key.publicKey.slice(2), 'hex'), nonce: appNonce,
    deadline: getFarcasterTime()._unsafeUnwrap() + 60 * 60,
  });
  if (body.isErr()) throw new Error(`Could not build the revocation: ${body.error.message}`);
  const message = (await makeKeyRemove(body.value, { fid: key.fid, network: FarcasterNetwork.MAINNET }, signer))._unsafeUnwrap();
  await sendMessage(node, message);
  const { rmSync } = await import('node:fs');
  rmSync(appKeyPath(config.dataDir));
  console.log(`Revoked app key ${key.publicKey.slice(0, 12)}… for FID ${key.fid} and deleted it from this machine.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = args();
  const config = loadConfig();
  const commands = { add, show, revoke };
  if (!commands[opts.command]) {
    console.error('Usage: fatline identity | identity show | identity revoke');
    process.exit(1);
  }
  commands[opts.command](opts, config).catch((err) => { console.error(`\n${err.message}`); process.exit(1); });
}
