// The names router: <surname>.fatline.ink → that person's server, passed through untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as netServer, connect } from 'node:net';
import { createServer as httpServer } from 'node:http';
import tls from 'node:tls';
import { parseSni, parseHttpHead, isPrivate, resolve, startRouter } from '../names-router.mjs';

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

/** The first bytes a browser sends for a name: a real ClientHello, captured from Node's TLS client. */
async function clientHello(servername) {
  let resolveBytes;
  const got = new Promise((r) => (resolveBytes = r));
  const srv = netServer((s) => s.once('data', (d) => { resolveBytes(d); s.destroy(); }));
  const port = await listen(srv);
  const c = tls.connect({ host: '127.0.0.1', port, servername, rejectUnauthorized: false });
  c.on('error', () => {});
  const bytes = await got;
  c.destroy(); srv.close();
  return bytes;
}

/** A server that records the first bytes it gets: stands in for someone's server, or for Caddy. */
async function recorder() {
  const seen = [];
  const srv = netServer((s) => s.once('data', (d) => { seen.push(d); s.end('ok'); }));
  return { seen, port: await listen(srv), close: () => srv.close() };
}

test('reads the name out of a real ClientHello, and waits for more bytes when it is cut', async () => {
  const hello = await clientHello('thaituma.fatline.ink');
  assert.equal(parseSni(hello), 'thaituma.fatline.ink');
  assert.equal(parseSni(hello.subarray(0, 20)), undefined);
  assert.equal(parseSni(Buffer.from('GET / HTTP/1.1\r\n')), null);
});

test('reads Host and path from an HTTP head', () => {
  assert.deepEqual(parseHttpHead(Buffer.from('GET /.well-known/acme-challenge/x HTTP/1.1\r\nHost: Aenon.fatline.ink:80\r\n\r\n')), { host: 'aenon.fatline.ink', path: '/.well-known/acme-challenge/x' });
  assert.equal(parseHttpHead(Buffer.from('GET / HTTP/1.1\r\nHost: a')), undefined);
});

