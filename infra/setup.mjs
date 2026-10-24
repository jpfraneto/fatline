#!/usr/bin/env node
// fatline setup: the whole path, one step at a time. Before each step it says what the step does, what it
// costs and how long it takes, then asks: Enter to go, s to skip, q to stop. Run it again and it picks up
// where you stopped (.fatline/setup.json). It only calls the normal fatline commands, so every step can
// also be run by hand.
//
// It opens with the license (MIT: read it, change it, share it; asked once) and the Farcaster arch
// (infra/arch.mjs). When you stop or a step fails, it links to that step's code so you can improve it.
//
//   fatline setup            guided, in a terminal
//   fatline setup --plan     where you are, and the exact command for each step (for people and agents)
//   fatline setup --reset    forget the progress (rents and files are untouched)
//
// First it asks where your node will live:
//   cloud    a server rented by the day in USDC (x402, AgentMetal). No account, no card: you approve with your own
//            wallet, by QR code on your phone or in a browser wallet. ~11 USDC a day.
//   hetzner  your own Hetzner Cloud account (API token, card, billed by the hour). ~$2.60 a day per node.
//   vps      a server you already have, at any provider: Fatline checks it can hold a node.
//   local    this machine, with Docker (needs ~700 GB free disk and 8–16 GB RAM; fatline doctor checks).
//   light    no node: copy only the accounts you choose from a public node, read them here. Free.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { playArch } from './arch.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = join(ROOT, '.fatline');
const FILE = process.env.FATLINE_SETUP_FILE ?? join(STATE_DIR, 'setup.json'); // overridable for tests
const args = process.argv.slice(2);
// The light path reads one public node; the operators of each network run these.
const PUBLIC = { farcaster: 'crackle', hypersnap: 'haatz' };
const REPO = 'https://github.com/jpfraneto/fatline';

const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { done: [] });
const save = (s) => { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(s, null, 2) + '\n'); };
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const bold = (t) => (color ? `\x1b[1m${t}\x1b[0m` : t);
const dim = (t) => (color ? `\x1b[2m${t}\x1b[0m` : t);

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => {
    let answered = false;
    rl.on('close', () => { if (!answered) { process.stdout.write('\n'); r('q'); } }); // input ended: stop, don't guess
    rl.question(q, (a) => { answered = true; rl.close(); r(a.trim()); });
  });
}
/** Hidden input, for the Hetzner token. Nothing is echoed. */
function askHidden(q) {
  return new Promise((r) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (t) => { if (t.includes(q)) rl.output.write(t); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); r(a.trim()); });
  });
}
const fatline = (...a) => spawnSync(join(ROOT, 'fatline'), a, { stdio: 'inherit', cwd: ROOT }).status === 0;
const rented = () => ['compute.json', 'hetzner.json', 'vps.json'].some((f) => existsSync(join(STATE_DIR, f)));
const PATHS = ['cloud', 'hetzner', 'vps', 'local', 'light'];

async function nodeInfo(url) {
  try { const r = await fetch(`${url}/v1/info`, { signal: AbortSignal.timeout(8000) }); return r.ok ? await r.json() : null; } catch { return null; }
}
function ownNodeUrl(network) {
  try {
    const c = JSON.parse(readFileSync(join(ROOT, 'fatline.config.json'), 'utf8'));
    return c.networks?.[network]?.nodes?.find((n) => n.own)?.url ?? null;
  } catch { return null; }
}

