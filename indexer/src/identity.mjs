// fatline identity [--fid 18350] [--network farcaster] [--dry-run]
// fatline identity show
// fatline identity revoke
//
// Gives this client its own app key for your Farcaster account, with no transaction and no gas:
//   1. You type your seed phrase into a hidden prompt. It is used once, here, and never saved or logged.
//   2. It derives your custody address (the account's owner) and checks it owns the FID.
//   3. It creates a new Ed25519 app key and signs a KEY_ADD with the custody key (EIP-712).
//      The key can only cast, react, follow and edit your profile; it can never add or remove keys.
//   4. It submits the KEY_ADD to your node and waits until the node shows the key.
// After that, the client signs with the app key. The seed phrase is not needed again.
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import {
  FarcasterNetwork, MessageType, NobleEd25519Signer, ViemLocalEip712Signer,
  getFarcasterTime, makeKeyAdd, makeKeyAddBody, makeKeyRemove, makeKeyRemoveBodySelfRevoke,
} from '@farcaster/core';
import { mnemonicToAccount } from 'viem/accounts';
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
  return { command: a[0] && !a[0].startsWith('--') ? a[0] : 'add', fid: get('fid'), network: get('network'), seedFile: get('seed-file'), dryRun: a.includes('--dry-run') };
}

function askHidden(question) {
  return new Promise((done) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); done(answer); });
  });
}

async function get(node, path, params) {
  const url = new URL(node.url + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url.pathname} -> HTTP ${res.status}`);
  return res.json();
}

/** The FID whose current owner is this address, according to the node. */
export async function fidOfCustody(node, address) {
  const event = await get(node, '/v1/onChainIdRegistryEventByAddress', { address: address.toLowerCase() });
  if (!event?.fid) return null;
  const owner = event.idRegisterEventBody?.to?.toLowerCase();
  return owner === address.toLowerCase() ? Number(event.fid) : null;
}

async function username(node, fid) {
  const res = await get(node, '/v1/userDataByFid', { fid, user_data_type: 6 }).catch(() => null);
  return res?.data?.userDataBody?.value ?? null;
}

async function waitForKey(node, fid, key, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await get(node, '/v1/signersByFid', { fid }).catch(() => null);
    if (res?.signers?.some((s) => s.key?.toLowerCase() === key.toLowerCase())) return true;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
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

  let phrase;
  if (opts.seedFile) {
    // A private file the owner filled in. Lines starting with # are ignored. It is read, never printed or copied.
    const file = opts.seedFile.replace(/^~(?=\/)/, os.homedir());
    if ((fs.statSync(file).mode & 0o077) !== 0) throw new Error(`${file} can be read by other users. Run: chmod 600 ${file}. Nothing was sent.`);
    phrase = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join(' ');
    if (!phrase.trim()) throw new Error(`${file} has no seed phrase in it yet. Nothing was sent.`);
    console.log(`\nReading the seed phrase from ${file} (not printed, not saved anywhere else).`);
  } else {
    console.log('\nType your seed phrase (12 or 24 words). It is hidden, used once on this machine, and never saved.');
    phrase = await askHidden('Seed phrase: ');
  }
  let custody;
  try {
    custody = mnemonicToAccount(phrase.trim().toLowerCase().split(/\s+/).join(' '));
  } catch {
    throw new Error('That is not a valid seed phrase. Nothing was sent.');
  } finally {
    phrase = null;
  }
  console.log(`Custody address (derivation m/44'/60'/0'/0/0): ${custody.address}`);

  const fid = await fidOfCustody(node, custody.address);
  if (!fid) throw new Error(`${custody.address} does not own a Farcaster account on this network. Check the phrase. Nothing was sent.`);
  if (opts.fid && Number(opts.fid) !== fid) throw new Error(`This phrase owns FID ${fid}, not ${opts.fid}. Nothing was sent.`);
  console.log(`It owns FID ${fid}${(await username(node, fid)) ? ` (@${await username(node, fid)})` : ''}.`);

  const signers = await get(node, '/v1/signersByFid', { fid });
  const nonce = Number(signers?.currentUserNonce ?? 0) + 1;

  const privateKey = randomBytes(32);
  const appSigner = new NobleEd25519Signer(privateKey);
  const key = (await appSigner.getSignerKey())._unsafeUnwrap();
  const now = getFarcasterTime()._unsafeUnwrap();

  const body = await makeKeyAddBody(
    { fid: BigInt(fid), key, scopes: SCOPES, ttl: TTL_SECONDS, nonce, deadline: now + 60 * 60 },
    new ViemLocalEip712Signer(custody),
  );
  custody = null; // the custody key is not needed past this point
  if (body.isErr()) throw new Error(`Could not build the key authorization: ${body.error.message}`);
  const message = (await makeKeyAdd(body.value, { fid, network: FarcasterNetwork.MAINNET }, appSigner))._unsafeUnwrap();

  const record = {
    fid, publicKey: hex(key), privateKey: hex(privateKey), scopes: SCOPES.map((s) => MessageType[s]),
    network: networkName, node: node.url, nonce, addedAt: new Date().toISOString(), state: 'submitted',
  };

  if (opts.dryRun) {
    const check = await sendMessage(node, message, '/v1/validateMessage');
    console.log(`Dry run: the node says this KEY_ADD is ${check.valid ? 'well-formed' : 'NOT valid'}. Nothing was submitted or saved.`);
    return;
  }

  // Save before submitting, so the key is never registered without this machine holding it.
  saveAppKey(config.dataDir, record);
  await sendMessage(node, message);
  console.log(`Submitted the app key ${record.publicKey.slice(0, 12)}… Waiting for the node to show it…`);
  if (await waitForKey(node, fid, record.publicKey)) {
    saveAppKey(config.dataDir, { ...record, state: 'active', confirmedAt: new Date().toISOString() });
    console.log(`\nDone. This client can now post as FID ${fid}. The app key is in ${appKeyPath(config.dataDir)} (mode 600).`);
    console.log('It expires after 90 days without use. To remove it: fatline identity revoke');
  } else {
    console.log('\nThe node accepted it but does not show it yet. Check again with: fatline identity show');
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
    console.error('Usage: fatline identity [--fid N] [--dry-run] | identity show | identity revoke');
    process.exit(1);
  }
  commands[opts.command](opts, config).catch((err) => { console.error(`\n${err.message}`); process.exit(1); });
}
