/*
 * Log in with Fatline. One wallet signature proves which Farcaster account (FID) your visitor is.
 * No seed phrase, no gas, no central server: a Fatline node checks it, and you can re-check it with any other.
 *
 *   <script src="https://fatline.ink/login.js"></script>
 *   <div id="login"></div>
 *   <script>
 *     FatlineLogin.button(document.getElementById('login'), {
 *       onLogin: (who) => console.log(who.fid, who.address, who.how), // how: 'custody' | 'verified'
 *     });
 *   </script>
 *
 * Options: node (a Fatline node, default https://fatline.fatline.ink), provider (an EIP-1193 wallet, default
 * window.ethereum; inside a Farcaster mini app pass sdk.wallet.ethProvider), fid (if you already know it),
 * nonce (your server's, to check later), network ('farcaster' | 'hypersnap').
 *
 * Your server can check the login itself: POST <node>/api/auth/verify { message, signature, domain, nonce }
 * answers { fid, address, how, ... } or an error. The proof is public; it only works for your domain and nonce.
 */
(function () {
  'use strict';
  var NODE = 'https://fatline.fatline.ink';
  var ARCH = '<svg viewBox="0 0 1000 1000" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M257.778 155.556H742.222V844.444H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.444H257.778V155.556Z"/><path fill="currentColor" d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.444H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z"/><path fill="currentColor" d="M675.556 746.667C663.283 746.667 653.333 756.616 653.333 768.889V795.556H648.889C636.616 795.556 626.667 805.505 626.667 817.778V844.444H875.556V817.778C875.556 805.505 865.606 795.556 853.333 795.556H848.889V768.889C848.889 756.616 838.94 746.667 826.667 746.667V351.111H851.111L880 253.333H702.222V746.667H675.556Z"/></svg>';

  // EIP-55 checksummed addresses (some wallets refuse a sign-in message without one): Keccak-256, small and plain.
  var RC = ['0x1', '0x8082', '0x800000000000808a', '0x8000000080008000', '0x808b', '0x80000001', '0x8000000080008081', '0x8000000000008009', '0x8a', '0x88', '0x80008009', '0x8000000a', '0x8000808b', '0x800000000000008b', '0x8000000000008089', '0x8000000000008003', '0x8000000000008002', '0x8000000000000080', '0x800a', '0x800000008000000a', '0x8000000080008081', '0x8000000000008080', '0x80000001', '0x8000000080008008'].map(BigInt);
  var ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
  var M = (1n << 64n) - 1n;
  function rotl(x, n) { n = BigInt(n); return n ? ((x << n) | (x >> (64n - n))) & M : x; }
  function keccak(bytes) {
    var s = new Array(25).fill(0n), rate = 136, msg = Array.from(bytes);
    msg.push(1); while (msg.length % rate) msg.push(0); msg[msg.length - 1] |= 0x80;
    for (var off = 0; off < msg.length; off += rate) {
      for (var i = 0; i < rate / 8; i++) { var w = 0n; for (var b = 7; b >= 0; b--) w = (w << 8n) | BigInt(msg[off + i * 8 + b]); s[i] ^= w; }
      for (var r = 0; r < 24; r++) {
        var c = [], d, x, y, t = new Array(25);
        for (x = 0; x < 5; x++) c[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
        for (x = 0; x < 5; x++) { d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1); for (y = 0; y < 25; y += 5) s[y + x] ^= d; }
        for (x = 0; x < 5; x++) for (y = 0; y < 5; y++) t[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
        for (i = 0; i < 25; i++) s[i] = t[i] ^ (~t[(i % 5 + 1) % 5 + 5 * Math.floor(i / 5)] & t[(i % 5 + 2) % 5 + 5 * Math.floor(i / 5)] & M);
        s[0] ^= RC[r];
      }
    }
    var out = ''; for (i = 0; i < 4; i++) for (b = 0; b < 8; b++) out += Number((s[i] >> BigInt(8 * b)) & 255n).toString(16).padStart(2, '0');
    return out;
  }
  function checksum(addr) {
    var a = addr.toLowerCase().replace(/^0x/, ''), h = keccak(new TextEncoder().encode(a)), out = '0x';
    for (var i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? a[i].toUpperCase() : a[i];
    return out;
  }

  function nonceOf() { var b = new Uint8Array(8); crypto.getRandomValues(b); return Array.from(b, function (x) { return x.toString(16).padStart(2, '0'); }).join(''); }
  function hex(s) { return '0x' + Array.from(new TextEncoder().encode(s), function (x) { return x.toString(16).padStart(2, '0'); }).join(''); }

  function message(o) {
    var issued = new Date(), exp = new Date(issued.getTime() + 10 * 60000);
    return location.host + ' wants you to sign in with your Ethereum account:\n' + o.address + '\n\nLog in with Fatline as FID ' + o.fid +
      '.\n\nURI: ' + location.origin + '\nVersion: 1\nChain ID: 8453\nNonce: ' + o.nonce + '\nIssued At: ' + issued.toISOString() +
      '\nExpiration Time: ' + exp.toISOString() + '\nResources:\n- farcaster://fid/' + o.fid;
  }

  async function ask(node, path, body) {
    var r = await fetch(node + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    var out = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(out.error || ('The node answered ' + r.status + '.'));
    return out;
  }

  /** Who is this: a Farcaster name (@jp, jp.eth) or an FID, as the node knows it. */
  async function who(name, o) {
    var node = (o.node || NODE).replace(/\/$/, '');
    return ask(node, '/api/user?q=' + encodeURIComponent(String(name).trim().replace(/^@/, '')) + (o.network ? '&network=' + o.network : ''));
  }

  /** The login itself. Resolves { fid, address, how, message, signature, user }. */
  async function login(o) {
    o = o || {};
    var node = (o.node || NODE).replace(/\/$/, '');
    var provider = o.provider || window.ethereum;
    if (!provider) throw new Error('No wallet in this browser. Open this page in a wallet\'s browser, or inside Farcaster.');
    var accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts[0]) throw new Error('The wallet shared no address.');
    var address = checksum(accounts[0]);
    var fid = Number(o.fid);
    if (!fid) throw new Error('Which Farcaster account?');
    var nonce = o.nonce || nonceOf();
    var text = message({ address: address, fid: fid, nonce: nonce });
    var signature = await provider.request({ method: 'personal_sign', params: [hex(text), address] });
    var out = await ask(node, '/api/auth/verify', { message: text, signature: signature, domain: location.host, nonce: nonce, network: o.network });
    out.message = text; out.signature = signature; out.node = node;
    return out;
  }

  var CSS = '.fl-login{font:500 15px/1.2 system-ui,sans-serif;display:inline-flex;flex-direction:column;gap:8px;max-width:340px}' +
    '.fl-login button{display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:11px 18px;border:0;border-radius:999px;background:#7c65c1;color:#fff;font:inherit;font-weight:600;cursor:pointer}' +
    '.fl-login button:hover{background:#6a54b0}.fl-login button[disabled]{opacity:.6;cursor:wait}' +
    '.fl-login form{display:flex;gap:6px}.fl-login input{flex:1;min-width:0;padding:10px 12px;border:1px solid #7c65c155;border-radius:999px;font:inherit;background:transparent;color:inherit}' +
    '.fl-login small{opacity:.75;font-size:13px}.fl-login .fl-err{color:#d4583c}';

  /** A "Log in with Fatline" button in `el`. Asks for the Farcaster name once (unless opts.fid), then the signature. */
  function button(el, o) {
    o = o || {};
    if (!document.getElementById('fl-login-css')) { var st = document.createElement('style'); st.id = 'fl-login-css'; st.textContent = CSS; document.head.appendChild(st); }
    var box = document.createElement('div'); box.className = 'fl-login';
    var btn = document.createElement('button'); btn.type = 'button'; btn.innerHTML = ARCH + '<span>' + (o.label || 'Log in with Fatline') + '</span>';
    var note = document.createElement('small');
    box.appendChild(btn); box.appendChild(note); el.replaceChildren(box);
    function say(t, err) { note.textContent = t || ''; note.className = err ? 'fl-err' : ''; }
    async function go(fid, user) {
      btn.disabled = true; say('Sign the message in your wallet. No gas, nothing moves.');
      try {
        var out = await login(Object.assign({}, o, { fid: fid }));
        out.user = user || null;
        say(''); btn.querySelector('span').textContent = user && user.username ? '@' + user.username : 'FID ' + out.fid;
        if (o.onLogin) o.onLogin(out);
      } catch (e) {
        say(e && e.code === 4001 ? 'You cancelled. Nothing was signed.' : (e && e.message) || String(e), true);
      } finally { btn.disabled = false; }
    }
    btn.onclick = function () {
      if (o.fid) return go(Number(o.fid));
      var form = document.createElement('form');
      form.innerHTML = '<input name="who" placeholder="Your Farcaster name or FID" autocomplete="username" required><button type="submit">Next</button>';
      box.replaceChildren(form, note); say('The wallet you sign with must be yours on Farcaster: its owner, or one you verified.');
      form.querySelector('input').focus();
      form.onsubmit = async function (ev) {
        ev.preventDefault();
        var q = form.who.value; say('Looking for ' + q + '…');
        try {
          var user = await who(q, o);
          box.replaceChildren(btn, note); go(user.fid, user);
        } catch (e) { say((e && e.message) || String(e), true); }
      };
    };
    return box;
  }

  window.FatlineLogin = { button: button, login: login, who: who, checksum: checksum };
})();