// ---------------------------------------------------------------- the steps
// Each: id, title, what (one or two lines), cost, cmd (what you'd type by hand), run (returns true when done).
function steps(s) {
  const net = s.network ?? 'farcaster';
  const nodeName = net === 'farcaster' ? 'snapchain' : net; // both are Farcaster nodes; the command names the software
  const common = {
    check: {
      title: 'Check this machine',
      what: 'Measures CPU, memory, disk, Docker and Node.js, and pings the public nodes of both networks.',
      cost: 'free, a few seconds',
      cmd: 'fatline doctor',
      run: () => { fatline('doctor'); return true; }, // it advises; the choice is yours
    },
    connect: {
      title: 'You are your FID',
      what: 'A QR code appears. Scan it with your phone and sign in with the Farcaster app: it signs with the address that owns your account, and a node confirms which FID that is. No seed phrase. No account? Skip it: you can keep a node as a worker (fatline worker new).',
      cost: 'free, a minute',
      cmd: 'fatline connect',
      run: () => fatline('connect'),
    },
    choose: {
      title: 'Where will your node live?',
      what: [
        'A node keeps a full copy of the network: about 600 GB of disk and 8–16 GB of RAM, always on.',
        '    cloud    rented by the day, paid in USDC from your own wallet (QR code or browser wallet). No account, no card. ~11 USDC/day',
        '    hetzner  your own Hetzner Cloud account: API token and card, billed by the hour. ~$2.60/day per node',
        '    vps      a server you already have, at any provider (DigitalOcean, OVH, Contabo, a box at home…)',
        '    local    this machine, with Docker (the check above says if it fits)',
        '    light    no node: copy only the accounts you choose from a public node. Free',
      ].join('\n'),
      cost: 'free',
      cmd: '(a choice: cloud, hetzner, vps, local or light; and snapchain or hypersnap)',
      run: async () => {
        const p = (await ask('  Where? [cloud / hetzner / vps / local / light] (cloud): ')).toLowerCase() || 'cloud';
        if (!PATHS.includes(p)) { console.log(`  Choose one of: ${PATHS.join(', ')}.`); return false; }
        let n = (await ask('  Which node? [snapchain / hypersnap] (snapchain): ')).toLowerCase() || 'snapchain';
        if (n === 'snapchain') n = 'farcaster'; // the network's name inside the config
        if (!['farcaster', 'hypersnap'].includes(n)) { console.log('  Choose snapchain or hypersnap.'); return false; }
        s.path = p; s.network = n; save(s);
        return true;
      },
    },
  };
  const cloud = {
    quote: {
      title: 'See the price',
      what: 'Asks AgentMetal for a server (4 CPUs, 8 GB RAM) plus a 700 GB disk for one day, paid in USDC on Base (x402). Nothing is signed.',
      cost: 'free',
      cmd: 'fatline compute --quote',
      run: () => fatline('compute', '--quote'),
    },
    rent: {
      title: 'Rent it, approving with your wallet',
      what: 'Type "pay", then choose how to approve: scan a QR code with your phone wallet, or connect a wallet extension in your browser. Your wallet shows each payment (server, then disk) before you approve it. No ETH needed. Prepaid; it stops by itself when the day ends (fatline compute renew --days N adds days).',
      cost: 'the price you just saw (~11 USDC)',
      cmd: 'fatline compute',
      run: () => fatline('compute') && rented(),
    },
  };
  const hetzner = {
    token: {
      title: 'Connect your Hetzner account',
      what: 'Fatline rents the server with your own Hetzner API token. Make one at console.hetzner.cloud → your project → Security → API tokens (Read & Write). It is saved to ~/.hetzner-token (mode 600) and never printed.',
      cost: 'free (Hetzner needs a card on the account)',
      cmd: 'save the token to ~/.hetzner-token (chmod 600)',
      run: async () => {
        const file = join(homedir(), '.hetzner-token');
        if (process.env.HETZNER_TOKEN || existsSync(file)) { console.log('  A token is already there.'); return true; }
        const t = await askHidden('  Paste the token (hidden): ');
        if (!t) return false;
        writeFileSync(file, t + '\n', { mode: 0o600 });
        console.log('  Saved to ~/.hetzner-token.');
        return true;
      },
    },
    quote: {
      title: 'See the price',
      what: 'Asks Hetzner which server fits a node right now and what it costs. Nothing is created.',
      cost: 'free',
      cmd: 'fatline compute hetzner --quote --no-node',
      run: () => fatline('compute', 'hetzner', '--quote', '--no-node'),
    },
    rent: {
      title: 'Rent the server',
      what: 'Creates the server and a 700 GB disk on your account. It asks you to type "create" first. Hetzner bills by the hour until you run: fatline compute hetzner down',
      cost: 'the price you just saw, by the hour',
      cmd: 'fatline compute hetzner --no-node',
      run: () => fatline('compute', 'hetzner', '--no-node') && rented(),
    },
  };
  const vps = {
    host: {
      title: 'Your server',
      what: 'The address of a server you already have (root login). Fatline adds its own SSH key there (ssh asks for the password once, in its own prompt) and checks it has the RAM and ~650 GB free disk a node needs.',
      cost: 'free',
      cmd: 'fatline compute vps root@<ip>',
      run: async () => {
        const host = await ask('  Server? (root@1.2.3.4): ');
        return Boolean(host) && fatline('compute', 'vps', host.includes('@') ? host : `root@${host}`);
      },
    },
  };
  const remote = {
    node: {
      title: `Install your ${nodeName} node on it`,
      what: 'Copies the setup script to the server and streams the network snapshot (~400 GB) straight to its disk. You can Ctrl-C: the setup keeps going on the server, and this step follows it again when you come back.',
      cost: '1–3 hours',
      cmd: `fatline node ${nodeName}`,
      run: () => fatline('node', nodeName),
    },
  };
  const local = {
    node: {
      title: `Run your ${nodeName} node on this machine`,
      what: `Downloads the official ${net === 'farcaster' ? 'Snapchain' : 'Hypersnap'} bootstrap script, shows where it is so you can read it, and runs it with Docker after you say yes.`,
      cost: 'free; hours of download; ~1 TB disk',
      cmd: `fatline node ${nodeName} --local`,
      run: () => fatline('node', nodeName, '--local'),
    },
  };
  const nodePaths = {
    sync: {
      title: 'Wait until your node is in sync',
      what: 'Checks your node every minute until every shard is a few blocks behind or less. Our last run: 3.5 hours from paying to in sync. Your client already works meanwhile, and your egg is already warming. You can stop and come back: run fatline setup again.',
      cost: 'time only',
      cmd: 'fatline status',
      run: async () => {
        const url = ownNodeUrl(net);
        if (!url) { console.log('  No node of yours in fatline.config.json yet. Finish the node step first.'); return false; }
        for (;;) {
          const i = await nodeInfo(url);
          const behind = i?.shardInfos?.length ? Math.max(...i.shardInfos.map((x) => Number(x.blockDelay ?? Infinity))) : null;
          console.log(`  ${new Date().toISOString().slice(11, 16)} UTC  ${i ? `${behind} blocks behind (worst shard)` : 'not answering yet'}`);
          if (behind !== null && behind <= 50) return true;
          await new Promise((r) => setTimeout(r, 60_000));
        }
      },
    },
  };
  const egg = {
    egg: {
      title: 'Lay your egg: a Fatliner hatches after three warm days',
      what: 'Puts a hatchery next to your node (a small service with its own key), gives this client an app key if it has none (fatline identity: your seed phrase in a hidden prompt, here, never saved), then lays your egg, signed with that key. Lay it now, while the node syncs: warmth counts from the hour the node starts catching up. Servers that already hatched check your node every hour; after three warm days your Fatliner is born to you, free, and your server becomes one of them. Skip it if you only want the node.',
      cost: 'free; but your server must keep running those days (that is what you pay for)',
      cmd: 'fatline hatchery install && fatline identity && fatline egg lay',
      run: () => fatline('hatchery', 'install')
        && (existsSync(join(STATE_DIR, 'appkey.json')) || fatline('identity'))
        && fatline('egg', 'lay')
        && (console.log('  Watch it: fatline egg. When it hatches: fatline hatch.'), true),
    },
  };
  const light = {
    follow: {
      title: 'Copy the accounts you care about',
      what: 'Copies the accounts you name (FIDs or @names), and everyone they follow if you want, from one public node into a local archive. This is not a node: it trusts that node.',
      cost: 'free; minutes',
      cmd: `fatline follow <fid|@name> --following --network ${net} --node ${PUBLIC[net]} --once`,
      run: async () => {
        const who = (await ask('  Which accounts? (FIDs or @names, space-separated) : ')).split(/\s+/).filter(Boolean);
        if (!who.length) return false;
        const more = (await ask('  Also everyone they follow? [y/N]: ')).toLowerCase() === 'y';
        console.log(`  Reading from ${PUBLIC[net]}, a public ${net} node (not yours, not ours). Another: --node <name|URL>.`);
        return fatline('follow', ...who, ...(more ? ['--following'] : []), '--network', net, '--node', PUBLIC[net], '--once');
      },
    },
    feed: {
      title: 'Read your timeline',
      what: 'Prints the newest casts from your copy alone: no node, no network, no keys.',
      cost: 'free',
      cmd: 'fatline feed --limit 20',
      run: () => fatline('feed', '--limit', '20'),
    },
  };
  const end = {
    client: {
      title: 'Start your client',
      what: `Builds the web app and serves it at http://localhost:8787, reading ${s.path === 'light' ? 'from the node you chose' : 'from your own node'}. It stays running in this terminal; Ctrl-C stops it, fatline up starts it again.`,
      cost: 'free',
      cmd: `fatline init --network ${net} && fatline up`,
      run: () => fatline('init', '--network', net, ...(s.path === 'light' ? ['--node', ''] : [])) && (s.done.push('client'), save(s), console.log(bold('\n  Setup is done. Starting the client (Ctrl-C to stop).\n  Later: post as yourself with fatline identity --fid <your FID>, in your own terminal (seed phrase in a hidden prompt, never in a chat).' + ({ rent: '\n  The server stops when its paid days end. More days: fatline compute renew --days N', cloud: '\n  The server stops when its paid days end. More days: fatline compute renew --days N', hetzner: '\n  Stop paying for the server: fatline compute hetzner down' }[s.path] ?? '') + '\n')), fatline('up'), process.exit(0)),
    },
  };
  const kind = s.path === 'rent' ? 'cloud' : s.path; // 'rent' was the old name of cloud
  const path = kind === 'local' ? { ...local, ...nodePaths } : kind === 'light' ? light
    : { ...({ cloud, hetzner, vps }[kind] ?? cloud), ...remote, ...egg, ...nodePaths };
  return Object.entries({ ...common, ...path, ...end }).map(([id, x]) => ({ id, ...x }));
}

