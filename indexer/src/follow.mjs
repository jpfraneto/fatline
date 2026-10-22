// ./infinicaster follow: keep a local archive of only the accounts you choose, read from one node.
//
//   ./infinicaster follow <fid|@name>... [--network farcaster|hypersnap] [--node URL|name] [--following] [--once]
//   ./infinicaster follow list
//
// --network    which network to read (default: the one chosen with ./infinicaster init)
// --node       which of that network's nodes in infinicaster.config.json to read, by URL or by a word of its
//              name or host (e.g. crackle, haatz, master). Default: the first one listed. Only that node is read.
// --following  also add every account the named accounts follow (as that node knows it)
// --once       copy what the node has now, catch up with its new events, then exit. Without it, it keeps following.
//
// This is not a node. A Snapchain or Hypersnap node checks every message itself and keeps all accounts. Since
// copying a whole node is blocked today (both networks' replication refuses KeyAdd messages), this is the small
// option: an archive of a few accounts, as one node reports them.
import { Archive } from './archive.mjs';
import { loadConfig } from './config.mjs';
import { openDb } from './db.mjs';
import { SnapchainAdapter } from './adapters/snapchain.mjs';

const NOT_A_NODE = [
  'This is not a node. It copies the accounts you chose from one node, and:',
  '  - trusts that node: it does not check message signatures or signer keys itself;',
  '  - does not join the network, and does not help it;',
  '  - is only as complete and as recent as that node. If the node is behind, so is this.',
];

const argv = process.argv.slice(2);
const flags = new Set(['--following', '--once', '--help']);
const valueFlags = new Set(['--network', '--node']);
const opt = {};
const names = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (flags.has(a)) opt[a.slice(2)] = true;
  else if (valueFlags.has(a)) opt[a.slice(2)] = argv[++i];
  else if (a.startsWith('--')) die(`Unknown option ${a}. See: ./infinicaster follow --help`);
  else names.push(a);
}

function die(msg) { console.error(msg); process.exit(1); }

const config = loadConfig();
const archive = new Archive(openDb(config.dataDir));

if (names[0] === 'list') {
  const fids = archive.fids();
  console.log(fids.length ? `Following ${fids.length} account(s): ${fids.join(', ')}` : 'Following no accounts yet.');
  process.exit(0);
}
if (!names.length || opt.help || names[0] === 'help') {
  console.log(`Usage: ./infinicaster follow <fid|@name>... [--network farcaster|hypersnap] [--node URL|name] [--following] [--once]
       ./infinicaster follow list

${NOT_A_NODE.join('\n')}`);
  process.exit(opt.help || names.length ? 0 : 1);
}

const network = opt.network ?? config.defaultNetwork;
const net = config.networks[network];
if (!net) die(`Unknown network "${network}". Known: ${Object.keys(config.networks).join(', ')}`);
const node = pickNode(net, opt.node);
const label = node.own ? `${net.label ?? network} (own node)` : `${net.label ?? network} · ${new URL(node.url).hostname}`;
const others = net.nodes.filter((n) => n.url.replace(/\/$/, '') !== node.url).map((n) => n.label ?? n.url);

console.log(NOT_A_NODE.join('\n'));
console.log(`\nReading ${net.label ?? network} only from ${node.label ?? node.url}${node.own ? ' (yours)' : ' (public)'}. It never switches to another node.`);
if (others.length) console.log(`Other nodes in your config (choose with --node): ${others.join(', ')}`);

const adapter = new SnapchainAdapter({ archive, network, nodeUrl: node.url, label, log: (m) => console.log(`  ${m}`) });

// The node must answer before anything is added. A node that is behind is used, and said to be behind.
let info;
try { info = await adapter.get('/v1/info'); } catch (err) { die(`\n${err.message}\nNothing was changed. Start that node, or choose another with --node.`); }
const behind = Math.max(0, ...(info.shardInfos ?? []).filter((s) => s.shardId !== 0).map((s) => Number(s.blockDelay ?? 0)));
console.log(behind > 200
  ? `Warning: this node is ${behind.toLocaleString('en')} blocks behind the network, so its newest messages are old.`
  : `The node is in sync (at most ${behind} blocks behind).`);

