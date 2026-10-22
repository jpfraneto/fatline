# Master prompt: win the bounty, ship the launchpad

Read this before doing any work in this repository. It is the plan, the definition of done, and the rules. If something here turns out to be wrong, fix this file first, then the code.

**Deadline: the entry must be posted before 2026-10-24 14:47:30 UTC.** Aim to submit by 2026-10-24 06:00 UTC.

## The mission

Balaji's bounty ([the post](https://farcaster.xyz/balajis.eth/0x50184b62), $2,048 first place) pays for **the easiest path from nothing to your own Farcaster read node plus a working client**, in three commands:

0. Provision the compute with a script.
1. Set up a Snapchain read node. It must run with no API keys from anyone.
2. Create a client that reads from that node.

Infinicaster answers that, then goes one step further: **the client you just created can pay for its own life.** It gets a USDC vault that is fed by deposits or by its own coin's trading fees, launched on Clanker. That is the launchpad, and it is the last chapter of the tutorial, not a replacement for the first three.

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

## Where we are (2026-10-22, ~07:15 UTC, overnight run)

**Resume here.** The owner approved the master node and went to sleep. The agent runs the full pipeline overnight and posts each shipped update to the Infinicaster Telegram group (bot token in `~/.infinicaster-telegram-token`, chat id in `~/.infinicaster-telegram-chat`, both mode 600, never in the repo).

### The master node (created 2026-10-22 01:48 UTC, stays up)
- **Hetzner `cax31` (ARM, 8 CPU, 16 GB RAM) + 700 GB volume in nbg1, ~$2.75/day.** Server 171726570 at **46.225.208.199**. Record in `.infinicaster/hetzner.json`.
- The owner's decision: **it stays up.** It is the master node of Infinicaster and will be tied to $INFINICASTER (each node can be tied to an app running from it).
- Why cax31 and not cx43: cx43 was sold out in every location (`error during placement`). Snapchain and statsd both publish arm64 images. `hetzner.mjs` checks stock before creating anything and resumes a half-finished run.
- SSH: `ssh -i .infinicaster/ssh_ed25519 root@46.225.208.199`. Status: `./infinicaster compute hetzner status`.
- **Snapchain runs on it since 2026-10-22 06:42 UTC**, started from the streamed snapshot (no second download).
  - Disk: 557 GB (global 4 MB, shard-0 37 GB, shard-1 262 GB, shard-2 259 GB); 97 GB free on the 688 GB volume.
  - RAM: the Snapchain container uses ~0.4–0.8 GB; CPU 17–77%.
  - Catch-up: about a day behind at start, shrinking ~220 blocks/min, so expected in sync ~14:00 UTC.
- **Replication works from it** (`ReplicationService` on :3383, tested from outside). A copy point is a block snapshot the replicator keeps for others to copy. Shard 1's point: height 49,240,122 (458.6M messages); shard 2's: 49,060,194 (455.7M). `GetShardTransactions` returns pages of 1,000.
- **The Farline adapter reads it:** FID 18350 backfilled with 4,824 messages in 18 s, the same count crackle gave.

### The Hypersnap node (created 2026-10-22 03:57 UTC by session infinicaster-ea)
- **Hetzner `cax21` (ARM, 4 CPU, 8 GB RAM + 16 GB swap) + 685 GB volume in nbg1**, server 171737914 at **2.31.51.183**. Record in `.infinicaster/hetzner-hypersnap.json`; `compute hetzner status/down` include it (servers are deleted before volumes).
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

### Overnight orders (from infinicaster-ea, the owner's coordinator). Status as of 07:15 UTC: 1 catching up, 2 done, 3 waiting for sync, 4 limits found (below), 5 done.
1. Master Snapchain synced (`blockDelay` small), real disk and RAM measured.
2. `ReplicationService` answers on 46.225.208.199:3383. crackle:3383 and haatz:3383 time out from outside, so ours would be the only public replication source.
3. J3: reboot the master once synced; it must come back on its own.
4. Lite node on AgentMetal (5.161.202.175, paid until 23:09 UTC): `INFINICASTER_SNAPSHOT=replicate INFINICASTER_REPLICATION_PEERS=http://46.225.208.199:3383`. Measure disk and time.
5. Farline adapter pointed at the master: `node --experimental-sqlite indexer/src/adapters/run.mjs --network farcaster --node http://46.225.208.199:3381 --label "Farcaster master node"`.

### Farline archive (built 2026-10-22, three sessions)
- Schema: `research/FARLINE-ARCHIVE.md` (approved, SQLite now). Archive module, API and page: session infinicaster-28. Network adapter `indexer/src/adapters/snapchain.mjs`: session infinicaster-c1. Tested on real crackle events and a live run (FID 18350: 4,824 messages in 8 s).

### Money and rented things right now
- **AgentMetal server `srv_ty63heep40jd` (5.161.202.175)** is paid until 2026-10-22 23:09 UTC (4.20 USDC, no refunds). It's idle.
  - Its disk endpoint fails: the paid `POST /v1/servers/{id}/storage` returns HTTP 502 within 2 s and nothing is charged.
  - The background retries were stopped.
  - Optional free use before it expires: test `infra/server-setup.sh` (the light client with HTTPS) on it, which has never run on a real server.
  - SSH: `ssh -i .infinicaster/ssh_ed25519 root@5.161.202.175`.
