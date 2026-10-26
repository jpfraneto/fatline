// Every Fatline's client is a Farcaster mini app at https://<surname>.fatline.ink: a cast of that address shows
// a card that opens the place inside Farcaster. The place comes with what it is: whose it is, the node it reads
// (on the same machine), its egg or Fatliner, and its coin. Nothing here asks another server.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

export const DOMAIN = 'fatline.ink';
const SPLASH = '#0b0d1a';

/** "fatline" for fatline.fatline.ink; null for any other host. */
export function labelOf(host) {
  const h = String(host ?? '').toLowerCase().replace(/:\d+$/, '');
  const m = h.match(/^([a-z0-9-]{1,63})\.fatline\.ink$/);
  return m ? m[1] : null;
}

const title = (label) => label.charAt(0).toUpperCase() + label.slice(1);

/** The card a cast of this place shows (fc:miniapp), as the content of the meta tag. */
export function embed(host) {
  const label = labelOf(host);
  const url = `https://${host}`;
  return {
    version: '1',
    imageUrl: `${url}/miniapp/embed.jpg`,
    button: {
      title: `Open ${title(label ?? 'Fatline')}`.slice(0, 32),
      action: { type: 'launch_frame', name: title(label ?? 'Fatline'), url: `${url}/`, splashImageUrl: `${url}/miniapp/splash.png`, splashBackgroundColor: SPLASH },
    },
  };
}

/** The meta tags for index.html; the same card under its old name too, for older Farcaster apps. */
export function embedTags(host) {
  if (!labelOf(host)) return '';
  const json = JSON.stringify(embed(host)).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
  return `<meta name="fc:miniapp" content='${json}' />\n    <meta name="fc:frame" content='${json}' />\n`;
}

/** /.well-known/farcaster.json. The account association is optional: the card opens without it. */
export function manifest(host, dataDir) {
  const label = labelOf(host);
  if (!label) return null;
  const url = `https://${host}`;
  const association = readAssociation(dataDir, host);
  return {
    ...(association ? { accountAssociation: association } : {}),
    miniapp: {
      version: '1',
      name: title(label),
      homeUrl: `${url}/`,
      iconUrl: `${url}/miniapp/icon.png`,
      splashImageUrl: `${url}/miniapp/splash.png`,
      splashBackgroundColor: SPLASH,
      subtitle: 'A Fatline: node, client, coin',
      description: `${title(label)}'s Fatline. Its own Farcaster node, the client that reads it, and the coin that keeps it alive.`,
      primaryCategory: 'social',
      tags: ['fatline', 'snapchain', 'hypersnap', 'node'],
      heroImageUrl: `${url}/miniapp/embed.jpg`,
      canonicalDomain: host.replace(/:\d+$/, ''),
      requiredChains: ['eip155:8453'],
    },
  };
}

const file = (dataDir) => join(dataDir, 'miniapp-association.json');

function readAssociation(dataDir, host) {
  try {
    if (!dataDir || !existsSync(file(dataDir))) return null;
    const a = JSON.parse(readFileSync(file(dataDir), 'utf8'));
    const payload = JSON.parse(Buffer.from(a.payload, 'base64url').toString('utf8'));
    return payload.domain === host.replace(/:\d+$/, '') ? a : null;
  } catch {
    return null;
  }
}

/**
 * A JSON Farcaster Signature saying this domain belongs to an account: signed by that account's custody key.
 * { header, payload, signature }, each base64url; the signature is EIP-191 over "header.payload".
 */
export async function signAssociation({ domain, fid, privateKey }) {
  const account = privateKeyToAccount(privateKey);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ fid: Number(fid), type: 'custody', key: account.address });
  const payload = b64({ domain });
  const sig = await account.signMessage({ message: `${header}.${payload}` });
  return { header, payload, signature: Buffer.from(sig.slice(2), 'hex').toString('base64url') };
}

export function saveAssociation(dataDir, association) {
  writeFileSync(file(dataDir), JSON.stringify(association, null, 1), { mode: 0o600 });
}

const padAbi = parseAbi([
  'function coinOfFatliner(uint256) view returns (address)',
  'function predictFatlinerVault(uint256) view returns (address)',
]);
const vaultAbi = parseAbi(['function uri() view returns (string)', 'function balance() view returns (uint256)', 'function aliveUntil() view returns (uint256)']);
const ZERO = /^0x0{40}$/i;

