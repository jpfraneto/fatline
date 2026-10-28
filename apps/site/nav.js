// One navbar on every page of fatline.ink, the same as the home page's: FATLINE, Nodes, Docs, Manifesto, LAUNCH.
// It takes the place of the page's own main <nav>. Inside Farcaster it also tells the app the page is ready:
// without that, a mini app keeps its splash screen up and the page never shows.
(() => {
  const ARCH = '<svg viewBox="128.889 155.556 751.111 688.889" aria-hidden="true"><path fill="currentColor" d="M257.778 155.556h484.444v688.889h-71.111V528.889h-.697c-7.86-87.212-81.156-155.556-170.414-155.556s-162.554 68.344-170.414 155.556h-.697v315.556h-71.111z"/><path fill="currentColor" d="M128.889 253.333l28.889 97.778h24.444v395.556c-12.273 0-22.222 9.949-22.222 22.222v26.667h-4.444c-12.273 0-22.223 9.949-22.223 22.222v26.667h248.889v-26.667c0-12.273-9.949-22.222-22.222-22.222h-4.444v-26.667c0-12.273-9.95-22.222-22.223-22.222h-26.666V253.333zM675.556 746.667c-12.273 0-22.223 9.949-22.223 22.222v26.667h-4.444c-12.273 0-22.222 9.949-22.222 22.222v26.667h248.889v-26.667c0-12.273-9.95-22.222-22.223-22.222h-4.444v-26.667c0-12.273-9.949-22.222-22.222-22.222V351.111h24.444L880 253.333H702.222v493.334z"/></svg>';
  const css = `
  .fl-nav{display:block!important;width:100%!important;max-width:none!important;margin:0!important;padding:0!important;box-sizing:border-box;position:sticky;top:0;z-index:50;background:rgba(15,20,32,.86);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid rgba(243,234,219,.14);font-family:Inter,system-ui,sans-serif}
  .fl-nav-in{box-sizing:border-box;width:100%;max-width:1080px;justify-content:flex-start;margin:0 auto;display:flex;align-items:center;gap:18px;padding:12px max(18px,env(safe-area-inset-right,0px)) 12px max(18px,env(safe-area-inset-left,0px))}
  .fl-mark{font:500 13px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.42em;color:#f3eadb!important;text-decoration:none!important}
  .fl-links{display:flex;gap:16px;font-size:14px}.fl-links a{font:400 14px Inter,system-ui,sans-serif!important;letter-spacing:0!important;text-transform:none!important;color:#a9a08f!important;text-decoration:none!important}.fl-links a[aria-current]{color:#f3eadb!important}
  .fl-launch{margin-left:auto;display:inline-flex;align-items:center;gap:8px;font:700 13px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.14em;border-radius:999px;padding:9px 16px;background:#855dcd;color:#fff!important;text-decoration:none!important;box-shadow:0 0 24px rgba(133,93,205,.45)}
  .fl-launch svg{width:16px;height:16px}
  @media(max-width:640px){.fl-links a.fl-opt{display:none}.fl-nav-in{gap:12px}}`;
  const here = location.pathname;
  const link = (href, text, opt) => `<a href="${href}"${opt ? ' class="fl-opt"' : ''}${here.startsWith(href) && href !== '/' ? ' aria-current="page"' : ''}>${text}</a>`;
  const bar = document.createElement('nav');
  bar.className = 'fl-nav'; bar.setAttribute('aria-label', 'Main');
  bar.innerHTML = `<div class="fl-nav-in"><a class="fl-mark" href="/">FATLINE</a><div class="fl-links">${link('/#nodes', 'Nodes', true)}${link('/docs/', 'Docs')}${link('/manifesto.html', 'Manifesto')}</div>`
    + `<a class="fl-launch" href="/#launch">${ARCH}LAUNCH</a></div>`;
  const style = document.createElement('style'); style.textContent = css;
  document.head.append(style);
  const old = document.querySelector('nav[aria-label="Main"], nav.main, body > nav');
  if (old) old.replaceWith(bar); else document.body.prepend(bar);

  import('https://esm.sh/@farcaster/miniapp-sdk@0.3.0').then(async ({ sdk }) => { if (await sdk.isInMiniApp()) sdk.actions.ready(); }).catch(() => {});
})();
