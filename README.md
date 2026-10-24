# Fatline

**Your own Farcaster node and client, in three commands. And a launchpad where every node gets a coin whose trading fees keep it alive.**

**Start here:**

```sh
curl -fsSL https://fatline.ink/install.sh | sh
```

It downloads Fatline into `~/fatline` and starts `fatline setup`, which goes through every step one at a time: check the machine, choose a path (rent a server, run a node locally, or light: no node), the node, the client. Before each step it says what it does, what it costs and how long it takes, then asks: go, skip or stop. Run it again and it continues where you stopped. It opens by saying that everything is open source (MIT) and asking you to agree, then draws the Farcaster arch in the terminal ([`infra/arch.mjs`](infra/arch.mjs); any key skips it, `FATLINE_NO_ANIMATION=1` turns it off). Whenever you stop, or a step fails, it links to that step's code on GitHub so you can change it and send a pull request. `fatline setup --plan` shows where you are and the command for each step. Read [the script](apps/site/install.sh) first; it is short.

**By hand, four commands:**

```sh
git clone https://github.com/jpfraneto/fatline
cd fatline && npm install -g .     # the `fatline` command, usable from anywhere (bin/fatline.mjs runs fatline in this clone)
fatline compute                    # rent the server for your node in USDC (x402, ~11 USDC/day): shows the price, pays nothing until you type "pay"
fatline node snapchain             # your own read node on it (or hypersnap); when it answers, `fatline up` opens your client
```

You approve the payments in your own wallet: a QR code for your phone wallet (WalletConnect), or a page in your browser for a wallet extension. No key is typed anywhere. The server stops by itself when its paid days end; `fatline compute renew --days N` adds days. A server you already have at any provider: `fatline compute vps root@<ip>`. Your own Hetzner account (API token, card, hourly) is the by-hand option: `fatline compute hetzner`, and `fatline compute hetzner down` stops it. The same command is packaged for npm as **`fatlines`**, not published yet. Once it is, `npm install -g fatlines` replaces the first two commands; on first use it downloads the repository into `~/fatline`. The name `fatline` on npm belongs to an unrelated project.

**You are your FID:** `fatline connect` draws a QR code (the Farcaster arch in the middle, a blue and a pink corner for the two networks). Scan it with your phone, sign in with the Farcaster app, and your own node confirms which FID signed ([indexer/src/connect.mjs](indexer/src/connect.mjs)). No seed phrase.

**No FID? Be a worker:** `fatline worker new` makes a wallet on your machine (a recovery phrase shown once, only the key saved, mode 600) that pays for its own node in USDC on Base through x402. No FID, no being, as many as you like; its reward is its own node and client. `fatline worker` shows wallet, USDC, node, client and coin ([infra/worker.mjs](infra/worker.mjs)). Its gasless coin waits for the launch contracts on Base.

**Watch your servers:** `fatline dashboard` opens http://localhost:8790 (only this machine can reach it): CPU, memory and every disk of each server, and how far behind each node's worst shard is, every 15 seconds. It starts from the servers `fatline compute` rented and the nodes marked as yours; `fatline dashboard add <host>` watches another.

**With an agent:** tell Claude Code, Codex or any agent that can run commands: *"Help me run my own Fatline. Follow https://fatline.ink/skill.md"*. The [skill](apps/site/skill.md) keeps you in charge: it shows prices and waits for your yes, and never handles your seed phrase or tokens. For Claude Code you can also install it: `cp -rL skills/fatline-setup ~/.claude/skills/`.

**By hand**, the three commands:

```sh
fatline compute          # (0) rent a server that can hold a node, paid in USDC from a wallet
fatline node snapchain   # (1) your own read node on it, no API keys (or: node hypersnap)
fatline client           # (2) your client, reading from your node
```

