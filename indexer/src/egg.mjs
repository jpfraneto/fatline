// The egg: what a node keeps warm until a Fatliner hatches from it.
//
// To lay one, the account signs a claim with its app key (the Ed25519 key `fatline identity` made):
// "this server keeps my egg warm (its node, and its hatchery with this key); hatch me to this address". Attesters check that node every hour. After
// WARM_DAYS warm days each attester signs the same EIP-712 Hatch, and the Fatliners contract mints when
// more than half of the attesters signed it. Everything an attester signs is computed from the claim and
// the account's history, so honest attesters sign identical Hatches.
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';

export const WARM_DAYS = 3; // the contract's WARM_DAYS
export const DAY_MS = 24 * 3_600_000;
export const CHECK_EVERY_MS = 3_600_000;
export const WARM_SHARE = 0.75; // a day is warm when this share of its hourly checks passed
export const HATCH_VALID_S = 365 * 86_400; // how long a Hatch can be used after the egg was laid
export const CLAIM_SKEW_MS = 15 * 60_000; // a claim must be fresh

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const raw = (hex) => Buffer.from(String(hex).replace(/^0x/, ''), 'hex');
const lower = (a) => String(a).toLowerCase();

/** The node a claim names, as one comparable string: scheme://host:port, no path. */
export function normalizeNode(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('The node must be an http(s) URL.');
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  return `${u.protocol}//${u.hostname.toLowerCase()}:${port}`;
}

/** A hatchery's URL as it is stored onchain: scheme://host[:port], no trailing slash. */
export function normalizeUrl(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('The hatchery must be an http(s) URL.');
  return `${u.protocol}//${u.host.toLowerCase()}`;
}

/** Two URLs on the same machine (same host name, any port). */
export const sameHost = (a, b) => new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase();

/** The text the app key signs. Plain words, so anyone can read what they sign. */
export function claimText(c) {
  return [
    'fatline egg v1',
    `fid: ${Number(c.fid)}`,
    `network: ${c.network}`,
    `node: ${normalizeNode(c.node)}`,
    `to: ${lower(c.to)}`,
    `server: ${lower(c.server)}`,
    `hatchery: ${normalizeUrl(c.hatchery)}`,
    `at: ${Number(c.at)}`,
  ].join('\n');
}

/** Signs a claim with the app key record ({ fid, privateKey, publicKey }) from .fatline/appkey.json. */
export function signClaim(appKey, claim) {
  const c = { fid: Number(claim.fid), network: claim.network, node: normalizeNode(claim.node), to: lower(claim.to),
    server: lower(claim.server), hatchery: normalizeUrl(claim.hatchery), at: Number(claim.at) };
  if (Number(appKey.fid) !== c.fid) throw new Error(`The app key belongs to FID ${appKey.fid}, not ${c.fid}.`);
  const key = createPrivateKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', d: b64url(raw(appKey.privateKey).subarray(0, 32)), x: b64url(raw(appKey.publicKey)) } });
  return { claim: c, publicKey: lower(appKey.publicKey), signature: `0x${edSign(null, Buffer.from(claimText(c)), key).toString('hex')}` };
}

/** Is the signature this public key's, over this claim? (Whether the key belongs to the FID is a node question.) */
export function verifyClaim({ claim, publicKey, signature }) {
  try {
    const key = createPublicKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x: b64url(raw(publicKey)) } });
    return edVerify(null, Buffer.from(claimText(claim)), key, raw(signature));
  } catch {
    return false;
  }
}

/** The history the being hatches from ends at the hour before the egg was laid (minus 10 minutes, for sync). */
export function laidAtOf(atMs) {
  return Math.floor((Number(atMs) - 10 * 60_000) / 3_600_000) * 3_600; // unix seconds
}

// EIP-712, exactly as Fatliners.sol hashes it.
export const eggTypes = {
  Egg: [
    { name: 'fid', type: 'uint256' },
    { name: 'to', type: 'address' },
    { name: 'server', type: 'address' },
    { name: 'url', type: 'string' },
    { name: 'dna', type: 'bytes32' },
    { name: 'laidAt', type: 'uint64' },
    { name: 'surname', type: 'string' },
    { name: 'deadline', type: 'uint256' },
  ],
};
export const hatchTypes = {
  Hatch: [
    { name: 'fid', type: 'uint256' },
    { name: 'surname', type: 'string' },
    { name: 'deadline', type: 'uint256' },
  ],
};
export const hatchDomain = ({ chainId, address }) => ({ name: 'Fatliners', version: '1', chainId: Number(chainId), verifyingContract: address });

/**
 * The onchain egg, from the claim and the DNA. Every field is deterministic, so attesters sign the same one.
 * It carries the surname read from the DNA: the egg's coin ticker from the day it is onchain, and its name at hatching.
 */
export async function eggOf(egg) {
  const laidAt = laidAtOf(egg.claim.at);
  return { fid: BigInt(egg.claim.fid), to: egg.claim.to, server: egg.claim.server, url: egg.claim.hatchery,
    dna: egg.dna, laidAt: BigInt(laidAt), surname: await surnameOf(egg.claim.fid, egg.dna), deadline: BigInt(laidAt + HATCH_VALID_S) };
}

/**
 * The being's surname: its name, read from its DNA (fatliners/src/pfp/name.mjs, the same name its portrait
 * carries), in capitals. It is also its coin's ticker, and the launchpad accepts no other.
 */
export async function surnameOf(fid, dna) {
  const { seedOf } = await import('../../fatliners/src/dna.mjs');
  const { beingName } = await import('../../fatliners/src/pfp/name.mjs');
  return beingName(seedOf({ kind: 'fid', fid: Number(fid) }, dna)).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

/** The Hatch for an egg: which egg and its surname. */
export async function hatchOf(egg) {
  return { fid: BigInt(egg.claim.fid), surname: await surnameOf(egg.claim.fid, egg.dna), deadline: BigInt(laidAtOf(egg.claim.at) + HATCH_VALID_S) };
}

/**
 * Warmth, in 24-hour windows from the moment the egg was laid. A window is warm once WARM_SHARE of the
 * checks it should get have passed (so a window can turn warm before it ends). Cold windows do not reset
 * anything: the egg just needs WARM_DAYS warm ones.
 */
export function warmth(egg, { now = Date.now(), dayMs = DAY_MS, checkEveryMs = CHECK_EVERY_MS } = {}) {
  const start = Number(egg.claim.at);
  const need = Math.ceil((dayMs / checkEveryMs) * WARM_SHARE);
  const days = [];
  for (let i = 0; start + i * dayMs <= now; i++) {
    const from = start + i * dayMs, to = from + dayMs;
    const inDay = (egg.checks ?? []).filter((c) => c.at >= from && c.at < to);
    const passed = inDay.filter((c) => c.ok).length;
    days.push({ day: i + 1, from, to, checks: inDay.length, passed, need, warm: passed >= need, done: now >= to });
  }
  const warmDays = days.filter((d) => d.warm).length;
  return { days, warmDays, needed: WARM_DAYS, ready: warmDays >= WARM_DAYS };
}
