// Fatline's own Farcaster account (its app account): its name, its posting key, its profile, and its casts.
// Runs where the account's owner key lives (the genesis server: .fatline/attester.key). Never prints keys.
//
//   node src/app-account.mjs fname fatline            register the username (Farcaster's name server)
//   node src/app-account.mjs key                      give the account a posting key (.fatline/app-account.key.json)
//   node src/app-account.mjs profile display=Fatline bio="…" pfp=https://… url=https://fatline.ink username=fatline
//   node src/app-account.mjs cast "text" [url]        cast as Fatline
import { readFileSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { FarcasterNetwork, NobleEd25519Signer, UserDataType, ViemLocalEip712Signer, makeCastAdd, makeUserDataAdd, makeUserNameProofClaim, CastType } from '@farcaster/core';
import { privateKeyToAccount } from 'viem/accounts';
import { loadConfig } from './config.mjs';
import { buildKeyAdd, waitForKey } from './identity.mjs';
import { sendMessage } from './writer.mjs';

const config = loadConfig();
const FID = Number(process.env.FATLINE_APP_FID ?? config.deployments?.appAccount?.fid);
const NODE = { url: process.env.FATLINE_APP_NODE ?? 'http://127.0.0.1:3381' };
const KEYFILE = join(config.dataDir, 'app-account.key.json');
const custody = () => { const k = readFileSync(join(config.dataDir, 'attester.key'), 'utf8').trim(); return privateKeyToAccount(k.startsWith('0x') ? k : `0x${k}`); };
const appSigner = () => new NobleEd25519Signer(Buffer.from(JSON.parse(readFileSync(KEYFILE, 'utf8')).privateKey.slice(2), 'hex'));
const opts = { fid: FID, network: FarcasterNetwork.MAINNET };
const unwrap = (r, what) => { if (r.isErr()) throw new Error(`${what}: ${r.error.message}`); return r.value; };

async function fname(name) {
  const owner = custody();
  const timestamp = Math.floor(Date.now() / 1000);
  const claim = makeUserNameProofClaim({ name, owner: owner.address, timestamp });
  const sig = unwrap(await new ViemLocalEip712Signer(owner).signUserNameProofClaim(claim), 'sign');
  const res = await fetch('https://fnames.farcaster.xyz/transfers', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, from: 0, to: FID, fid: FID, owner: owner.address, timestamp, signature: `0x${Buffer.from(sig).toString('hex')}` }) });
  console.log(res.status, (await res.text()).slice(0, 300));
}

async function key() {
  if (existsSync(KEYFILE)) return console.log('This account already has a posting key here.');
  const { message, record } = await buildKeyAdd({ node: NODE, fid: FID, custody: custody(), networkName: 'farcaster' });
  writeFileSync(KEYFILE, JSON.stringify(record, null, 2)); chmodSync(KEYFILE, 0o600);
  await sendMessage(NODE, message);
  console.log('submitted; on the node:', await waitForKey(NODE, FID, record.publicKey));
}

async function profile(pairs) {
  const types = { pfp: UserDataType.PFP, display: UserDataType.DISPLAY, bio: UserDataType.BIO, url: UserDataType.URL, username: UserDataType.USERNAME };
  for (const p of pairs) {
    const i = p.indexOf('='); const k = p.slice(0, i), value = p.slice(i + 1);
    if (!types[k]) throw new Error(`unknown field ${k}`);
    const m = unwrap(await makeUserDataAdd({ type: types[k], value }, opts, appSigner()), k);
    await sendMessage(NODE, m).then(() => console.log(`${k}: set`), (e) => console.log(`${k}: ${e.message}`));
  }
}

async function cast(text, url) {
  const size = Buffer.byteLength(text);
  const m = unwrap(await makeCastAdd({ text, embeds: url ? [{ url }] : [], embedsDeprecated: [], mentions: [], mentionsPositions: [], type: size > 320 ? CastType.LONG_CAST : CastType.CAST }, opts, appSigner()), 'cast');
  await sendMessage(NODE, m);
  console.log(`cast 0x${Buffer.from(m.hash).toString('hex')}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (!FID) throw new Error('No app account (FATLINE_APP_FID).');
await ({ fname: () => fname(rest[0]), key, profile: () => profile(rest), cast: () => cast(rest[0], rest[1]) }[cmd] ?? (() => { throw new Error('fname | key | profile | cast'); }))();
