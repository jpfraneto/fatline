// Inside Farcaster (as a mini app), the SDK is loaded; in a plain browser it never is.
let sdk = null;

/** True when this page runs inside a Farcaster app. Tells the app the page is ready (hides its splash). */
export async function enterMiniApp() {
  const framed = window.parent !== window || Boolean(window.ReactNativeWebView);
  if (!framed) return false;
  try {
    ({ sdk } = await import('@farcaster/miniapp-sdk'));
    if (!(await sdk.isInMiniApp())) { sdk = null; return false; }
    await sdk.actions.ready();
    document.documentElement.classList.add('in-miniapp');
    return true;
  } catch {
    sdk = null;
    return false;
  }
}

export const inMiniApp = () => Boolean(sdk);

/** Who is looking, as the Farcaster app says (not proof: only for display). */
export async function viewer() {
  try { return (await sdk?.context)?.user ?? null; } catch { return null; }
}

/** A coin, in the Farcaster app's own token view (buy, sell, chart). Elsewhere: on a block explorer. */
export async function viewCoin(chainId, address) {
  if (sdk) {
    try { await sdk.actions.viewToken({ token: `eip155:${chainId}/erc20:${address}` }); return; } catch { /* below */ }
  }
  window.open(`https://basescan.org/token/${address}`, '_blank', 'noopener');
}

export async function viewProfile(fid) {
  if (sdk) { try { await sdk.actions.viewProfile({ fid: Number(fid) }); return; } catch { /* below */ } }
  window.open(`https://farcaster.xyz/~/profiles/${fid}`, '_blank', 'noopener');
}

export async function openUrl(url) {
  if (sdk) { try { await sdk.actions.openUrl(url); return; } catch { /* below */ } }
  window.open(url, '_blank', 'noopener');
}

/**
 * An EIP-1193 wallet: the Farcaster app's own inside Farcaster (sdk.wallet.getEthereumProvider, as the mini app docs
 * say), the browser's elsewhere. null if none. The Farcaster app hands its wallet only to a mini app opened at its own
 * domain: a page that jumped here from another domain gets none (fatline.ink opens clients with openMiniApp for that).
 */
export async function ethProvider() {
  if (sdk) {
    try { const p = await sdk.wallet.getEthereumProvider(); if (p) return p; } catch { /* below */ }
    if (sdk.wallet?.ethProvider) return sdk.wallet.ethProvider;
  }
  return window.ethereum ?? null;
}

/** Why there is no wallet, in words for the person holding the phone. */
export function noWalletReason() {
  return sdk
    ? 'Farcaster did not hand this app a wallet. Open it from its own card (fatline.fatline.ink), or update the Farcaster app.'
    : 'No wallet here. Open this inside Farcaster, or in a browser with a wallet.';
}

/** Another Fatline place (<surname>.fatline.ink): inside Farcaster as its own mini app (its own domain, its own wallet). */
export async function openPlace(url) {
  if (sdk) { try { await sdk.actions.openMiniApp({ url }); return; } catch { /* below */ } }
  location.assign(url);
}
