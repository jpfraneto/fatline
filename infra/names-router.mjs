#!/usr/bin/env node
// The names router: <surname>.fatline.ink → the server that runs that Fatliner's node.
//
// Runs on the master, which holds ports 80 and 443 for every *.fatline.ink name (one wildcard DNS record).
//   443: reads only the name a browser asks for (TLS SNI, sent in the clear before any encryption), then passes the
//        connection through untouched. The certificate lives on the person's own server, so the master cannot read
//        anything that goes by: not the pages, not the write token.
//   80:  reads the Host line and passes the connection through too (the person's server answers its own
//        certificate challenges and sends browsers on to https).
// Anything else (the master's own names, like 46-225-208-199.sslip.io, and the master's own Fatline) goes to the
// master's Caddy, moved to 127.0.0.1:8080 and :8443.
// The table of names comes from the hatchery (GET /names), read every minute; the last good table is kept on disk.
//
// Env: NAMES_URL (http://127.0.0.1:8791/names), NAMES_DOMAIN (fatline.ink), NAMES_SELF (this server's public IPs,
// comma-separated: names pointing here go to Caddy), NAMES_CACHE (/root/.fatline/names-cache.json),
// HTTP_PORT (80), TLS_PORT (443), CADDY_HTTP (127.0.0.1:8080), CADDY_TLS (127.0.0.1:8443).
import { createServer, connect, isIP } from 'node:net';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The server name in a TLS ClientHello, or null. buf may be incomplete: returns undefined if more bytes are needed. */
export function parseSni(buf) {
  if (buf.length < 5) return undefined;
  if (buf[0] !== 0x16) return null; // not a TLS handshake
  const recLen = buf.readUInt16BE(3);
  if (buf.length < 5 + recLen) return recLen > 16_384 ? null : undefined;
  let p = 5;
  if (buf[p] !== 0x01) return null; // not a ClientHello
  p += 4 + 2 + 32; // handshake header, version, random
  if (p >= buf.length) return null;
  p += 1 + buf[p]; // session id
  if (p + 2 > buf.length) return null;
  p += 2 + buf.readUInt16BE(p); // cipher suites
  if (p >= buf.length) return null;
  p += 1 + buf[p]; // compression methods
  if (p + 2 > buf.length) return null;
  const end = Math.min(buf.length, p + 2 + buf.readUInt16BE(p));
  p += 2;
  while (p + 4 <= end) {
    const type = buf.readUInt16BE(p), len = buf.readUInt16BE(p + 2);
    p += 4;
    if (type === 0x0000) { // server_name
      let q = p + 2;
      while (q + 3 <= p + len) {
        const nameType = buf[q], nameLen = buf.readUInt16BE(q + 1);
        if (nameType === 0) return buf.subarray(q + 3, q + 3 + nameLen).toString('ascii').toLowerCase();
        q += 3 + nameLen;
      }
      return null;
    }
    p += len;
  }
  return null;
}

/** The Host of an HTTP request head and its path, or undefined if the head is not complete yet. */
export function parseHttpHead(buf) {
  const end = buf.indexOf('\r\n\r\n');
  if (end < 0) return buf.length > 8192 ? null : undefined;
  const lines = buf.subarray(0, end).toString('latin1').split('\r\n');
  const [, path = '/'] = lines[0].split(' ');
  const host = lines.find((l) => /^host:/i.test(l))?.slice(5).trim().toLowerCase().replace(/:\d+$/, '') ?? null;
  return { host, path };
}

/** Addresses the router must never connect to on someone's behalf. */
export function isPrivate(host) {
  if (isIP(host) !== 4) return isIP(host) === 6 ? !/^(2|3)/.test(host) : /^(localhost|.*\.local|.*\.internal)$/i.test(host);
  const [a, b] = host.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || a >= 224;
}

/** Where a name goes: { host, port } of someone's server, 'self' (this server's Caddy), or null (unknown). */
export function resolve(name, { table, domain, self, allowPrivate = false }) {
  const m = String(name ?? '').match(new RegExp(`^([a-z0-9]{1,12})\\.${domain.replace(/\./g, '\\.')}$`));
  if (!m || m[1] === 'www') return 'self'; // www.fatline.ink is fatline.ink: this server
  const host = table.get(m[1]);
  if (!host) return null;
  if (self.has(host)) return 'self';
  if (!allowPrivate && isPrivate(host)) return null;
  return host;
}

const hostPort = (s) => { const i = s.lastIndexOf(':'); return { host: s.slice(0, i), port: Number(s.slice(i + 1)) }; };

