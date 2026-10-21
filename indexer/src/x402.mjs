// A small x402 client for the "exact" scheme on EVM chains (USDC via EIP-3009).
//
// Paying is ONE signature. The seller's facilitator submits it as a single USDC
// transferWithAuthorization transaction, and the payer needs no ETH for gas.
//
// Supports both wire versions seen in the wild:
//   v1: quote in the 402 body, payment in the X-PAYMENT header            (e.g. Neynar)
//   v2: quote in the PAYMENT-REQUIRED header, payment in PAYMENT-SIGNATURE (e.g. VpsAgent)
// Spec: https://github.com/coinbase/x402/tree/main/specs
import { randomBytes } from 'node:crypto';
import { getAddress, toHex } from 'viem';

const V1_NETWORKS = { base: 8453, 'base-sepolia': 84532 };

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');
const unb64 = (s) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));

export function chainIdOf(network) {
  if (V1_NETWORKS[network]) return V1_NETWORKS[network];
  const m = /^eip155:(\d+)$/.exec(network ?? '');
  if (m) return Number(m[1]);
  throw new Error(`Unsupported payment network "${network}". Only EVM chains are supported.`);
}

/** Reads a 402 response into { version, resource, options[] } with amounts as BigInt. */
export async function readQuote(res) {
  const header = res.headers.get('payment-required');
  let quote;
  if (header) {
    quote = unb64(header);
  } else {
    quote = await res.json().catch(() => null);
  }
  if (!quote?.accepts?.length) throw new Error('The 402 response has no payment options');
  const version = Number(quote.x402Version ?? 1);
  if (version !== 1 && version !== 2) throw new Error(`Unsupported x402 version ${version}`);
  const options = quote.accepts.map((a) => ({
    ...a,
    raw: a,
    amount: BigInt(a.amount ?? a.maxAmountRequired),
    chainId: chainIdOf(a.network),
  }));
  return { version, resource: quote.resource ?? null, options };
}

/** Picks the cheapest "exact" EVM option on one of the allowed chains. */
export function chooseOption(quote, allowedChainIds = [8453]) {
  const ok = quote.options
    .filter((o) => o.scheme === 'exact' && allowedChainIds.includes(o.chainId) && o.extra?.name && o.extra?.version)
    .sort((a, b) => (a.amount < b.amount ? -1 : 1));
  if (!ok.length) throw new Error('No payment option this client can pay (needs scheme "exact" on an allowed EVM chain)');
  return ok[0];
}

const transferWithAuthorization = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' },
  { name: 'nonce', type: 'bytes32' },
];

/** Signs the EIP-3009 authorization and returns the header to send. Nothing is broadcast here. */
export async function signPayment({ account, quote, option, now = Math.floor(Date.now() / 1000) }) {
  const authorization = {
    from: account.address,
    to: getAddress(option.payTo),
    value: option.amount.toString(),
    validAfter: String(now - 600),
    validBefore: String(now + Number(option.maxTimeoutSeconds ?? 300)),
    nonce: toHex(randomBytes(32)),
  };
  const signature = await account.signTypedData({
    domain: { name: option.extra.name, version: option.extra.version, chainId: option.chainId, verifyingContract: getAddress(option.asset) },
    types: { TransferWithAuthorization: transferWithAuthorization },
    primaryType: 'TransferWithAuthorization',
    message: {
      ...authorization,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
    },
  });
  const payload = { signature, authorization };
  if (quote.version === 1) {
    return { name: 'X-PAYMENT', value: b64({ x402Version: 1, scheme: option.scheme, network: option.network, payload }) };
  }
  return { name: 'PAYMENT-SIGNATURE', value: b64({ x402Version: 2, resource: quote.resource ?? undefined, accepted: option.raw, payload }) };
}

/** Decodes the seller's settlement receipt, when it sends one. */
export function readReceipt(res) {
  const h = res.headers.get('payment-response') ?? res.headers.get('x-payment-response');
  try { return h ? unb64(h) : null; } catch { return null; }
}

export const formatUsdc = (units) => (Number(units) / 1e6).toFixed(2);
