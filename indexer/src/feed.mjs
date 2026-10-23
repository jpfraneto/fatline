// fatline feed: a timeline built from the local SQL archive alone. No node, no network, no keys.
// The archive holds only the accounts you chose (fatline follow), so this is a slice, not the network.
import { Archive } from './archive.mjs';
import { loadConfig } from './config.mjs';
import { openDb } from './db.mjs';

const argv = process.argv.slice(2);
const opt = {};
const num = (s) => (Number.isFinite(Number(s)) ? Number(s) : undefined);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--limit') opt.limit = num(argv[++i]);
  else if (a === '--before') opt.before = argv[++i];
  else if (a === '--fids') opt.fids = String(argv[++i]).split(',').map(Number).filter(Number.isSafeInteger);
  else if (a === '--json') opt.json = true;
  else if (a === '--stats') opt.stats = true;
  else if (a === '--replies') opt.replies = true;
  else if (a === '--help' || a === '-h') opt.help = true;
  else { console.error(`Unknown option ${a}. See: fatline feed --help`); process.exit(1); }
}

const config = loadConfig();
const archive = new Archive(openDb(config.dataDir));

if (opt.help) {
  console.log(`Usage: fatline feed [--limit N] [--before <cursor>] [--fids 1,2] [--replies] [--json] [--stats]

Reads only the local SQL archive. No node, no network, no API keys.
It is a slice: only the accounts fatline follow copied.

  --limit N     how many casts (default 30, max 200)
  --before X    continue from a previous run's "Next page" cursor
  --fids 1,2    only these authors
  --replies     include replies (default: top-level casts only)
  --json        machine-readable, for a client
  --stats       what the archive holds, then exit`);
  process.exit(0);
}

if (opt.stats) {
  const fids = archive.fids();
  const m = archive.db.prepare("SELECT COUNT(*) AS n FROM fl_messages WHERE status = 'merged'").get().n;
  const c = archive.db.prepare("SELECT COUNT(*) AS n FROM fl_messages WHERE status = 'merged' AND msg_type = 'MESSAGE_TYPE_CAST_ADD'").get().n;
  const newest = archive.db.prepare("SELECT MAX(protocol_ts) AS t FROM fl_messages WHERE msg_type = 'MESSAGE_TYPE_CAST_ADD'").get().t;
  console.log(`Archive: ${fids.length} account(s), ${m.toLocaleString('en')} live message(s), ${c.toLocaleString('en')} of them casts.`);
  console.log(`Sources: ${archive.sources().map((s) => `${s.label} (${s.network})`).join(', ') || 'none'}`);
  if (newest) console.log(`Newest cast: ${new Date(newest).toISOString()}`);
  process.exit(0);
}

const tracked = archive.fids();
if (!tracked.length) {
  console.error('The archive is empty. Run: fatline follow <fid> --following --followers');
  process.exit(1);
}

const { items: shown, authors, more: next } = archive.feed({
  before: opt.before,
  limit: opt.limit ?? 30,
  fids: opt.fids?.length ? opt.fids : null,
  replies: Boolean(opt.replies),
});

if (opt.json) { console.log(JSON.stringify({ items: shown, authors, more: next }, null, 2)); process.exit(0); }

const ago = (ms) => {
  const s = (Date.now() - ms) / 1000;
  return s < 60 ? `${Math.floor(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
for (const it of shown) {
  const a = authors[it.fid] ?? {};
  const where = Object.entries(it.networks).filter(([, st]) => st === 'merged').map(([n]) => n).join(' + ') || '?';
  console.log(`${a.username ? `@${a.username}` : `fid ${it.fid}`}${a.display ? ` (${a.display})` : ''} · ${ago(it.at)} ago · ${where}${it.body?.parent ? ' · reply' : ''}`);
  console.log(`  ${String(it.body?.text ?? '').replace(/\s+/g, ' ').slice(0, 240)}`);
}
console.log(`\n${shown.length} cast(s) from ${new Set(shown.map((i) => i.fid)).size} author(s); ${tracked.length} account(s) tracked.`);
if (next) console.log(`Next page: fatline feed --before ${next}`);