export function startRouter({
  namesUrl = 'http://127.0.0.1:8791/names', domain = 'fatline.ink', self = [], cache = null,
  httpPort = 80, tlsPort = 443, caddyHttp = '127.0.0.1:8080', caddyTls = '127.0.0.1:8443',
  targetHttpPort = 80, targetTlsPort = 443, refreshMs = 60_000, log = console.log, allowPrivate = false, // tests only
} = {}) {
  const ctx = { table: new Map(), domain, self: new Set(self), allowPrivate };
  if (cache) { try { ctx.table = new Map(Object.entries(JSON.parse(readFileSync(cache, 'utf8')))); } catch {} }

  const refresh = async () => {
    try {
      const r = await fetch(namesUrl, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { names } = await r.json();
      const next = new Map(names.map((n) => [n.label, n.host]));
      const changed = next.size !== ctx.table.size || [...next].some(([k, v]) => ctx.table.get(k) !== v);
      ctx.table = next;
      if (changed) {
        log(`[names] ${next.size} names: ${[...next.keys()].join(', ')}`);
        if (cache) { writeFileSync(`${cache}.tmp`, JSON.stringify(Object.fromEntries(next))); renameSync(`${cache}.tmp`, cache); }
      }
    } catch (err) { log(`[names] could not read ${namesUrl}: ${err.message}; keeping ${ctx.table.size} names`); }
  };

  // Read the first bytes, decide, then pipe both ways with the bytes already read in front.
  const pipeTo = (client, first, { host, port }) => {
    const up = connect({ host, port });
    up.setTimeout(30_000, () => up.destroy());
    up.once('connect', () => { up.setTimeout(0); up.write(first); client.pipe(up); up.pipe(client); });
    const close = () => { client.destroy(); up.destroy(); };
    up.on('error', close); client.on('error', close);
    up.on('close', close); client.on('close', close);
  };
  const peek = (client, parse, decide) => {
    let buf = Buffer.alloc(0);
    client.setTimeout(10_000, () => client.destroy());
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const got = parse(buf);
      if (got === undefined) return;
      client.off('data', onData);
      client.pause();
      client.setTimeout(0);
      decide(got, buf);
    };
    client.on('data', onData);
    client.on('error', () => client.destroy());
  };

  const tls = createServer((client) => peek(client, parseSni, (sni, first) => {
    const to = resolve(sni, ctx);
    if (to === null) return client.destroy(); // a name nobody holds: no certificate anywhere for it
    pipeTo(client, first, to === 'self' ? hostPort(caddyTls) : { host: to, port: targetTlsPort });
    client.resume();
  }));
  const http = createServer((client) => peek(client, parseHttpHead, (head, first) => {
    const to = head && resolve(head.host, ctx);
    if (to && to !== 'self') { pipeTo(client, first, { host: to, port: targetHttpPort }); return client.resume(); }
    // This server's own names: certificate challenges go to Caddy; everything else is sent to https.
    if (head && to === 'self' && head.path.startsWith('/.well-known/acme-challenge/')) { pipeTo(client, first, hostPort(caddyHttp)); return client.resume(); }
    const body = head?.host && to !== null ? '' : 'Not a Fatline name.\n';
    client.end(body
      ? `HTTP/1.1 404 Not Found\r\ncontent-type: text/plain\r\ncontent-length: ${body.length}\r\nconnection: close\r\n\r\n${body}`
      : `HTTP/1.1 301 Moved Permanently\r\nlocation: https://${head.host}${head.path}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`);
  }));

  const ready = refresh().then(() => Promise.all([
    new Promise((r) => tls.listen(tlsPort, r)), new Promise((r) => http.listen(httpPort, r)),
  ])).then(() => log(`[names] *.${domain}: https on :${tls.address().port}, http on :${http.address().port}; this server's own names go to ${caddyTls} / ${caddyHttp}`));
  const timer = setInterval(refresh, refreshMs);
  return { ready, ctx, refresh, tls, http, close: () => { clearInterval(timer); tls.close(); http.close(); } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const e = process.env;
  startRouter({
    namesUrl: e.NAMES_URL, domain: e.NAMES_DOMAIN, self: (e.NAMES_SELF ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    cache: e.NAMES_CACHE ?? '/root/.fatline/names-cache.json', httpPort: Number(e.HTTP_PORT ?? 80), tlsPort: Number(e.TLS_PORT ?? 443),
    caddyHttp: e.CADDY_HTTP, caddyTls: e.CADDY_TLS,
  });
}