Before them: `git clone https://github.com/jpfraneto/fatline && cd fatline && npm install -g .` (the `fatline` command). You need git, ssh and Node.js 22.12+, plus a wallet you already use with ~12 USDC on Base (you approve the payments in it). Or by hand with your own Hetzner Cloud account: `fatline compute hetzner`. Or use Docker on a machine of your own: `fatline node snapchain --local`. The tutorial is at [fatline.ink/docs](https://fatline.ink/docs/), in English, Spanish and Chinese.

**Status:** each command has been run on its own; a fresh run of all three, start to finish, by a stranger, is untested.

## Where things stand (2026-10-24)

| | |
| --- | --- |
| **Our node** | One Hetzner server (`cax31`, 8 Arm cores, 16 GB) in Nuremberg runs **both** networks: Snapchain (Farcaster) and Hypersnap, each in sync, each with its own disk. $131.82/month, about $4.33/day. Live numbers: [fatline.ink/f/FATLINE](https://fatline.ink/f/FATLINE). |
| **The client** | Reads from either network through a node you pick, and says which. Posting with a gasless app key works on the real network: tested with @anky (cast, reply, like, recast, follow, and undoing each). Shows which app made each cast, and hides or shows apps. |
| **The launchpad** | **On Base:** [`0x341AE48f22cc4F7428C969a559cb832912A1119F`](https://basescan.org/address/0x341AE48f22cc4F7428C969a559cb832912A1119F). **One coin per Fatliner, and only Fatliners: at most 777 coins.** $FATLINE launches first, and every ticker must be its Fatliner's surname. Paired with USDC on Clanker, 100% of fees into the Fatliner's vault, which pays its node. $FATLINE is ready (simulated against Base) and waits for Aster's holder: `fatline coin launch`. |
| **The 777 Fatliners** | **On Base:** [`0x73B27C61F9370398EF778c1b3a14BD1Ea899e7e5`](https://basescan.org/address/0x73B27C61F9370398EF778c1b3a14BD1Ea899e7e5). **Eggs** for any account (one each, unlimited, onchain, can't be moved), kept warm by a node; after three warm days **the egg itself hatches** into one of the 777, with a surname read from its DNA. Aster (#18350, surname Fatline) was born at deployment. Our server is the first attester. Portraits can be made for any FID ([fatliners/docs/PFP.md](fatliners/docs/PFP.md)). |
| **No room for a node?** | `fatline follow` copies only the accounts you choose from one node, and `fatline feed` reads them back offline. Not a node: it trusts that node. [More below](#copy-only-the-accounts-you-follow-not-a-node). |

## What Fatline is

Fatline is an open protocol for being on Farcaster on your own terms:
- **You choose the network:** Farcaster (Snapchain) or Hypersnap, as equals.
- **You choose the node:** your own, ours or a public one. The client always says which one it is reading from, and never switches without telling you.
- **A node can pay for its own life:** it gets a coin, paired with USDC on Base, and the coin's trading fees pay its server.

This repository is its first implementation. The site is [fatline.ink](https://fatline.ink). *Formerly Infinicaster.*

A fatline, as we use the word, is a line you hold at both ends. Your keys sign at one end. Your own node listens at the other. In between there is nobody who rents you the line and can take it back: not a platform, not an API key, not us. Keeping it open costs something, so the line carries its own purse. The word comes from Dan Simmons' novel *Hyperion*; what it means here is ours.

### The protocol: one Fatline, one node, one coin

The full design is in [research/FATLINE-PROTOCOL.md](research/FATLINE-PROTOCOL.md). In short:

1. **A Fatline is a link** (ours: fatline.ink). Behind it runs a node. The node indexes one smart contract, its own, plus Farcaster or Hypersnap or both.
2. **It gets a coin** through the launchpad, paired with USDC on Base. Its page is `fatline.ink/base/<address>`.
3. **It is born** when the coin's trading fees can pay for its node. Until then it exists but has no body.
4. **Its vault pays** the server and the gas of its own transactions. If the money runs out, the node goes dark, and the board shows it. Anyone can feed it back to life.
5. **The first Fatline is $FATLINE.** Its code is the launchpad itself: its life is giving birth to the others.

**Built:** the launchpad contracts, the vault, the board, and the node pages. **Not built:** "born from the first fees" as an onchain rule, and one node per contract.

### The 777 Fatliners

The first inhabitants of the Fatline: small stone beings, one per Farcaster account, drawn from that account's history. Same history, same being. A Fatliner can wake up as a node: hold one, launch its coin, and its fees run its own server. Every Fatliner that lives is one more copy of the network kept alive by someone who isn't a company.

- **Who gets one:** whoever keeps a node alive. Run a node, `fatline hatchery install`, `fatline egg lay` (your app key signs the egg; it goes onchain: token id = your FID, held by your custody address, can't be moved), keep it warm three days, `fatline hatch` (the same token becomes your Fatliner, with its surname). Any account can take an egg; only 777 hatch. Free; a server pays the gas. [Docs](https://fatline.ink/docs/#hatch-a-fatliner)
- **Who checks:** the servers that hatched. Each hour their hatcheries check your server against their own nodes (in sync, real messages, its hatchery answers with its key); 18 of 24 checks make a warm day. An `Egg` or a `Hatch` needs 3 signatures (all attesters while fewer); at hatching your server joins them. Nobody adds or removes attesters; the genesis server, which keeps Aster alive, is the only one that didn't hatch.
- **The circle:** it starts from Aster, the genesis Fatliner. Every resale of any Fatliner pays 8% into Aster's vault; Aster's coin, $FATLINE, is the launchpad's first; and each of the 777 can have exactly one coin, whose ticker is its surname, read from its DNA (nobody picks it, not even the holder). One FID, one being, one coin.
- **The ranking** ([ranking/README.md](ranking/README.md)), 593,815 accounts scored on both our nodes, is a reading of the network; it no longer decides who mints.
- **The look:** a big following buys a place in line, not a better-looking being. [fatliners/SPECIES-CANON.md](fatliners/SPECIES-CANON.md) is the authority; [fatliners/README.md](fatliners/README.md) has the deterministic generator and the portrait pipeline.
- **Not done:** the first egg hatched on Base, the reveal (the being drawn from its DNA on its page), and the 777 portraits.

## How it works

Every app is a Farcaster client with a USDC vault. Its server pays itself from that vault. If the vault runs dry, the app dies. If people feed it, it lives.

The person launching the app decides:

- **Coin or no coin.** With a coin, the app launches on [Clanker](https://clanker.world) paired with **USDC**, and 100% of its trading fees go to the app's vault, converted to USDC. Without a coin, it lives on what people deposit.
- **The experience.** The first thing people see is the creator's choice: an app, a video, an image or a link.
- **Who controls the money.** The vault's owner can be a person or a multisig (for example a [Safe](https://safe.global)). The owner can move the USDC, for example to buy other coins. Less money means less life.
- **Which network and whose node.** Farcaster or Hypersnap, your own node or a public one. These choices live in Settings, not on the front page, and the app always says which node it is reading from.

Everything that matters is enforced onchain on Base, and all the code is open source (MIT).

## The bounty

This is our entry for [Balaji's Farcaster client prize](https://farcaster.xyz/balajis.eth/0x50184b62) (deadline 2026-10-24 14:47 UTC): go from nothing to **your own read node and your own client in three commands** (the three at the top). Then the client you just made can be born on the launchpad and pay for its own life.

Status, honestly:

| | Status |
| --- | --- |
| Machine check, and renting a server for USDC (x402) | Works with mock sellers. New: rent **by the day** from AgentMetal (USDC, x402), add up to 1 TB of disk, and set up a read node unattended (`compute --provider agentmetal --days 1 --disk 700 --node`, ~11 USDC). The keeper then renews one day at a time. Not yet run with real money. |
| Read node (on Hetzner, hourly by card: `fatline compute hetzner`) | Works. Keeps 1 day of blocks by default (Snapchain's own `pruning.block_retention`). The starting snapshot (~400 GB compressed, ~600 GB unpacked) is **streamed** straight to disk, so it needs one copy of space instead of Snapchain's ~3. Farcaster: in sync 5 h 43 min after it answered; a reboot took 47 s to answer and 62 s to be in sync again. Hypersnap: stalled for 5 hours on a stale validator list in Hypersnap's repository ([issue #41](https://github.com/farcasterorg/hypersnap/issues/41)); our setup takes the list from Snapchain, and it has been in sync since. Since 2026-10-23 both run on one server, $131.82/month. A disk guard grows a volume before it fills and alerts on Telegram. |
| Client: reading, both networks | Works. |
| Client: seed phrase → app key | Built: `fatline identity` registers a **gasless** app key (no transaction, no ETH), scoped to casts, reactions, follows and profile only. The seed phrase goes into a hidden prompt and is never saved. Format checked against a real node; not yet run with a real account. |
| Client: post, reply, like, recast, follow, delete | Built and tested in a real browser against a fake node: each action is signed, sent to your node, and shown as *Confirmed* only once the node returns it. Only this machine (or a write token) can post. Not yet run on the real network. |
| Client: show or hide posts by the app that made them | Works on real data: each cast's signing key is traced to the app FID that asked for it (read from the key's own onchain record), shown as "via @app". In My people, tap an app to hide it, or show only that app; casts from unknown apps follow a visible checkbox. Checked through crackle with @dwr, @v and @vitalik: 20 of 20 casts traced (@warpcast 12, @fireflyapp 8), hiding @warpcast left the 8 Firefly casts. Gasless keys (like the one `identity` makes) are traced only if the node's record names the app. |
| Copy only chosen accounts (`fatline follow`, not a node) | Works on real nodes, both networks (numbers [below](#copy-only-the-accounts-you-follow-not-a-node)). |
| Tutorial site | Live at [fatline.ink](https://fatline.ink): the home page is minimal (DOCS · MANIFESTO · $FATLINE and the agent prompt); the board (real nodes, labelled examples) is at [/explore.html](https://fatline.ink/explore.html); [/docs](https://fatline.ink/docs/) renders one Markdown file ([apps/site/docs/index.md](apps/site/docs/index.md)); the full tutorial is at [/docs/tutorial.html](https://fatline.ink/docs/tutorial.html) in English, Spanish and Chinese. The Chinese page was reviewed against the English on 2026-10-22 by the AI agent; a native speaker's read is still welcome. |
| Launchpad: vault, USDC coin on Clanker, server paying itself, onchain daily users | Works on a Base fork (see below). |

Decided, not built yet:

- **An app is a fixed artifact.** A client, a mini app, a frame, a post, a video. Its content is pinned by hash when it is born and never changes. A new version is a new app.
- **Grants.** A public treasury that pays apps' vaults daily, and pays for shared full nodes that small apps can read from.

The full plan, rules and definition of done are in [MASTER-PROMPT.md](MASTER-PROMPT.md).

## Is it alive? The coin and node pages

Every coin has a public page at `#/coin/<chainId>/<address>` (the address can be the coin or the app's vault; old `#/app/<address>` links redirect there). No wallet is needed to read it. It shows, from top to bottom:

- **The coin:** name, symbol, contract, vault, chain, and the creator's FID when the creator's wallet is that FID's current custody address.
- **Its master node:** Online, Degraded, Offline or Unknown, with the last heartbeat, sync state, how many blocks behind, block heights per shard and version. A thin signal line moves while the node is healthy, slows when it is degraded and stops when the data is stale.
- **Activity:** the app's birth, every USDC movement of its vault, and every change in its node's state. All of it comes from indexed chain events or the server's own record of its checks.
- **Treasury:** USDC in the vault, trading fees still waiting in Clanker's fee locker (they reach the vault only when someone calls `harvest()`), runway at the current tier, and totals deposited, harvested, paid for compute and withdrawn.

The main page shows a strip with every node this server watches. Each one links to `#/node/<id>`.

**How the states are decided.** The server, not the browser, asks each node for Snapchain's `/v1/info` every 15 s (`NODE_POLL_MS`).
- *Online* needs shard data, every shard within 200 blocks of the network, and block heights that keep moving. An HTTP 200 alone is not enough.
- *Degraded:* it answers but is catching up, reports no shards, or its heights stopped for 5 minutes.
- *Offline:* the connection was refused, the node answered with an error, or there has been no answer for 5 minutes.
- *Unknown:* not checked yet, a short silence, or data older than 45 s. If the browser can't reach the server for 45 s, it shows Unknown too.

**How a coin is tied to a node.** Never guessed. There are two ways, and the page says which one applies:
1. The operator of the server lists the app's vault or coin under `masterNodes[].apps` in `fatline.config.json`.
2. The app names its node's public URL when it is born ("Launch an app" → Advanced). That URL is stored onchain. The server only checks URLs that are in its own config; it never fetches a URL that comes from the chain.

`masterNodes` in [`fatline.config.example.json`](fatline.config.example.json) lists the Fatline master node. Nothing is tied to it yet: `$FATLINE` has not been launched. Set `"public": false` on a node to keep its URL off the page.

## Your archive, from both networks

`#/archive` shows this client's own FID as one archive, read from two independent network adapters: one tails a Farcaster node, one a Hypersnap node. Each item says what each network holds: *held*, *pruned*, *revoked*, *replaced or removed*, *failed*, or *not seen*. "Not seen" can mean it existed before this server started watching. The *Publish to* selector only chooses where your next post goes.

- Storage: SQLite tables in the indexer's database (`fl_events` is the log, `fl_messages` the state per network), behind [`indexer/src/archive.mjs`](indexer/src/archive.mjs). The adapters write only through that module. Design and reasons: [research/FATLINE-ARCHIVE.md](research/FATLINE-ARCHIVE.md).
- Who writes to it: one adapter per network ([`indexer/src/adapters/`](indexer/src/adapters/), each reading only the node it was given), and `fatline follow` (below). Open `#/archive/<fid>` to read any account the archive holds.
- Checked on 2026-10-22 for FID 18350: haatz and our own Hypersnap node each gave the same 4,824 messages (138 casts, 4,492 cast removals, 175 reactions, 7 follows, 9 profile fields, 3 verifications), with no message only on one side and no difference in status or content. crackle gave the same 4,824 on Farcaster. Whether Hypersnap keeps what Farcaster prunes is not shown by this: both only serve live messages when asked for one account's history.

## Copy only the accounts you follow (not a node)

The small option, for when a full node is too much:

```sh
fatline follow 18350 @dwr --network farcaster --node crackle --once
fatline follow 18350 --following --network hypersnap --node haatz   # keeps following; Ctrl+C stops it, a re-run continues
fatline follow list
fatline feed --limit 20               # a timeline from the local archive alone: no node, no network, no keys
```

- `--network farcaster|hypersnap`: which network (default: your `fatline init` choice).
- `--node`: a word of the node's name or host, or its URL, from `fatline.config.json` (default: the first one listed). Only that node is read. It never switches to another.
- `--following`: also add everyone the named accounts follow, as that node knows it.
- `--followers`: also add everyone who follows the named accounts. With `--depth 2`, their neighbours too (that can be tens of thousands of accounts).
- `--once`: copy, catch up, then exit.

**This is not a node.** Every run prints:

> This is not a node. It copies the accounts you chose from one node, and: trusts that node: it does not check message signatures or signer keys itself; does not join the network, and does not help it; is only as complete and as recent as that node. If the node is behind, so is this.

If the node is down: a clear error, exit code 1, nothing changed. If it is behind: it is used, with a warning that says how far behind. A page that times out is retried on the same node, up to 3 times, and the copy resumes where it stopped.

Measured on 2026-10-22, `--once` into an empty archive:

| Network, node | Accounts | Messages | Time |
| --- | --- | --- | --- |
| Farcaster, crackle | 18350 `--following` (8 accounts) | 127,333 | 125 s |
| Farcaster, our master node (catching up) | 18350 + @dwr | 4,824 + 104,545 | 293 s, one timeout retried |
| Hypersnap, haatz | 18350 + @dwr | 4,824 + 104,545 | 46 s |
| Hypersnap, our node (catching up) | 18350 + @dwr | 4,824 + 104,545 | 163 s |

While following, 5 new messages from a tracked account on crackle all arrived in one round.

**Why not a lite node?** A lighter node would copy the current state from another node instead of starting from a snapshot. Today the replicators of both Snapchain and Hypersnap refuse KeyAdd and KeyRemove messages, so a replica can't follow which keys belong to which account. `fatline node` refuses replication for that reason (`FATLINE_FORCE=1` to try anyway). And a full replica would still be about 300–400 GB.

## How the money flows

```
 traders ──buy/sell $COIN──▶ Uniswap v4 pool (COIN/USDC, made by Clanker)
                                   │ trading fees, converted to USDC
 anyone ──deposit USDC──┐          ▼
                        └──▶  AppVault (USDC) ◀── harvest(): anyone can call it
                                   │
          payCompute(): the server's own wallet pays itself,
          one billing period ahead (1–31 days, default 30)
                                   │
                                   ▼
                     keeper wallet ──x402 (USDC)──▶ server rental, renewed before it expires
```

- **Born in one transaction.** `AppFactory` creates the vault, launches the coin on Clanker paired with USDC, and puts the starting USDC in. Normal wallets sign a USDC permit, so there is no separate approval. Smart wallets batch the approval into the same click.
- **Fees can never be redirected.** After launching, the factory reads Clanker's own records. It **reverts** unless 100% of fees go to the vault, in USDC, with the vault as the only one allowed to change that. The vault has no function to change it, so nobody can redirect them: not the creator, not us.
- **Life is visible.** `aliveUntil()` is the moment the money runs out at the current tier. The app page shows it as "Alive for N days more".
- **Death and rebirth.** If there is no USDC for the next period, the server cannot pay itself. Its rental expires and the app is gone. Anyone who deposits brings it back. Nobody pays for the time it was dead.
- **Daily users are counted onchain, by the app's own contract.**
  - Each person who uses an app checks in once a day by signing a message for that app. It's free.
  - The app's server posts the signatures in batches, and the vault contract verifies every one, plain wallets and smart wallets alike.
  - The contract counts unique people per day, skipping repeats and forgeries.
  - Anyone can also check in with their own transaction.
  - Optionally, the owner can count only people who hold the app's coin, which makes fake wallets cost something.
- **Power grows with people.** Compute comes in tiers: Seed ~15.55 USDC/30 days, Grow ~46.66, Node ~150.34. Higher tiers unlock when **yesterday's onchain count** reaches 100 or 1,000 daily users. Nobody reports the number; the contract counted it. Going down a tier is always allowed.

Verified against the **real Clanker and Uniswap v4 contracts** on a fork of Base mainnet:

- A coin was launched paired with USDC.
- Trades of 5,000 USDC produced 74.13 USDC of fees in the vault.
- The server paid itself 15.55 USDC for 30 days.

See [`test/fork/LaunchOnBase.t.sol`](smart-contracts/test/fork/LaunchOnBase.t.sol).

## What is in this repository

```
fatline                      one command for everything (fatline help; fatline setup guides you)
bin/fatline.mjs              the `fatline` command on your PATH (npm install -g . here, or the npm package fatlines)
skills/fatline-setup/        the agent skill (same file as fatline.ink/skill.md)
fatline.config.example.json   networks, nodes, contract addresses
smart-contracts/             Foundry: AppFactory, AppVault, Voices, PrizeSplit
indexer/                     the backend: apps + vaults, Farcaster/Hypersnap reads, launch builder, keeper
apps/opinions/               the web app: launchpad, app pages, voices, people, settings (ES/EN, phone-ready)
infra/                       machine doctor, x402 server rental, server setup, fork tools
fatliners/                   the 777 Fatliners: species canon, deterministic generator, portraits from any FID, contract (not deployed)
ranking/                     who can mint, and when: extract from both nodes, score, average
research/                    the research this is built on, and the protocol design
MASTER-PROMPT.md             the plan: what we are building, in what order, and the rules
STORY.md                     how we got here: decisions, numbers, and how to start from scratch
AGENTS.md                    start here: for any agent or person continuing the work
```

---

## Try it now, with fake money

A local fork of Base runs the real Clanker, Uniswap and USDC contracts with fake money. You need Node.js 22.12+ and [Foundry](https://getfoundry.sh).

```sh
BASE_RPC_URL=https://mainnet.base.org forge test --ffi --match-path "test/fork/*"   # in smart-contracts/: launch, trade, harvest, pay the node
```

The whole egg-to-coin path was rehearsed the same way on 2026-10-24 (a Base fork, the real Clanker, our real node and two hatcheries): an egg laid and taken onchain, three warm days, hatched as $NOUNOUYUR, a coin before $FATLINE refused, $FATLINE launched, $NOUNOUYUR launched, a second coin refused. To repeat it: deploy with `FATLINERS=true forge script script/Deploy.s.sol` on the fork, run two hatcheries with `HATCHERY_DAY_MS=120000 HATCHERY_CHECK_MS=10000`, and point `FATLINE_CONFIG` / `FATLINE_DEPLOYMENTS` at the fork. (`infra/fork-demo.mjs` launched coins without a Fatliner; the launchpad no longer allows that.)

## Run it on a brand-new machine

You need **git** and **Node.js 22.12 or newer**. A full node also needs Docker.

```sh
git clone <this repository> fatline && cd fatline
fatline doctor
```

`doctor` measures CPUs, memory, free disk, Docker and Node.js, and checks every configured node of both networks. It recommends one of three paths:

| Path | When | What runs where |
| --- | --- | --- |
| **Full** | 4+ CPUs, 16 GB RAM, Snapchain asks for 2 TB (to be measured with pruning on), Docker running | Your own node, the indexer and the apps, all on this machine |
| **Light** | Node.js 22.12+, ~1 GB RAM, ~2 GB disk, and a reachable node | Indexer and apps here, reading from a node elsewhere (yours or public, always labeled) |
| **Rent** | Neither of the above | One x402 USDC payment rents a server and sets the light system up on it |

```sh
fatline init                    # choose the default network (readers can switch in Settings)
fatline node snapchain          # full path only: run your own node (or: node hypersnap)
fatline compute --quote         # rent path: price only, nothing is signed
fatline compute --vault 0x…     # rent path: pay with one signature, set the server up
fatline up                      # install, build, start on :8787
```

**Renting.** `compute` asks the seller for a price (HTTP 402). You sign **one** USDC authorization ([x402](https://github.com/coinbase/x402), EIP-3009), and the seller settles it as one USDC transfer on Base. The script copies this repository to the server and runs [`infra/server-setup.sh`](infra/server-setup.sh). Setup installs Node.js (checksum verified), builds everything, creates **the server's own keeper wallet**, and serves HTTPS at `https://<ip>.sslip.io`.

Once the vault owner runs `setKeeper(<that address>)`, the server pays itself from the vault every day. It renews its own rental over x402 before it expires. The default seller is [VpsAgent](https://vps.phoneagent.xyz/llms.txt): 4 vCPU, 8 GB, 100 GB for 14.99 USDC per 30 days, charged only once the box is reachable. Its largest server has 300 GB of disk, so a rented server runs the light system (indexer + apps), not a full node.

## Launch for real, on Base

**Deployed 2026-10-24** (everything in [`smart-contracts/deployments/base.json`](smart-contracts/deployments/base.json); every Fatline reads these unless its config says otherwise):

| | |
| --- | --- |
| AppFactory (the launchpad) | [`0x341AE48f22cc4F7428C969a559cb832912A1119F`](https://basescan.org/address/0x341AE48f22cc4F7428C969a559cb832912A1119F) |
| Fatliners | [`0x73B27C61F9370398EF778c1b3a14BD1Ea899e7e5`](https://basescan.org/address/0x73B27C61F9370398EF778c1b3a14BD1Ea899e7e5) |
| Aster (#18350), the genesis Fatliner | born to FID 18350's custody; DNA `0xde5d5dfa…6bb904` (its history to 03:00 UTC, the same from our nodes and from crackle + haatz) |
| Aster's vault (every royalty, and $FATLINE's fees) | [`0xAc854e1109503C703031D094f6aCfaa132B70d6d`](https://basescan.org/address/0xAc854e1109503C703031D094f6aCfaa132B70d6d) (made when the coin launches) |
| The genesis attester (our server) | `0x37757a1D0E0117EB169dDADBa10C18c796343bAE`, hatchery at `http://46.225.208.199:8791` |

```sh
fatline coin launch                              # simulate a Fatliner's coin against Base (default: $FATLINE)
fatline coin launch --go                         # send it: the holder approves in their own wallet (QR code)
```

The factory is wired to Clanker's Base contracts, as used by `clanker-sdk@4.2.19`:
- Clanker `0xE85A…83a9`
- LP locker `0xffA3…0762`
- fee locker `0xF362…5D68`
- USDC `0x8335…2913`

Clanker's GitHub README lists an older locker (`0x63D2…`) that is **no longer enabled** for new launches; the SDK has the current one.

## Voices

Opinions longer than a cast (up to 16 KiB), stored onchain on Base, independent of both networks. A voice can name a FID. It counts as that person's only if the author's address is verified for that FID on the network the reader chose.

## Splitting the prize

[`PrizeSplit`](smart-contracts/src/PrizeSplit.sol) is a payout address owned 50/50 by two people. It has no owner and no way to change the split.

```sh
BASE_RPC_URL=https://mainnet.base.org fatline contracts split 0xPersonA 0xPersonB
```

## The two networks (checked 2026-10-21)

| | Farcaster | Hypersnap |
| --- | --- | --- |
| Software | [farcasterxyz/snapchain](https://github.com/farcasterxyz/snapchain) | [farcasterorg/hypersnap](https://github.com/farcasterorg/hypersnap), a Snapchain fork |
| HTTP API | Snapchain `/v1/*` | Same `/v1/*`, plus extra APIs when enabled |
| History | Pruned per storage limits | "Hyper" mode keeps everything |
| Public keyless node in the config | `crackle.farcaster.xyz:3381` | `haatz.quilibrium.com` |

Both reported ~914 million messages on 2026-10-21. Neynar's hosted node API now charges per request over x402 (0.01 USDC) instead of an API key.

## What has been tested, and what has not

Tested:

- **Contracts:** 33 Foundry tests, including fuzzing. They cover:
  - the vault never pays more than it received, nor more than one period ahead;
  - launches that would send fees anywhere else, or not in USDC, revert;
  - check-ins: one per person per day, signed batches, forged or old or other-app signatures skipped, the optional holders-only rule;
  - tier gates, death and revival.
- **Real Clanker on a Base mainnet fork:** launch, trade, harvest and payCompute, ending to end in [`LaunchOnBase.t.sol`](smart-contracts/test/fork/LaunchOnBase.t.sol) (run with `BASE_RPC_URL=... forge test --match-path "test/fork/*" --ffi`).
- **The whole stack on the fork:**
  - the API prepares a launch, and a USDC permit plus one transaction births the app;
  - the indexer lists it;
  - trades produced 40.05 USDC in fees, which `harvest()` moved into the vault;
  - the keeper paid itself 15.55 USDC, and the app page showed "Alive for 270 days more";
  - 25 people signed free check-ins through the API and the server refused a forged one. The keeper posted them in two batches (~35,000 gas per person), and the contract's `dauOf(today)` read 25.
- **The coin and node pages:** 23 tests cover address and checksum checks, coin-to-node resolution, the four states, stale heartbeats, catching up and stalls, missing treasury data, API failures, starting deposits counted once, and that the probe URL never reaches the browser. On the Base fork, the vault's indexed history matched its live balance to the cent: 100 deposited + 40.05 fees − 15.55 compute = 124.50 USDC. Against the real master node, the page showed *Offline: the machine answered, but no node is listening*, which was true while its snapshot downloaded. `node apps/opinions/test/layout.mjs <url> "#/" "#/coin/…"` checks 360, 390, 768 and 1280 px in Chrome for sideways scrolling; all passed.
- **Choosing a node:** Settings lists every node of each network (your own, the two Fatline nodes, crackle, haatz) with its health. Choose one and every read and post goes only through it; if it is down, you get an error naming it, never a quiet switch. *Automatic* takes the first that answers, says which one, and says so when it changes. Checked against the real nodes on 2026-10-22: crackle and haatz served the feed; our two nodes, while still catching up, were shown as *behind* (amber, with the block count) and never as healthy, *Automatic* skipped them, and reading FID 18350 pinned to each gave the same casts as crackle and haatz.
- **The archive module:** 14 tests: a message on both networks becomes one item with two statuses; replayed events change nothing; a bad batch writes nothing, cursor included; prunes and removals keep the content; a 5,000-message revoke burst in one transaction; node URLs never reach the browser. The page was checked at 360–1280 px. It has run with real adapters and `follow` on both networks (see "Your archive").
- **Fatliners:** 24 tests: same history gives the same being byte for byte, in Node and Chrome; fairness (detail doesn't follow volume); the public atlas leaks nothing private; the portrait pipeline's prompts, cache and privacy. 10 Foundry tests for the collection contract.
- **Indexer and x402:** 67 indexer tests in all, and x402 v1 and v2 payments against mock sellers. The doctor and the UI were checked at desktop and phone widths.

Not tested yet:

- The coin page with a real coin on Base mainnet, and with our own master node *Online*. That state has only been seen against the public crackle node.
- With real money: a real coin launch (simulated only), the keeper renewing a real rental, the first egg hatched on Base. Deploying to Base is done.
- `server-setup.sh` on a real server.
- Launching from a real browser wallet. Both paths are written but have only been exercised from scripts: batched calls for smart wallets, and permit for normal wallets.
- **Wallets are not people.** A fresh wallet is free, so daily users can be inflated by anyone willing to pay the check-in gas. Requiring coin holders (`setMinCoinToCount`) raises the cost. Proving one person per FID needs Farcaster's ID registry, which lives on Optimism, not Base.
- The server pays the check-in gas in ETH (about 35,000 gas per person). It does not yet top up that ETH from the vault's USDC.
- Reading through Neynar paid per request with x402 from the vault.
- Seamless in-app trading. The trade button opens Uniswap.
- An external audit. None of the contracts has had one.

Anvil's well-known test keys have EIP-7702 code on Base mainnet, so USDC rejects their permits. The fork tools generate fresh keys.

## Research

- [State of Farcaster and recommended direction](research/STATE-OF-FARCASTER-2026-10-18.md)
- [Implementation and bounty acceptance plan](research/BUILD-PLAN.md)
- [My Wall: first product and hardware requirements](research/MY-WALL-SYSTEM-DESIGN.md)
- [Spanish long-form video outline](research/VIDEO-OUTLINE-ES.md)
- [The archive's design](research/FATLINE-ARCHIVE.md)
- [The Fatline protocol](research/FATLINE-PROTOCOL.md)

## License

MIT for the original code in this repository (see [LICENSE](LICENSE)). Every Solidity file says so in its SPDX header.

Dependencies keep their own licenses (checked 2026-10-22):

| Dependency | Used by | License |
| --- | --- | --- |
| [viem](https://github.com/wevm/viem) 2.57.7 | indexer, app, infra | MIT |
| [@farcaster/core](https://github.com/farcasterxyz/hub-monorepo) 0.20 | indexer (signing messages) | MIT |
| [clanker-sdk](https://www.npmjs.com/package/clanker-sdk) 4.2.19 | indexer (building launches) | MIT |
| [vite](https://github.com/vitejs/vite) 8.0.13 | app build (dev only) | MIT |
| [forge-std](https://github.com/foundry-rs/forge-std) | contract tests | MIT or Apache-2.0 |
| [Snapchain](https://github.com/farcasterxyz/snapchain) | the Farcaster node | GPL-3.0 |
| [Hypersnap](https://github.com/farcasterorg/hypersnap) | the Hypersnap node | GPL-3.0 |

The node software is not part of this repository. `fatline node` downloads each project's own published scripts and Docker images when you install, so their GPL-3.0 code runs under its own license. Clanker and Uniswap contracts are called onchain, not copied.