test('never routes to private or loopback addresses; names pointing at this server go to its own Caddy', () => {
  for (const h of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', 'localhost', '::1']) assert.ok(isPrivate(h), h);
  for (const h of ['5.161.241.24', '178.156.213.112']) assert.ok(!isPrivate(h), h);
  const ctx = { table: new Map([['thaituma', '5.161.241.24'], ['fatline', '46.225.208.199'], ['evil', '169.254.169.254']]), domain: 'fatline.ink', self: new Set(['46.225.208.199']) };
  assert.equal(resolve('thaituma.fatline.ink', ctx), '5.161.241.24');
  assert.equal(resolve('fatline.fatline.ink', ctx), 'self');
  assert.equal(resolve('46-225-208-199.sslip.io', ctx), 'self');
  assert.equal(resolve('www.fatline.ink', ctx), 'self'); // www is fatline.ink itself, never a surname
  assert.equal(resolve('evil.fatline.ink', ctx), null);
  assert.equal(resolve('nobody.fatline.ink', ctx), null);
  assert.equal(resolve('a.b.fatline.ink', ctx), 'self');
});

test('end to end: https passes through untouched to the right server; http too; its own names get sent to https', async () => {
  const theirs = await recorder(); // someone's server (TLS and HTTP on one port, for the test)
  const caddy = await recorder(); // this server's Caddy
  const names = httpServer((req, res) => res.end(JSON.stringify({ names: [{ label: 'thaituma', host: '127.0.0.1' }] })));
  const namesPort = await listen(names);
  const r = startRouter({
    namesUrl: `http://127.0.0.1:${namesPort}/names`, self: ['46.225.208.199'], httpPort: 0, tlsPort: 0,
    caddyHttp: `127.0.0.1:${caddy.port}`, caddyTls: `127.0.0.1:${caddy.port}`, targetHttpPort: theirs.port, targetTlsPort: theirs.port,
    allowPrivate: true, log: () => {},
  });
  await r.ready;
  const send = (port, bytes) => new Promise((ok) => { const c = connect(port, '127.0.0.1', () => c.write(bytes)); let out = ''; c.on('data', (d) => (out += d)); c.on('close', () => ok(out)); c.on('error', () => ok(out)); });

  // https for a name: the ClientHello arrives at their server byte for byte.
  const hello = await clientHello('thaituma.fatline.ink');
  assert.equal(await send(r.tls.address().port, hello), 'ok');
  assert.ok(theirs.seen.at(-1).equals(hello), 'their server got the exact bytes');

  // https for this server's own name: to Caddy.
  const own = await clientHello('46-225-208-199.sslip.io');
  await send(r.tls.address().port, own);
  assert.ok(caddy.seen.at(-1).equals(own));

  // https for a name nobody holds: closed.
  const before = theirs.seen.length + caddy.seen.length;
  assert.equal(await send(r.tls.address().port, await clientHello('nobody.fatline.ink')), '');
  assert.equal(theirs.seen.length + caddy.seen.length, before);

  // http for a name: to their server (their Caddy answers its own certificate challenge).
  const challenge = 'GET /.well-known/acme-challenge/abc HTTP/1.1\r\nHost: thaituma.fatline.ink\r\n\r\n';
  assert.equal(await send(r.http.address().port, challenge), 'ok');
  assert.equal(theirs.seen.at(-1).toString(), challenge);

  // http for this server's own name: challenges to Caddy, everything else to https.
  await send(r.http.address().port, 'GET /.well-known/acme-challenge/x HTTP/1.1\r\nHost: 46-225-208-199.sslip.io\r\n\r\n');
  assert.match(caddy.seen.at(-1).toString(), /acme-challenge\/x/);
  assert.match(await send(r.http.address().port, 'GET /eggs/1 HTTP/1.1\r\nHost: 46-225-208-199.sslip.io\r\n\r\n'), /301[\s\S]*location: https:\/\/46-225-208-199\.sslip\.io\/eggs\/1/);
  assert.match(await send(r.http.address().port, 'GET / HTTP/1.1\r\nHost: nobody.fatline.ink\r\n\r\n'), /404/);

  r.close(); names.close(); theirs.close(); caddy.close();
});

test('a server that does not answer: this server stands in for its name, then hands it back once it answers', async () => {
  const caddy = await recorder();
  const later = await recorder(); // their server, back again
  const closed = netServer(); const deadPort = await listen(closed); closed.close(); // nothing listens here now
  const names = httpServer((req, res) => res.end(JSON.stringify({ names: [{ label: 'thaituma', host: '127.0.0.1' }] })));
  const namesPort = await listen(names);
  const logs = [];
  const opts = {
    namesUrl: `http://127.0.0.1:${namesPort}/names`, httpPort: 0, tlsPort: 0,
    caddyHttp: `127.0.0.1:${caddy.port}`, caddyTls: `127.0.0.1:${caddy.port}`, allowPrivate: true, log: (l) => logs.push(l),
  };
  const send = (port, bytes) => new Promise((ok) => { const c = connect(port, '127.0.0.1', () => c.write(bytes)); let out = ''; c.on('data', (d) => (out += d)); c.on('close', () => ok(out)); c.on('error', () => ok(out)); });
  const hello = await clientHello('thaituma.fatline.ink');

  const r = startRouter({ ...opts, targetHttpPort: deadPort, targetTlsPort: deadPort, downMs: 60_000 });
  await r.ready;
  assert.equal(await send(r.tls.address().port, hello), 'ok');
  assert.ok(caddy.seen.at(-1).equals(hello), 'Caddy got the exact bytes');
  const challenge = 'GET /.well-known/acme-challenge/t HTTP/1.1\r\nHost: thaituma.fatline.ink\r\n\r\n';
  assert.equal(await send(r.http.address().port, challenge), 'ok');
  assert.equal(caddy.seen.at(-1).toString(), challenge, 'its certificate challenge reaches this Caddy too');
  assert.equal(logs.filter((l) => /did not answer/.test(l)).length, 1, 'said once, not per connection: ' + logs.join(' / '));
  r.close();

  // downMs over and their server answers again: straight to it.
  const r2 = startRouter({ ...opts, targetHttpPort: later.port, targetTlsPort: later.port, downMs: 0 });
  await r2.ready;
  const n = caddy.seen.length;
  assert.equal(await send(r2.tls.address().port, hello), 'ok');
  assert.ok(later.seen.at(-1).equals(hello));
  assert.equal(caddy.seen.length, n);
  r2.close(); names.close(); caddy.close(); later.close();
});