// ---------------------------------------------------------------- main
const s = load();
if (args.includes('--reset')) { rmSync(FILE, { force: true }); console.log('Setup progress forgotten. Nothing rented or saved was touched.'); process.exit(0); }

const list = steps(s);
if (args.includes('--plan')) {
  console.log(bold(`Fatline setup · path: ${s.path ?? 'not chosen yet'} · network: ${s.network ?? 'not chosen yet'}\n`));
  let next = null;
  for (const [i, st] of list.entries()) {
    const done = s.done.includes(st.id);
    if (!done && !next) next = st;
    console.log(`${done ? '✓' : next === st ? '→' : ' '} ${i + 1}. ${st.title}  ${dim(st.cost)}\n     ${st.cmd}`);
  }
  if (!s.path) console.log(dim('\nThe steps after "Where will your node live?" depend on the answer. Guided: fatline setup'));
  process.exit(0);
}
if (!process.stdin.isTTY) {
  console.log('fatline setup asks questions, so it needs a terminal. To see the steps and their commands: fatline setup --plan');
  process.exit(1);
}

/** Where a step lives in this file, so whoever stops on it can go and change it. */
function stepLink(st) {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  const section = st.id === 'node' && s.path === 'local' ? 'local' : null;
  const from = section ? src.findIndex((l) => l.includes(`const ${section} = {`)) : 0;
  const k = src.findIndex((l, i) => i >= from && new RegExp(`^\\s+${st.id}: \\{`).test(l));
  return `${REPO}/blob/main/infra/setup.mjs${k >= 0 ? `#L${k + 1}` : ''}`;
}
function contribute(st) {
  console.log(`
  This setup is open source, and it's yours to make better. If this step was confusing, slow or missing
  something, change it:
    ${st ? `this step's code:  ${stepLink(st)}\n    ` : ''}edit it on GitHub: ${REPO}/edit/main/infra/setup.mjs
    or just tell us:   ${REPO}/issues/new
  ${dim('GitHub opens the file in its editor, makes your own copy, and sends your change to us as a pull request.')}
`);
}

// The welcome: what this is, and the license you're agreeing to. Asked once; then the arch.
if (!s.agreed) {
  console.log(`
  ${bold('FATLINE')}  ·  your own Farcaster node and your own client

  Everything you are about to run is open source, under the MIT license:
    ${REPO}
  You can read every line, change it, and share it. It comes as is, with no warranty.
  Each step tells you what it does before it runs, and nothing costs money until you say so.
`);
  const a = (await ask('  [Enter] I agree, let\'s begin · q quit: ')).toLowerCase();
  if (a === 'q') {
    console.log('\n  Nothing was changed. The code is in this folder whenever you want to read it.');
    contribute();
    process.exit(0);
  }
  s.agreed = new Date().toISOString(); save(s);
}
await playArch();

console.log(bold('\nFatline setup') + dim(`  ·  progress is saved; run fatline setup again to continue  ·  fatline setup --plan shows every step\n`));
for (let i = 0; ; i++) {
  const all = steps(s); // the list changes once a path is chosen
  const st = all.find((x) => !s.done.includes(x.id));
  if (!st) { console.log('Every step is done. Start the client any time with fatline up'); break; }
  const n = all.indexOf(st) + 1;
  console.log(`\n${bold(`Step ${n} of ${all.length}: ${st.title}`)}\n  ${st.what}\n  ${dim(`Cost: ${st.cost}.  By hand: ${st.cmd}`)}`);
  const a = (await ask('  [Enter] go · s skip · q stop: ')).toLowerCase();
  if (a === 'q') { console.log(`\nStopped before "${st.title}". Run fatline setup to continue from here.`); contribute(st); break; }
  if (a === 's') { s.done.push(st.id); save(s); console.log('  Skipped.'); continue; }
  const ok = await st.run();
  if (ok) { s.done.push(st.id); save(s); console.log(`  ✓ ${st.title}`); }
  else { console.log(`\n"${st.title}" didn't finish. Fix what it says above, then run fatline setup to try this step again.`); contribute(st); process.exit(1); }
}
