# Master prompt: win the bounty, ship the launchpad

Read this before doing any work in this repository. It is the plan, the definition of done, and the rules. If something here turns out to be wrong, fix this file first, then the code.

**Deadline: the entry must be posted before 2026-10-24 14:47:30 UTC.** Aim to submit by 2026-10-24 06:00 UTC.

## The mission

Balaji's bounty ([the post](https://farcaster.xyz/balajis.eth/0x50184b62), $2,048 first place) pays for **the easiest path from nothing to your own Farcaster read node plus a working client**, in three commands:

0. Provision the compute with a script.
1. Set up a Snapchain read node. It must run with no API keys from anyone.
2. Create a client that reads from that node.

Fatline answers that, then goes one step further: **the client you just created can pay for its own life.** It gets a USDC vault that is fed by deposits or by its own coin's trading fees, launched on Clanker. That is the launchpad, and it is the last chapter of the tutorial, not a replacement for the first three.

Order of priority, always: **the bounty path works for a stranger > the tutorial teaches > the launchpad impresses.** A great launchpad on a broken client loses. The judges reject "AI slop" at their sole discretion, and the strongest signal is other humans vouching.

## What the judges will check

| # | Requirement (from the post) | Done when |
| --- | --- | --- |
| J1 | Quickstart with three commands at the top of a microsite | A stranger on a fresh machine runs exactly those commands. Prerequisites such as git, Node and a cloud account are listed honestly above them. |
| J2 | (0) Compute provisioned by a script | One command provisions a machine that **can hold a node**: 4 CPUs, 16 GB RAM, **2 TB disk** (Snapchain's own number). It prints the cost and how to shut it down. |
| J3 | (1) A read node with no API keys | It syncs every shard and reports progress. Healthy means `/v1/info` shows a small `blockDelay`; an open port is not enough. It survives a restart. |
| J4 | (2) A client reading from that node | Feed traffic goes only to the configured node. If the node is off, the app shows a clear error, never a silent hosted fallback. |
| J5 | Import an existing seed phrase and issue the client its own app key | Local tool, phrase never logged or stored. Derives custody, shows the FID, fails if they don't match. Registers the key. Waits until the key is visible on the node. |
| J6 | Post casts | The cast is submitted through our node, then read back by hash. The UI shows pending, then confirmed. |
| J7 | Follow / unfollow, like / unlike | Each one is confirmed by reading it back. The feed reflects it. |
| J8 | Include / exclude casts from any other client | Each cast's signer maps to the app FID that registered it. Filters work for at least two real apps. Casts from an unknown app follow a visible rule. |
| J9 | Tutorial, phone and desktop | It explains, as it goes: FIDs, custody addresses, app keys, Snapchain messages, read nodes vs validators (read nodes relay writes to validators), and storage rent vs server bills. |
| J10 | MIT GitHub repository | Public, MIT, with dependency licenses noted. Nothing secret committed. |
| J11 | At least one other human goes through it and vouches publicly on Farcaster | A real URL to their own post. **We never write it, post it, or invent it.** |
| J12 | Extra mile (optional) | Spanish tutorial (required by us anyway), Chinese, a 59-second vertical video, more vouchers. |

## Where we are (2026-10-23, ~16:00 UTC)

**Latest, on top of the notes below:**
- **2026-10-25 ~15:25 UTC: after @fatline moved, all checked.** The owner signed in to the Farcaster app with the phrase (it works; the app set primary address 0x0e82…C8d4). Mini app manifest re-signed by the new custody (`app-account.mjs manifest fatline.ink`; the old claim named the old key) and served by both hosts. Sign in with Farcaster: a live request from the server is accepted by Farcaster's SignedKeyRequestValidator on Optimism. The server's posting key (0x6bc6…, added by message, not onchain) still validates (`/v1/validateMessage`). Profile, username, picture unchanged on our node and crackle. Hatchery unchanged (attester 0x3775…3bAE, hourly checks continue). Open: the fname record still names the old owner address; harmless so far.
- **2026-10-25 15:15 UTC: @fatline (FID 3356653) moved to a recovery phrase** (owner's go; the Farcaster app said it "hasn't joined yet" and only signs in with a phrase). The owner made a 24-word phrase in their own terminal (indexer/src/app-custody.mjs new; never in a chat); IdRegistry.transfer tx 0x71f329fe…8a74 on Optimism; custody now 0xAE0C2ca1143930663002D13c97f62882d500ce8B (recovery unchanged: the keeper's warplet). The genesis server signs Sign in with Farcaster requests with /root/.fatline/app-custody.key (checked: signatures recover to the new address); attester.key is unchanged and is still the hatchery's key. Posting key, casts and the fname "fatline" are unchanged (the fname record still names the old owner address; if the Farcaster app complains, set the username again there).
- **2026-10-25 ~13:50 UTC: @fatline cast the bring-your-node line** (owner's go): cast 0x0576d7f8, embeds join.gif then https://fatline.ink/docs/#bring-your-node (the docs scroll to that section once drawn and light it up). Seen on our node and on crackle.
- **2026-10-25, the master serves the site (ready, DNS not switched).** `https://46-225-208-199.sslip.io/` is fatline.ink built and served by the master: infra/site-setup.sh (Caddy, /root/fatline-site, systemd timer fatline-site every 10 min) runs infra/site-build.sh (git pull, skill page, status, hatching, token metadata from its own nodes, atomic swap). Every route compared with GitHub Pages: static files byte-identical; app pages (/<fid>, /f/…, /base/…) answer 200 instead of 404; /fatliners/<fid> is application/json; /eggs/* goes to the hatchery. **To switch:** at Namecheap, point fatline.ink (A record) to 46.225.208.199 and remove GitHub's records; then on the master `SITE_HOSTS="fatline.ink 46-225-208-199.sslip.io" bash /root/fatline-site/infra/site-setup.sh` (Caddy gets the certificate); then the GitHub workflow can go. The Farcaster manifest (.well-known) is signed for fatline.ink, so the mini app works only on that name. Also: the wallet sign-in is presented as the way for people who can't use the Farcaster app (banned): no app, no relay, straight to their node. **Still untested with a real account.** join.sh GIF/MP4 at img/join/ (10 s). Aenon's server (@jmsaulnier, AgentMetal, 1 day) stopped answering after 12:38 UTC.
- **2026-10-25 afternoon.** **Bring your node:** `curl -fsSL https://fatline.ink/join.sh | sudo bash` on any server already running Snapchain or Hypersnap: finds the node (version, sync), installs the hatchery next to it after a yes (infra/hatchery-setup.sh), offers auto-upgrade, prints the egg command. `--check` tested on the master (found Snapchain 0.15.0, in sync) and on a machine with no node; **the install path is untested** (not run on the master: it would reset the genesis hatchery's code). Linked from the landing page, the docs and the skill. **Master's Hypersnap stopped** (owner's go): disk full, Hetzner volume limit; restart line in /root/hypersnap-paused.txt; fatlines.json marks it `paused` (the site shows the reason), disk-guard logs it without alerts. **Owner's direction (not started):** the master becomes the indexer that serves fatline.ink: the server is the thing and all of the site's compute happens on it (no GitHub workflow reading nodes).
- **2026-10-25 midday: the testers' feedback, built.** (1) The hatchery page reads live: eggs from the contract on Base and each egg's warm checks from the genesis hatchery, now on https at `https://46-225-208-199.sslip.io` (Caddy on the master, Let's Encrypt, no DNS record), again every 30 minutes; status.json only draws the first frame (the workflow is set to every 30 minutes, GitHub runs it every few hours). A warm day reads "day 1 of 3 is warm ✓ · day 2 starts in N h". (2) Sign-in: the fire, the hints (en/es) and the Cast panel all point to one Sign in with Farcaster (QR, link, browser wallet); "a key for your account, not a new account"; timeouts and "unavailable" in plain words with Try again; the recovery phrase only under "Other ways". (4) `fatline node autoupgrade on|off|status` (infra/autoupgrade.sh, local or over SSH); **on for the master** (daily 06:19 UTC). (5) install.sh offers to install git and Node 22 (apt + NodeSource, or Homebrew) after a yes: **tested in a fresh Ubuntu 24.04 container** (Node v22.23.4, cloned). `fatline node … --local` offers Docker on Linux (untested). (6) The skill: preflight for Node/Docker, sign-in troubles, share fatline.ink/skill bare. **Untested:** the new Cast panel in a browser with a real account.
- **2026-10-25 morning: feedback from the first outside runs, and the answers.** Three Fatlines warming (Aster/@jpfraneto, Aenon/@jmsaulnier #20630, Thaituma/@jvaleska.eth #13505), all Snapchain v0.15.0 and in sync. Done: **fatline.ink/skill** is the shareable skill page (preview image: Fatliners teaching three AI-assistant mascots, `img/og/og-skill.jpg`, made with the Codex image pipeline; page generated from skill.md by `apps/site/skill-page.mjs` in the site workflow). skill.md itself can't carry a preview: GitHub Pages serves it as text/markdown. Links to skill.md with a stray character (the 2026-10-25 00:19 cast's `skill.md”`) now redirect from the 404 page. The setup's arch animation is skipped over SSH (@ivc saw ~5 fps on a server). **Snapchain auto-upgrade is on by default for new installs** (a daily `snapchain.sh upgrade` cron, `FATLINE_NO_AUTOUPGRADE=1` turns it off): before, it was always off, and the master's shard 1 stuck on 0.14.3 (trie root mismatch) after v0.15.0's same-day protocol change until upgraded by hand on 2026-10-24 07:46 UTC. **Untested:** the cron on a fresh server. **Open:** the master's Hypersnap volume is 100% full (670 of 674 GB) and the node stopped answering on 2026-10-24 ~05:46 UTC; Hetzner's volume limit still blocks growing it. Existing nodes (master, Aenon, Thaituma) don't have the auto-upgrade cron yet.
- **2026-10-24 afternoon: a friend's real run (Snapchain on his own server), and the fixes.** What tripped him: `fatline connect` failed with "operation aborted due to timeout" after he scanned (the node's lookup by address takes 20-33 s when the address isn't indexed; we gave it 15 s), then the Farcaster app said "Sign in with Farcaster is unavailable" (their service). `fatline client` never said where to open it, and `status` said "Indexer not running, use fatline up", which read like a separate thing. The Cast button showed only a QR code. Fixed: connect asks the node who owns the claimed FID (one query, ~0.5 s) before the slow lookup (now 60 s), and says plainly when it is Farcaster's relay; `fatline client` prints and opens http://localhost:8787; status shows each shard's delay and says catching up is automatic; the Cast panel has the link, a copy button (https link for the phone), "Try again", and **Use a browser wallet instead** (custody wallet signs two EIP-712 messages, SignedKeyRequest then KeyAdd; gasless KEY_ADD to the node; tested with a fake node, **untested with a real account**). Help, docs, tutorial (en/es) and the skill now say an app key is a second key for your account, not a new account, and that `connect` is optional.
- **2026-10-24 ~04:20 UTC: live on Base (owner's go; the 03:33 pair is superseded, see `deployments/base.json`).** Launchpad `0xb54CD4A4E56D2549557b1284AB0BEA2D076a3016`, Fatliners `0xb54CD4A4E56D2549557b1284AB0BEA2D076a3016`; config defaults to them. **Eggs are onchain**: `takeEgg` (any FID, once, unlimited, soulbound, token id = FID; attesters sign an EIP-712 Egg once they read the DNA). **`hatch` turns that same token into a Fatliner** (max 777) with a **surname** = `beingName(seedOf(fid, DNA))` in capitals. **Launchpad = one coin per Fatliner, only Fatliners** (`launchApp` removed; tests use `test/mocks/OpenFactory.sol`), **$FATLINE first** (`GenesisFirst`), **ticker must equal the surname** (`WrongTicker`). Attesters = servers that hatched; 3 signatures or all while fewer. Genesis: Aster #18350 (surname FATLINE, DNA `0xde5d5dfa…`, cutoff 03:00 UTC) born to FID 18350's custody, kept by the master (attester `0x37757a1D…3bAE`, key only on the master, relay on, ~0.0016 ETH). Every royalty → Aster's vault `0x45C6…4067`. Whole path rehearsed on a Base fork with the real Clanker (egg → onchain → hatch $NOUNOUYUR → $FATLINE first → $NOUNOUYUR coin → second coin refused). **$FATLINE NOT launched:** `fatline coin launch` simulates OK; `--go --seed-file ~/.fatline-18350-seed` needs the owner's yes. After launch: put the coin address in `apps/site/fatlines.json`; run the keeper for Aster's vault on the master; delete the seed file. The web "Launch" form now launches a Fatliner's coin (FID field). `infra/fork-demo.mjs` retired. Master's Hypersnap disk 97% at 03:15 UTC.
- **Real run, 2026-10-24 01:15 UTC (the friend's path, from a fresh copy, as an agent):** AgentMetal medium + 700 GB rented from new wallet 0xb824…9e77 (4.20 + 7.00 USDC), server `srv_4lsmvokucwc1` at 5.161.250.239, paid until 2026-10-25 01:15 UTC. Snapchain only. Volume auto-mounted at /mnt/HC_Volume_107256697 (653 GB free); 7 GB RAM + 16 GB swap; snapshot streamed at ~100 MB/s. Found and fixed on the way: AgentMetal counts an expired server against a wallet's 1-medium quota (old wallet 0x754a refused; now a plain message, nothing paid); `fatline node` failed while a new server was still booting (now waits for SSH); the setup could fill / if the disk wasn't mounted yet (now waits, then stops with FATLINE_ERROR); a failed setup now prints its reason and log tail; doctor demanded 1,500 GB (now 650, and lists cloud/hetzner/vps); Hypersnap gets 900 GB by default.
- **Coin blocker:** the factory's default tiers pay a vault's keeper at most ~5 USDC/day (Node tier, 1,000 DAU), Seed ~0.52/day; a node costs 2.60 (Hetzner) to 11.20 (AgentMetal) per day. Change the tiers before deploying AppFactory. Gas for deploy + one launch ≈ 0.00008 ETH at 0.006 gwei.
- **Later the same evening (owner's call):** no pasted keys, ever. Payments are approved in the person's own wallet: `--pay phone` (WalletConnect QR, needs a project ID from dashboard.reown.com in `walletConnectProjectId`, set in fatline.config.example.json; the relay accepts it and gives a pairing QR; `compute wallet --pay phone` tests a connection without signing), `--pay browser` (localhost page + wallet extension, tested with a simulated page), `--pay here` (a wallet made on this machine). `infra/payer.mjs` verifies every signature against the connected address. `fatline setup` now asks where the node lives: cloud (AgentMetal, x402) / hetzner / vps (`fatline compute vps root@IP`, any provider, checks RAM/disk) / local / light. `fatline compute renew --days N`. 24 infra tests. **Untested:** a real phone wallet over WalletConnect, a real browser wallet signing, any real AgentMetal payment.
- **2026-10-23 evening, after the first outside tester:** plain `fatline compute` asked them for a Hetzner token. Now it pays in USDC from a wallet (x402, AgentMetal, 1 day, medium + 700 GB, ~11.2 USDC; live quote checked), then `fatline node snapchain` installs on it (node-remote reads `.fatline/compute.json`). Hetzner only with `fatline compute hetzner`. `fatline setup` rent path: wallet → quote → rent. Skill, docs, tutorial (en/es/zh), README updated. Landing page now leads with "a Farcaster node with a life of its own" and lists the live Fatlines from status.json, with cost per day for both nodes. **Untested:** a real AgentMetal payment and a node on it (8 GB RAM, does its disk mount at /mnt/HC_Volume_*?).
- **One server, both networks, both in sync** (checked 16:00 UTC: 914,314,232 messages on each, blockDelay ≤ 9). $131.82/month. The ranking extract is finished; nothing else runs on it.
- **The ranking is done:** `/root/ranking-out/ranking.tsv` on the master, 593,815 ranked, tiers 777 / 7,000 / 70,000 / rest. Deterministic, no manual exclusions (owner's call). Not published yet.
- **PR #1 merged** (jvaleskadevs): `follow --followers --depth N` and `fatline feed` (a timeline from the local archive, no node). Reviewed and fixed: replies filtered in SQL (pages could come back empty), the network shown per cast, newest profile field wins; one new test (67 indexer tests). Tried on our master: @anky has 961 followers on Snapchain; copying all their histories is slow (14 accounts in ~10 min).
- **The world of the Fatliners:** 9 scenes + Aster's portrait, `fatliners/world/` (made through the Bankr LLM gateway, key in `~/.fatline-bankr-key`, ~$0.40). On the landing page (hero, "World" section, Aster on the first card) and in the README.
- **Site and docs updated** to this state: protocol steps, finished ranking, real portraits, one server, followers and feed.
- **One-line setup (2026-10-23):** `curl -fsSL https://fatline.ink/install.sh | sh` → clones into ~/fatline → `fatline setup` (infra/setup.mjs): guided, resumable, asks before each step, three paths (rent / local / light). `--plan` prints the steps and commands. Agent skill at fatline.ink/skill.md (= `skills/fatline-setup/SKILL.md`), plus fatline.ink/llms.txt. Tested: the light path end to end in a fresh clone (crackle, FID 18350, 4,824 messages in 11 s, feed shown); rent and local paths only through `--plan` and a free quote. Found and fixed on the way: on a fresh copy the light path read a local node that doesn't exist.
- **Next, in bounty order:** a stranger runs the three commands (J11); the owner's real identity + cast (J5–J7); deploy AppFactory and launch $FATLINE (needs the owner's yes and money); publish ranking.tsv and its Merkle root; render the 777.

## Earlier notes (2026-10-22, ~07:15 UTC, overnight run)

**Resume here.** The owner approved the master node and went to sleep. The agent runs the full pipeline overnight and posts each shipped update to the Fatline Telegram group (bot token in `~/.fatline-telegram-token`, chat id in `~/.fatline-telegram-chat`, both mode 600, never in the repo).

### The master node (created 2026-10-22 01:48 UTC, stays up)
- **Hetzner `cax31` (ARM, 8 CPU, 16 GB RAM) + 700 GB volume in nbg1, ~$2.75/day.** Server 171726570 at **46.225.208.199**. Record in `.fatline/hetzner.json`.
- The owner's decision: **it stays up.** It is the master node of Fatline and will be tied to $FATLINE (each node can be tied to an app running from it).
- Why cax31 and not cx43: cx43 was sold out in every location (`error during placement`). Snapchain and statsd both publish arm64 images. `hetzner.mjs` checks stock before creating anything and resumes a half-finished run.
- SSH: `ssh -i .fatline/ssh_ed25519 root@46.225.208.199`. Status: `fatline compute hetzner status`.
- **Snapchain runs on it since 2026-10-22 06:42 UTC**, started from the streamed snapshot (no second download).
  - Disk: 557 GB (global 4 MB, shard-0 37 GB, shard-1 262 GB, shard-2 259 GB); 97 GB free on the 688 GB volume.
  - RAM: the Snapchain container uses ~0.4–0.8 GB; CPU 17–77%.
  - Catch-up: about a day behind at start; **in sync at 12:25 UTC** (blockDelay 0 on every shard), ~5h45m after start.
  - Synced numbers: 914,298,245 messages, 558 GB (dbStats), Snapchain 0.14.3. The container uses 1.8 GB RAM at 2.5% CPU.
  - **J3 passed (2026-10-22):** rebooted at 12:26:07 UTC. The API answered 47 s later with all 914.3M messages (data on the volume, mounted at boot). It was 30 blocks behind, and in sync again 62 s after the reboot. Snapchain's container has restart=always and Docker starts at boot. Copy points live in memory, so a reboot drops them and the node makes a new one at its first block. A copy in progress from it would fail.
- **Replication works from it** (`ReplicationService` on :3383, tested from outside). A copy point is a block snapshot the replicator keeps for others to copy. Shard 1's point: height 49,240,122 (458.6M messages); shard 2's: 49,060,194 (455.7M). `GetShardTransactions` returns pages of 1,000.
- **The Fatline adapter reads it:** FID 18350 backfilled with 4,824 messages in 18 s, the same count crackle gave.

### The Hypersnap node (created 2026-10-22 03:57 UTC by session fatline-ea)
- **Since 2026-10-23 03:01 UTC it runs on the master (one server, owner's call).** Its 685 GB volume was detached from the cax21 and attached to the master (mounted at the same path, `/mnt/HC_Volume_107234161`); the cax21 and 2.31.51.183 are deleted. Hypersnap's shard 0 (44 GB) lives on the master's local disk (`/srv/hypersnap-shard-0`, bind-mounted in its docker-compose.yml), because the account can't grow volumes. Hypersnap API: http://46.225.208.199:4381. The notes below describe the original setup.
- **Hetzner `cax21` (ARM, 4 CPU, 8 GB RAM + 16 GB swap) + 685 GB volume in nbg1**, server 171737914 at **2.31.51.183**. Record in `.fatline/hetzner-hypersnap.json`; `compute hetzner status/down` include it (servers are deleted before volumes).
- It streams the same 2026-10-21 snapshot with `infra/hypersnap-setup.sh`. It is **below Hypersnap's stated 1.5 TB / 16 GB**; watch its disk.
- **Account limits (Hetzner):** 1,385 GB of volumes in total, 14 shared vCPU, and the account is "too new" to raise them. So no 1 TB volume and no cax41.
- **Money:** both nodes ~$4.96/day against ~$14.6 left (2026-10-22 ~04:00 UTC), enough to ~2026-10-25 01:00 UTC. Card auto-reload is off. `infra/budget-alert.mjs` posts a low-balance warning to Telegram.

### What the snapshot taught us (four bugs on the real run, all fixed in `infra/node-setup.sh`)
1. Chunk URLs repeated `FARCASTER_NETWORK_MAINNET/` → every download 404. Caught before paying.
2. Piping curl straight into gunzip: a cut download was retried, but its partial bytes were already in the stream → corrupted gzip, all shards dead after ~1 h. Now each piece goes to a temporary file first.
3. Downloads hung on dead connections with no timeout. Then, after ~180 GB at full speed, uncached pieces came at 0.1–4 MB/s per connection, so a "1 MB/s or restart" rule could never finish them. Now: resume (`-C -`), give up only below 100 KB/s for 60 s, 12 downloads at once per shard. Measured 133 MB/s after the change.
4. The unpack loop ended with `[ … ] && echo`. With `pipefail`, every fully unpacked shard was reported as failed (piece counts aren't multiples of 100).
- Fourth run started 04:10 UTC with shard 0 kept (372 pieces, 37 GB unpacked).
5. One piece of shard 2 got 17 of 89 MB in 44 min on one connection. Slow byte regions in R2 stay slow on any single connection, and 30 tries would have failed the shard. Now, after 3 slow tries, the rest is fetched in 8 byte ranges, then joined and checked against R2's ETag, which is the piece's MD5 (1dae4f1). Rescued by hand on the run; `/root/guard.sh` on the master did the same for the rest of the run.

### Overnight orders (from fatline-ea, the owner's coordinator). Status as of 12:30 UTC: 1 done (in sync 12:25), 2 done, 3 done (reboot passed), 4 blocked upstream (KeyAdd, below), 5 done.
1. Master Snapchain synced (`blockDelay` small), real disk and RAM measured.
2. `ReplicationService` answers on 46.225.208.199:3383. crackle:3383 and haatz:3383 time out from outside, so ours would be the only public replication source.
3. J3: reboot the master once synced; it must come back on its own.
4. Lite node on AgentMetal (5.161.202.175, paid until 23:09 UTC): `FATLINE_SNAPSHOT=replicate FATLINE_REPLICATION_PEERS=http://46.225.208.199:3383`. Measure disk and time.
5. Fatline adapter pointed at the master: `node --experimental-sqlite indexer/src/adapters/run.mjs --network farcaster --node http://46.225.208.199:3381 --label "Farcaster master node"`.

### Fatline archive (built 2026-10-22, three sessions)
- Schema: `research/FATLINE-ARCHIVE.md` (approved, SQLite now). Archive module, API and page: session fatline-28. Network adapter `indexer/src/adapters/snapchain.mjs`: session fatline-c1. Tested on real crackle events and a live run (FID 18350: 4,824 messages in 8 s).

### Money and rented things right now
- **AgentMetal server `srv_ty63heep40jd` (5.161.202.175)** is paid until 2026-10-22 23:09 UTC (4.20 USDC, no refunds). It's idle.
  - Its disk endpoint fails: the paid `POST /v1/servers/{id}/storage` returns HTTP 502 within 2 s and nothing is charged.
  - The background retries were stopped.
  - Optional free use before it expires: test `infra/server-setup.sh` (the light client with HTTPS) on it, which has never run on a real server.
  - SSH: `ssh -i .fatline/ssh_ed25519 root@5.161.202.175`.
- **Compute wallet** `0x754ab772Ee4E608A8c3E758AA6E91B6a82727F4E` holds 7.80 USDC on Base. Its key is in `.fatline/compute-wallet.key`. The money can go back to the owner, but sending it needs a few cents of ETH for gas.
- **Reporting the AgentMetal bug:** AgentMetal is run by inbest.cloud (Mexico): `hola@inbest.cloud`, X @inbestcloud, GitHub issues at agentmetal/mcp. A Spanish email draft was given to the owner; they had not sent it yet, as far as we know. Don't post publicly without their yes.
- **Local processes from earlier demos** may still run on the owner's Mac: an anvil Base fork on :8545 and the indexer on :8787. Both are harmless; stop them if they get in the way.

### Done
- **`<surname>.fatline.ink` (2026-10-25, built, waits for DNS):** every egg's surname is a name: the master's hatchery lists them (`GET :8791/names`, and `/names/mine` by the asking IP). `fatline-names` on the master (`infra/names-router.mjs`, set up by `infra/names-setup.sh`, `off` to undo) holds 80/443 and passes each connection through by its TLS name, so certificates stay on each person's server; the master's own names go to Caddy, now on 127.0.0.1:8080/8443 (Caddyfile backup in `/etc/caddy/Caddyfile.bak-*`). A node's server runs `curl -fsSL https://fatline.ink/client.sh | sudo bash` (after join.sh and the egg): client on 127.0.0.1:8787, Caddy https, link `https://<name>.fatline.ink/#key=<write token>`. **Next:** owner adds `*` A 46.225.208.199 at Namecheap, then run client.sh on the master for fatline.fatline.ink and check a certificate comes through. Later, per-person DNS records (an API-capable DNS) can take the master out of the path.
- **Fatliner PFPs from any FID (2026-10-23):** `fatline fatliners prompt --fid N [--generate]`. Our two nodes → the existing features and DNA → calibrated visual traits → a prompt for `gpt-image-2` with the approved species blueprint attached → a portrait (made through the Codex CLI's image tool on the owner's ChatGPT login; no API key). 16 well-known accounts rendered as a set. Everything: `fatliners/docs/PFP.md`. Not done: recalibrating on the real top 777 once `ranking.tsv` exists; an OpenAI API adapter.
- Machine check, read client (Farcaster and Hypersnap), x402 rental (VpsAgent monthly, AgentMetal daily).
- Launchpad contracts, indexer and UI, and onchain daily users. Proven on a Base fork.
- **Posting (J5–J7):**
  - `fatline identity` (gasless `KEY_ADD`, scoped, hidden seed prompt, self-revoke) in `indexer/src/identity.mjs`.
  - `indexer/src/writer.mjs`: cast, reply, like, recast, follow, delete; each is confirmed by reading it back.
  - The UI is in `apps/opinions/src/post.js`.
  - Posting is owner-only: from the same machine, or with a write token behind a proxy. Other websites are blocked.
  - Tested by unit tests, a fake node, and headless Chrome (cast, reply, like and follow all confirmed). crackle validated the message formats and accepts submissions without a password.
- The node keeps 1 day of blocks by default, and the snapshot streams with one copy on disk (~600 GB instead of Snapchain's ~3 copies).
- Tests: 33 Foundry, 67 indexer, 10 infra, 24 Fatliners (+10 Foundry for the collection).

### Not done, in bounty order
- **J3: done.** The master synced every shard (12:25 UTC) and survived a reboot (in sync again 62 s after it). See "The master node" above.
- **J5–J7 real run:** the owner runs `fatline identity --fid 18350 --dry-run`, then without `--dry-run`, **in their own terminal** (never paste the seed phrase into an agent chat). Then `fatline up` and cast from My people. Test account: @anky, FID 18350, custody `0x3ae5…6b60`.
- **J8:** the client filter (show or hide posts by the app that made them). Not built.
- **J9:** the tutorial site (English and Spanish). Not started.
- **J11:** testers. The owner's friend (who sent the snapshot analysis) is a candidate. None confirmed yet.
- **Owner decisions still open:** the launchpad's fee share (%) and its split between grants and the two founders (PrizeSplit); grants treasury design.

### Findings worth keeping
- No x402 seller sells a server big enough for a node with its built-in disk: VpsAgent goes up to 300 GB, VPSWolf to 800 GB (both monthly). AgentMetal sells disk, but its disk endpoint is broken (see above).
- **Replication bootstrap (`Replicate`), tested 2026-10-22 from the master to AgentMetal (4 CPU, 7 GB):**
  - It works over the internet, using our master as the only peer: ~17–23k messages/s, an ETA of 11–15 h for ~914M messages.
  - **Not small:** measured 330–430 bytes per message early on, so a full replica is ~300–400 GB (the snapshot's data shards are ~520 GB, because they include block history). It doesn't fit on AgentMetal (124 GB free). The run there is a measurement, with `/root/diskguard.sh` stopping it at 15 GB free.
  - **The source must keep its copy point for the whole copy.** Copy points are dropped once their block is 24 h old (`max_age`). A source still catching up only has 18–24 h old points, so the first try died at 2.2M messages ("Store not found for shard 2 and height …"). A synced source takes a point every 28,800 blocks (~8 h), so the newest is ≤8 h old and lives 16+ h: just enough for a ~15 h copy.
  - **Snapchain bug:** a failed copy says "restart to resume", but copying only runs when `.rocks` is empty, and the partial copy sits in `.rocks/.snapshot`. Docker's restart then ran it as a normal node on 0.5% of the data. Our script now sets `restart: "no"` until the copy succeeds, follows the log, and starts an unfinished copy over.
  - **Blocker, upstream:** the second copy died on the source's side after 8.9M messages: "Invalid message type for FID 310953: KeyAdd". Snapchain's `replicator.rs` (upstream main 816cb18) refuses KeyAdd/KeyRemove on purpose, "until shard-0 routing and the signer store are both part of the replicated per-fid state". Mainnet already has KeyAdd messages, so **Replicate cannot finish on mainnet today, from any source.** Working around it means patching Snapchain. What works now: our full master, plus the Fatline adapter reading it over HTTP. An upstream issue is a public post, so it needs the owner's yes. Fix in 2df1e48: the failure path was seen working (node stopped, clear message).
  - Peer discovery found other public :3383 servers (e.g. 95.217.197.252, 51.79.77.116), without a matching copy point. Earlier, rho answered *Unimplemented* (behind a proxy).
- The snapshot on R2 is ~5,700 pieces of ~70 MB: ~400 GB compressed, ~600 GB unpacked (measured ratio ~1.5×). It includes all block history.
- Rejected ideas and why: forking Snapchain (weeks of Rust, judges want Snapchain); a debit card funded by a vault (identity checks, custodial); the owner's Mac (13 GB free).

## Workstreams, in order

### W1. Write path (J5–J7). Start now.
- **Identity tool:** a separate local command (`fatline identity`), never the web page or the agent chat.
  - Read the seed phrase from a hidden prompt.
  - Derive the custody address on the standard path only and look up its FID on the node.
  - Fail clearly if they don't match.
  - Create an Ed25519 app key and register it with a custody-signed **gasless `KEY_ADD`** (current writing guide, `makeKeyAddBody`/`makeKeyAdd`, EIP-712 gasless domain), submitted through our node.
  - Also explain, and support if cheap, the onchain KeyGateway path (the "one small Optimism transaction" Balaji mentions). Say in the tutorial which one we use and why.
  - Wait until `/v1/onChainSignersByFid` (or the gasless signer endpoint) shows the key.
  - Forget the phrase as soon as the key is registered.
- **Key storage:** save the app key to `.fatline/` with mode 600, gitignored. Show how to revoke it.
- **Messages:** cast, reply, follow and unfollow, like and unlike. Build each with `@farcaster/core`, submit it to the selected network's own node (`/v1/submitMessage`), then poll until it can be read back. Show the states pending → confirmed → failed (with the reason). Retry with the same signed message, never by signing again.
- **Both networks:** Farcaster and Hypersnap share the same `/v1` API. Test writes on both, or say clearly which one is unproven.
- **Tests:** message construction, scopes, retry with the same payload, confirmation timeout. Finally, a real cast from a disposable account with storage, confirmed by hash. This needs the owner's account and consent.

### W2. Client filter (J8)
- Map signer → app FID: gasless records give `requestFid`, older keys need their key-request metadata decoded. Cache the result.
- Add include/exclude controls with the app names visible, and a stated rule for unknown apps.
- Measure how many casts get attributed and print the number. Don't promise 100%.

### W3. The three commands (J1–J4)
- The quickstart is exactly `fatline compute`, `fatline node <farcaster|hypersnap>`, `fatline client`. `client` is `up` plus the first-run guide to `identity`.
- **Compute:**
  - Keep `doctor`, which uses this machine if it's big enough.
  - Add one path that really provisions ≥2 TB: a cloud provider API scripted end to end, or an x402 seller with enough disk if one exists.
  - Print the price before anything is paid. Write down every resource created, and give a `compute down` command that deletes them.
  - The x402 rental stays as the "light" path. Label it as not able to run a node.
- **Node:** use a pinned version. Show snapshot download and per-shard sync progress. It must be safe to rerun after an interruption.
- **Proof:** a full run on a fresh rented machine, with secrets removed from the log. Record setup time, disk use and cost. This log goes on the microsite.

### W4. Microsite and tutorial (J9, J12)
- `apps/site/`: static, fast, phone-first, light and dark.
- Order: quickstart, then the tutorial step by step (same commands, explained), then concepts inline where they're first needed, then troubleshooting, then cost and cleanup, then the final chapter, "Give your client a life" (the launchpad).
- English first. Spanish follows the same steps. Chinese only if time allows.
- Every claim on the site is something we ran. Show real outputs, not invented ones.
- Use the same config file and health checks as the CLI. Don't keep a second copy of the truth.

### W5. Testers (J11). Start the moment W1 and W3 work, no later than 2026-10-22.
- Write a short tester kit: what you need, how long the sync takes, and where to report problems.
- The owner and their friend recruit people. The agent only prepares material.
- Fix whatever testers hit, the same day.
- Collect vouch URLs only after the testers post them.

### W6. Launchpad polish (P1, after W1–W3 work)
- In-app USDC launch flow tested from a real browser wallet.
- The keeper tops up its own ETH for gas from the vault.
- Deploy to Base mainnet only with the owner's explicit go and wallet.
- **Open decision, the owner chooses:** should a fixed share of every coin's trading fees go to the launchpad? Clanker v4 supports multiple reward recipients.
  - The recommendation is 10–20%, fixed forever in `AppFactory`, paid to the `PrizeSplit` contract so the two founders split it 50/50 automatically.
  - If chosen: the factory enforces the exact split, the tests cover it, and the README stops saying "no protocol fee" and states the number plainly.

### W6b. Apps are fixed artifacts (owner's vision, 2026-10-21)
- An app launched here can be anything: a client, a mini app, a frame, a post, a video. From launch on it is a concrete artifact that doesn't change, executable software that runs as long as its vault feeds it.
- **The bounty's client is itself launched through the launchpad.** Command 2 creates a client and gives it birth as an app, with a coin optional.
- **To build:**
  - Pin the artifact by content hash (for example an IPFS CID, or sha256 of the built bundle) when the app is born, and make it immutable in the vault.
  - Today `setUri` lets the owner change it. **Decided: remove `setUri`. A new version is a new app.** Simplicity, finality, no exceptions.
  - The indexer and UI verify the served bundle against the hash and show "verified" or "changed".

### W6c. Grants treasury (owner's idea, 2026-10-21)
- A `GrantTreasury` contract holds USDC from donations and, if chosen, the launchpad's fee share.
- A grant pays **into an app's vault, daily, for a set number of days**. Stopping a grant stops future days only.
- To begin with, a Safe of named people decides. Every grant, amount and reason is onchain and public. Later this could become a vote, for example weighted by onchain daily users.
- **It can also pay for shared full nodes.** One 2 TB node per network can serve many apps that can't afford their own. The node's operator and URL are public, and it's always labeled in Settings.

### W7. Submission (2026-10-24, before 06:00 UTC)
- Reply to Balaji's post with three URLs: the microsite, the public repository, and the vouch post.
- **The owner posts it, not the agent.**

## Rules

- **Secrets:** seed phrases and private keys never appear in logs, shell arguments, files in the repository, screenshots, video, or the agent conversation. They go through a hidden prompt or an environment variable only. Credentials are saved with mode 600 and gitignored.
- **Real money and real posts need the owner's explicit yes, each time.** That covers deploying, renting, paying, casting from a real account, and anything posted publicly. Fork and test networks are fine.
- **Never invent:** no fake testers, quotes, vouches, numbers or screenshots. If something is untested, say "untested".
- **Open and user's choice:** Farcaster and Hypersnap are equals. Node choice lives in Settings and is always labeled. No hidden fallback to a hosted API.
- **No slop:** plain, short sentences. Each feature works or is labeled as not working. Delete instead of padding. One clear way to do each thing.
- **Keep the README's "tested / not tested" section true after every change.** Run `fatline test` before claiming anything works.
- **Order:** finish the earliest unfinished workstream before polishing a later one, unless the owner says otherwise.

## Working loop for any agent session

1. Read this file, then the README.
2. Pick the first unfinished item above and say which one.
3. Build it, test it (automated, then for real where possible), and update the README and this file's "Where we are" section.
4. Report in a few lines: what works now, what was proven and how, and what still needs a human, such as a wallet, an account or a tester.
