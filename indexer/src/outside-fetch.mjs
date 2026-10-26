// Fetching a URL that someone else gave us (an egg's node or hatchery), from a server that may sit inside a
// private network. Only public addresses are reached: no localhost, no private ranges, no cloud metadata
// (169.254.169.254). The check is made on the address actually connected to, after DNS, so a name that
// resolves to a private address (or changes between two lookups) is refused too. Redirects are not followed,
// and bodies are capped, so a hostile node can't send us elsewhere or fill our memory.
import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) blocked.addSubnet(net, bits, 'ipv6');

/** Is this IP address on the public internet? (IPv4-mapped IPv6 is judged as the IPv4 inside it.) */
export function isPublicAddress(ip) {
  let a = String(ip).replace(/^\[|\]$/g, '');
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) a = mapped[1];
  const v = isIP(a);
  if (!v) return false;
  return !blocked.check(a, v === 4 ? 'ipv4' : 'ipv6');
}

const refuse = (host, ip) => Object.assign(new Error(`${host} is not a public address${ip && ip !== host ? ` (${ip})` : ''}`), { code: 'ENOTPUBLIC' });

/** dns.lookup that only hands back public addresses. Used as the socket's lookup, so it guards the real connection. */
function publicLookup(hostname, options, callback) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const ok = addresses.filter((a) => isPublicAddress(a.address));
    if (!ok.length) return callback(refuse(hostname, addresses[0]?.address));
    if (options?.all) return callback(null, ok);
    callback(null, ok[0].address, ok[0].family);
  });
}

/**
 * A small fetch for URLs from outside: GET only, public addresses only, no redirects, at most maxBytes of body.
 * Returns what Hatchery.json needs from a fetch Response: { status, ok, json() }.
 */
export function outsideFetch(url, { signal, maxBytes = 2_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('bad URL')); }
    if (!/^https?:$/.test(u.protocol)) return reject(new Error('only http(s)'));
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !isPublicAddress(host)) return reject(refuse(host));
    if (/^localhost$|\.localhost$/i.test(host)) return reject(refuse(host));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', lookup: publicLookup, signal, headers: { accept: 'application/json' } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(new Error(`answer larger than ${maxBytes} bytes`)); return; }
        chunks.push(c);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 0;
        resolve({ status, ok: status >= 200 && status < 300, json: async () => JSON.parse(text), text: async () => text });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
