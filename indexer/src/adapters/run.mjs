// Runs one Farline network adapter: one network, one node, its own cursor.
//
//   node src/adapters/run.mjs --network farcaster [--node URL] [--fid 18350] [--once]
//
// --node     the node to read. Default: the first node listed for that network in infinicaster.config.json.
//            The adapter reads only this node. It never switches to another one.
// --fid      also archive this FID (it is remembered). The client's own FID is added by the server.
// --once     one round (backfill + catch up), then exit. Without it, it keeps tailing.
import { Archive } from '../archive.mjs';
import { loadConfig } from '../config.mjs';
import { openDb } from '../db.mjs';
import { SnapchainAdapter } from './snapchain.mjs';

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

const config = loadConfig();
const network = flag('network') ?? config.defaultNetwork;
const net = config.networks[network];
if (!net) { console.error(`Unknown network "${network}". Known: ${Object.keys(config.networks).join(', ')}`); process.exit(1); }
const nodeUrl = flag('node') ?? net.nodes[0]?.url;
if (!nodeUrl) { console.error(`No node for ${network}. Pass --node URL.`); process.exit(1); }

const archive = new Archive(openDb(config.dataDir));
const fid = flag('fid');
if (fid) archive.track(Number(fid));

const adapter = new SnapchainAdapter({
  archive, network, nodeUrl, label: `${net.label ?? network} node ${nodeUrl}`,
  log: (m) => console.log(new Date().toISOString(), m),
});
console.log(`Farline adapter: network=${network}, reading only ${nodeUrl}, FIDs ${JSON.stringify(archive.fids())}, archive ${config.dataDir}`);

if (argv.includes('--once')) {
  const r = await adapter.round();
  console.log(`Done: ${r.backfilled} messages backfilled, ${r.ingested} new events, for ${r.fids} FID(s).`);
} else {
  const stop = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop.abort());
  await adapter.run({ signal: stop.signal });
}
