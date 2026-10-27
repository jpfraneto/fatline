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

/** An EIP-1193 wallet: the Farcaster app's own inside Farcaster, the browser's elsewhere. null if none. */
export async function ethProvider() {
  if (sdk) { try { const p = await sdk.wallet.getEthereumProvider(); if (p) return p; } catch { /* below */ } }
  return window.ethereum ?? null;
}