// Names to FIDs, through the same node.
const fids = [];
for (const n of names) {
  if (/^\d+$/.test(n)) { fids.push(Number(n)); continue; }
  const name = n.replace(/^@/, '').toLowerCase();
  let proof = null;
  try { proof = await adapter.get('/v1/userNameProofByName', { name }); } catch (err) {
    if (err.offline) die(err.message);
  }
  if (!proof?.fid) die(`${node.label ?? node.url} doesn't know the name @${name}. Use the FID instead.`);
  console.log(`@${name} is FID ${proof.fid} (according to this node).`);
  fids.push(Number(proof.fid));
}

if (opt.following) {
  for (const fid of [...fids]) {
    const follows = await followsOf(fid);
    console.log(`FID ${fid} follows ${follows.length} account(s) on this node; adding them.`);
    for (const f of follows) if (!fids.includes(f)) fids.push(f);
  }
}

for (const fid of fids) archive.track(fid);
await adapter.start();
console.log(`\nFollowing ${archive.fids().length} account(s) in ${config.dataDir}/indexer.sqlite.`);

const countEvents = () => archive.db.prepare('SELECT COUNT(*) AS n FROM fl_events WHERE source_id = ?').get(adapter.sourceId).n;

if (opt.once) {
  const started = Date.now();
  const before = countEvents();
  // A page can time out on a slow or catching-up node. Retry on the same node; the backfill resumes where it was.
  let r;
  for (let attempt = 1; ; attempt++) {
    try { r = await adapter.round(); break; } catch (err) {
      if (attempt >= 3) die(`Stopped after 3 tries: ${err.message}\nRun the same command again to resume.`);
      console.log(`  ${err.message}\n  Trying again on the same node (${attempt}/3)…`);
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  // Counted in the archive, so pages saved before a retry count too.
  console.log(`Done in ${secs} s: ${(countEvents() - before).toLocaleString('en')} new rows in the archive (${r.ingested} of them live events), for ${r.fids} account(s).`);
  const rows = archive.db.prepare(`SELECT fid, COUNT(*) AS n FROM fl_events WHERE source_id = ? AND fid IN (${fids.map(() => '?').join(',')}) GROUP BY fid`)
    .all(adapter.sourceId, ...fids);
  for (const { fid, n } of rows) console.log(`  FID ${fid}: ${n} events from this node in the archive`);
} else {
  console.log('Copying, then following new events. Ctrl+C to stop; run it again to continue where it was.');
  const stop = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop.abort());
  await adapter.run({ signal: stop.signal });
}

function pickNode(net, want) {
  const nodes = net.nodes.map((n) => ({ ...n, url: n.url.replace(/\/$/, '') }));
  if (!want) return nodes[0] ?? die(`No ${net.label} node in infinicaster.config.json. Add one, or run ./infinicaster node.`);
  const w = want.replace(/\/$/, '').toLowerCase();
  const exact = nodes.find((n) => n.url.toLowerCase() === w);
  if (exact) return exact;
  const hits = nodes.filter((n) => `${n.label ?? ''} ${new URL(n.url).hostname}`.toLowerCase().includes(w));
  if (hits.length === 1) return hits[0];
  if (/^https?:\/\//.test(w)) return { url: want.replace(/\/$/, ''), own: false, label: new URL(want).hostname };
  die(hits.length
    ? `"${want}" matches more than one node: ${hits.map((n) => n.label ?? n.url).join(', ')}. Be more specific.`
    : `No ${net.label} node matches "${want}". Known: ${nodes.map((n) => n.label ?? n.url).join(', ')}`);
}

async function followsOf(fid) {
  const out = [];
  let pageToken;
  do {
    const page = await adapter.get('/v1/linksByFid', { fid, link_type: 'follow', page_size: 1000, pageToken });
    for (const m of page.messages ?? []) {
      const t = m.data?.linkBody?.targetFid;
      if (t) out.push(Number(t));
    }
    pageToken = page.nextPageToken || undefined;
  } while (pageToken);
  return [...new Set(out)];
}