/**
 * The place, in one public answer: who it belongs to, its egg or Fatliner, the node it reads, and its coin.
 * cockpit: makeCockpit's function, asked for the owner's FID.
 */
export function makePlace({ cockpit, contract, rpc, ownerFid }) {
  const reader = contract ? createPublicClient({ chain: base, transport: http(rpc) }) : null;
  let cache = { at: 0, value: null };

  async function coin(fid) {
    if (!reader || !fid) return null;
    const id = BigInt(fid);
    const [address, vault] = await Promise.all([
      reader.readContract({ address: contract, abi: padAbi, functionName: 'coinOfFatliner', args: [id] }).catch(() => null),
      reader.readContract({ address: contract, abi: padAbi, functionName: 'predictFatlinerVault', args: [id] }).catch(() => null),
    ]);
    if (!address || ZERO.test(address)) return { address: null, vault };
    const read = (functionName) => reader.readContract({ address: vault, abi: vaultAbi, functionName }).catch(() => null);
    const [uri, balance, aliveUntil] = await Promise.all([read('uri'), read('balance'), read('aliveUntil')]);
    return { address, vault, uri, balanceUsdc: balance != null ? Number(balance) / 1e6 : null, aliveUntil: aliveUntil ? Number(aliveUntil) : null };
  }

  return async function place(host) {
    if (cache.value && Date.now() - cache.at < 20_000) return { ...cache.value, host: host ?? null, label: labelOf(host) };
    const c = await cockpit(ownerFid);
    const fid = c.me?.fid ?? null;
    const tk = c.token ?? {};
    const value = {
      fid,
      owner: { fid, username: c.me?.username ?? null, displayName: c.me?.displayName ?? null, pfp: c.me?.pfp ?? null },
      surname: tk.surname ?? null, stage: tk.stage ?? 'none', stone: tk.stone ?? null, asleep: tk.asleep ?? null,
      contract: tk.contract ?? contract ?? null, app: tk.app ?? null,
      hatch: c.hatch ? { warmDays: c.hatch.warmDays ?? 0, needed: c.hatch.needed ?? 3, hatched: Boolean(c.hatch.hatched), hatchery: c.hatch.hatchery ?? null, node: c.hatch.node ?? null, network: c.hatch.network ?? null } : null,
      nodes: Array.isArray(c.nodes) ? c.nodes.map((n) => ({ network: n.network, own: n.own, answering: n.answering, synced: n.synced, blocksBehind: n.blocksBehind, messages: n.messages, version: n.version })) : [],
      coin: await coin(fid).catch(() => null),
      at: Date.now(),
    };
    cache = { at: Date.now(), value };
    return { ...value, host: host ?? null, label: labelOf(host) };
  };
}

// fatline update, on the genesis server only (run by infra/serve-client.sh as root, before the client is locked down):
//   node src/miniapp.mjs associate <domain> <client data dir>
// signs "<domain> belongs to @fatline" with @fatline's custody key (app-custody.key), if that key is its custody.
if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === 'associate') {
  const [, , , domain, out] = process.argv;
  const { loadConfig } = await import('./config.mjs');
  const config = loadConfig();
  const keyFile = join(process.env.FATLINE_KEYS ?? '/root/.fatline', 'app-custody.key');
  const acct = config.deployments?.appAccount;
  if (!labelOf(domain) || !out) { console.error('usage: associate <name>.fatline.ink <dir>'); process.exit(1); }
  if (!existsSync(keyFile) || !acct?.fid) process.exit(0); // not the genesis server: the card works without it
  const k = readFileSync(keyFile, 'utf8').trim();
  const privateKey = k.startsWith('0x') ? k : `0x${k}`;
  if (privateKeyToAccount(privateKey).address.toLowerCase() !== String(acct.custody).toLowerCase()) {
    console.error(`  Mini app: app-custody.key is not @${acct.username}'s custody; not signing.`);
    process.exit(0);
  }
  saveAssociation(out, await signAssociation({ domain, fid: acct.fid, privateKey }));
  console.log(`  Mini app: ${domain} signed as @${acct.username}.`);
}