- **Compute wallet** `0x754ab772Ee4E608A8c3E758AA6E91B6a82727F4E` holds 7.80 USDC on Base. Its key is in `.infinicaster/compute-wallet.key`. The money can go back to the owner, but sending it needs a few cents of ETH for gas.
- **Reporting the AgentMetal bug:** AgentMetal is run by inbest.cloud (Mexico): `hola@inbest.cloud`, X @inbestcloud, GitHub issues at agentmetal/mcp. A Spanish email draft was given to the owner; they had not sent it yet, as far as we know. Don't post publicly without their yes.
- **Local processes from earlier demos** may still run on the owner's Mac: an anvil Base fork on :8545 and the indexer on :8787. Both are harmless; stop them if they get in the way.

### Done
- Machine check, read client (Farcaster and Hypersnap), x402 rental (VpsAgent monthly, AgentMetal daily).
- Launchpad contracts, indexer and UI, and onchain daily users. Proven on a Base fork.
- **Posting (J5–J7):**
  - `./infinicaster identity` (gasless `KEY_ADD`, scoped, hidden seed prompt, self-revoke) in `indexer/src/identity.mjs`.
  - `indexer/src/writer.mjs`: cast, reply, like, recast, follow, delete; each is confirmed by reading it back.
  - The UI is in `apps/opinions/src/post.js`.
  - Posting is owner-only: from the same machine, or with a write token behind a proxy. Other websites are blocked.
  - Tested by unit tests, a fake node, and headless Chrome (cast, reply, like and follow all confirmed). crackle validated the message formats and accepts submissions without a password.
- The node keeps 1 day of blocks by default, and the snapshot streams with one copy on disk (~600 GB instead of Snapchain's ~3 copies).
- Tests: 33 Foundry, 17 indexer, 4 infra, all passing as of this handoff.

### Not done, in bounty order
- **J3:** the master runs and catches up (in sync ~14:00 UTC expected). Then reboot it once and watch it come back.
- **J5–J7 real run:** the owner runs `./infinicaster identity --fid 18350 --dry-run`, then without `--dry-run`, **in their own terminal** (never paste the seed phrase into an agent chat). Then `./infinicaster up` and cast from My people. Test account: @anky, FID 18350, custody `0x3ae5…6b60`.
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
  - Peer discovery found other public :3383 servers (e.g. 95.217.197.252, 51.79.77.116), without a matching copy point. Earlier, rho answered *Unimplemented* (behind a proxy).
- The snapshot on R2 is ~5,700 pieces of ~70 MB: ~400 GB compressed, ~600 GB unpacked (measured ratio ~1.5×). It includes all block history.
- Rejected ideas and why: forking Snapchain (weeks of Rust, judges want Snapchain); a debit card funded by a vault (identity checks, custodial); the owner's Mac (13 GB free).

## Workstreams, in order

### W1. Write path (J5–J7). Start now.
- **Identity tool:** a separate local command (`./infinicaster identity`), never the web page or the agent chat.
  - Read the seed phrase from a hidden prompt.
  - Derive the custody address on the standard path only and look up its FID on the node.
  - Fail clearly if they don't match.
  - Create an Ed25519 app key and register it with a custody-signed **gasless `KEY_ADD`** (current writing guide, `makeKeyAddBody`/`makeKeyAdd`, EIP-712 gasless domain), submitted through our node.
  - Also explain, and support if cheap, the onchain KeyGateway path (the "one small Optimism transaction" Balaji mentions). Say in the tutorial which one we use and why.
  - Wait until `/v1/onChainSignersByFid` (or the gasless signer endpoint) shows the key.
  - Forget the phrase as soon as the key is registered.
- **Key storage:** save the app key to `.infinicaster/` with mode 600, gitignored. Show how to revoke it.
- **Messages:** cast, reply, follow and unfollow, like and unlike. Build each with `@farcaster/core`, submit it to the selected network's own node (`/v1/submitMessage`), then poll until it can be read back. Show the states pending → confirmed → failed (with the reason). Retry with the same signed message, never by signing again.
- **Both networks:** Farcaster and Hypersnap share the same `/v1` API. Test writes on both, or say clearly which one is unproven.
- **Tests:** message construction, scopes, retry with the same payload, confirmation timeout. Finally, a real cast from a disposable account with storage, confirmed by hash. This needs the owner's account and consent.

### W2. Client filter (J8)
- Map signer → app FID: gasless records give `requestFid`, older keys need their key-request metadata decoded. Cache the result.
- Add include/exclude controls with the app names visible, and a stated rule for unknown apps.
- Measure how many casts get attributed and print the number. Don't promise 100%.

### W3. The three commands (J1–J4)
- The quickstart is exactly `./infinicaster compute`, `./infinicaster node <farcaster|hypersnap>`, `./infinicaster client`. `client` is `up` plus the first-run guide to `identity`.
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
- **Keep the README's "tested / not tested" section true after every change.** Run `./infinicaster test` before claiming anything works.
- **Order:** finish the earliest unfinished workstream before polishing a later one, unless the owner says otherwise.

## Working loop for any agent session

1. Read this file, then the README.
2. Pick the first unfinished item above and say which one.
3. Build it, test it (automated, then for real where possible), and update the README and this file's "Where we are" section.
4. Report in a few lines: what works now, what was proven and how, and what still needs a human, such as a wallet, an account or a tester.
