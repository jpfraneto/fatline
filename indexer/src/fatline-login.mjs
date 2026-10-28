// Log in with Fatline: any app proves which Farcaster account (FID) a visitor is, with one wallet signature.
// No seed phrase, no gas, no central server: every Fatline node answers POST /api/auth/verify.
//
//   1. The app (fatline.ink/login.js, or its own code) asks the visitor's wallet to sign a standard sign-in message
//      (EIP-4361, "Sign in with Ethereum") naming the FID: resources: farcaster://fid/<fid>.
//   2. A node checks the signature (smart wallets too, on Base) and that the address belongs to that FID, as the
//      Farcaster network itself records it: the FID's owner (custody) address, or an address the FID verified.
//   3. The answer says who it is. The app checks the domain and nonce are its own (or passes them, and the node does).
// The proof is public and replayable only for the app and time it names: anyone can re-check it against any node.
import { recoverMessageAddress } from 'viem';
import { parseSiweMessage } from 'viem/siwe';

const MAX_AGE_MS = 10 * 60_000; // a message without an expiry is good for ten minutes after it was issued
const MAX_LIFE_MS = 24 * 3600_000; // and none is good for more than a day

const fail = (msg, status = 401) => { throw Object.assign(new Error(msg), { status }); };

/** Which way `address` belongs to `fid` on this network: 'custody', 'verified', or null. */
export async function tieOf(network, fid, address) {
  const a = address.toLowerCase();
  const [events, verifs] = await Promise.all([
    network.get('/v1/onChainEventsByFid', { fid, event_type: 'EVENT_TYPE_ID_REGISTER' }).then((r) => r.data).catch(() => null),
    network.get('/v1/verificationsByFid', { fid }).then((r) => r.data).catch(() => null),
  ]);
  const moves = (events?.events ?? []).filter((e) => /^(register|transfer)$/i.test(e.idRegisterEventBody?.eventType ?? ''))
    .sort((x, y) => (x.blockNumber - y.blockNumber) || (x.logIndex - y.logIndex));
  if (moves.at(-1)?.idRegisterEventBody?.to?.toLowerCase() === a) return 'custody';
  const verified = (verifs?.messages ?? []).some((m) => String(m.data?.verificationAddAddressBody?.address ?? '').toLowerCase() === a);
  if (verified) return 'verified';
  if (!events && !verifs) fail('The node did not answer. Try again in a moment.', 503);
  return null;
}

/**
 * Checks a signed login. Returns { fid, address, how, domain, uri, nonce, issuedAt, expiresAt }.
 * domain / nonce, when given, must match (an app's server passes its own to make the node check them).
 */
export async function verifyLogin({ message, signature, domain, nonce, network, client, now = new Date(), tie = tieOf }) {
  if (typeof message !== 'string' || typeof signature !== 'string' || message.length > 4000) fail('Send { message, signature }.', 400);
  let m;
  try { m = parseSiweMessage(message); } catch { fail('That is not a sign-in message.', 400); }
  if (!m.address || !m.domain || !m.nonce || !m.issuedAt) fail('The message needs an address, a domain, a nonce and its time.', 400);
  const fid = Number((m.resources ?? []).map((r) => /^farcaster:\/\/fid\/(\d{1,12})$/.exec(r)?.[1]).find(Boolean));
  if (!fid) fail('The message does not name an FID (resources: farcaster://fid/<fid>).', 400);
  if (domain && m.domain !== domain) fail(`The message is for ${m.domain}, not ${domain}.`);
  if (nonce && m.nonce !== nonce) fail('The message answers a different request (nonce).');
  const issued = m.issuedAt.getTime();
  const expires = m.expirationTime ? m.expirationTime.getTime() : issued + MAX_AGE_MS;
  if (issued > now.getTime() + 60_000) fail('The message is from the future.');
  if (expires < now.getTime()) fail('The login expired. Sign again.');
  if (expires - issued > MAX_LIFE_MS) fail('A login can last a day at most.');
  if (m.notBefore && m.notBefore > now) fail('The login is not valid yet.');
  // The signature: a plain wallet, or a smart wallet (checked onchain, on Base) when a chain client is given.
  const ok = client
    ? await client.verifyMessage({ address: m.address, message, signature }).catch(() => false)
    : (await recoverMessageAddress({ message, signature }).catch(() => '')).toLowerCase() === m.address.toLowerCase();
  if (!ok) fail('The signature was not made by the address in the message.');
  const how = await tie(network, fid, m.address);
  if (!how) fail(`${m.address} is not FID ${fid}'s, on ${network.label ?? network.name}: not its owner, nor an address it verified.`);
  return { fid, address: m.address, how, domain: m.domain, uri: m.uri, nonce: m.nonce, issuedAt: new Date(issued).toISOString(), expiresAt: new Date(expires).toISOString(), network: network.name };
}

/** The message a wallet signs. Pure text, for the browser script and tests to share. */
export function loginMessage({ domain, uri, address, fid, nonce, chainId = 8453, issuedAt = new Date(), minutes = 10 }) {
  const exp = new Date(issuedAt.getTime() + minutes * 60_000);
  return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\nLog in with Fatline as FID ${fid}.\n\nURI: ${uri}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt.toISOString()}\nExpiration Time: ${exp.toISOString()}\nResources:\n- farcaster://fid/${fid}`;
}
