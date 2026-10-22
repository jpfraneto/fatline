# Farline

**Your own Farcaster client that pays for its own life.** It reads from your own node, posts with its own app key, and lives on a USDC vault on Base: its server pays itself from that vault.

```sh
./infinicaster compute          # (0) rent a server that can hold a node
./infinicaster node farcaster   # (1) your own read node on it, no API keys (or: node hypersnap)
./infinicaster client           # (2) your client, reading from your node; its vault comes from "Launch an app" in it
```

**Status:** each command has been run on its own; a fresh run of all three, start to finish, is untested. `compute` rents a node-capable Hetzner machine (price first, then you type "create"). `node <network>` installs that node there, follows the snapshot, and makes it your own node once it answers (`--local` installs on your own machine instead). `client` reads from it.

Before them: `git clone https://github.com/jpfraneto/infinicaster && cd infinicaster`. You need git, ssh and Node.js 22.12+, plus a Hetzner Cloud account with a card and an API token in `~/.hetzner-token`. New Hetzner accounts have limits (ours: 1,385 GB of volumes, 14 vCPUs), so one account fits one full node; Farcaster and Hypersnap side by side need two servers. Or use Docker on a machine of your own: `./infinicaster node farcaster --local`. The vault step is proven on a local fork of Base only: `AppFactory` is not deployed on Base mainnet yet (see "Status" below). The tutorial is in [`apps/site/index.html`](apps/site/index.html), in English and Spanish.

Farline is where Infinicaster is going: infrastructure for autonomous apps, built on Farcaster identity, onchain money and software that keeps running on its own. The repository, the CLI (`./infinicaster`) and the contracts keep the Infinicaster name for now.

## How it works

Every app is a Farcaster client with a USDC vault. Its server pays itself from that vault. If the vault runs dry, the app dies. If people feed it, it lives.

The person launching the app decides:

- **Coin or no coin.** With a coin, the app launches on [Clanker](https://clanker.world) paired with **USDC**, and 100% of its trading fees go to the app's vault, converted to USDC. Without a coin, it lives on what people deposit.
- **The experience.** The first thing people see is the creator's choice: an app, a video, an image or a link.
- **Who controls the money.** The vault's owner can be a person or a multisig (for example a [Safe](https://safe.global)). The owner can move the USDC, for example to buy other coins. Less money means less life.
- **Which network and whose node.** Farcaster or Hypersnap, your own node or a public one. These choices live in Settings, not on the front page, and the app always says which node it is reading from.

Everything that matters is enforced onchain on Base, and all the code is open source (MIT).

## Where this is going

This is our entry for [Balaji's Farcaster client prize](https://farcaster.xyz/balajis.eth/0x50184b62) (deadline 2026-10-24 14:47 UTC): go from nothing to **your own read node and your own client in three commands** (the three at the top). Then the client you just made can be born on the launchpad and pay for its own life.

Status, honestly:

| | Status |
| --- | --- |
| Machine check, and renting a server for USDC (x402) | Works with mock sellers. New: rent **by the day** from AgentMetal (USDC, x402), add up to 1 TB of disk, and set up a read node unattended (`compute --provider agentmetal --days 1 --disk 700 --node`, ~11 USDC). The keeper then renews one day at a time. Not yet run with real money. |
| Read node (also on Hetzner, hourly by card: `./infinicaster compute hetzner`, ~$2.50/day) | Keeps 1 day of blocks by default (Snapchain's own `pruning.block_retention`). On a rented server the starting snapshot (~400 GB compressed, ~600 GB unpacked) is **streamed** straight to disk, so it needs one copy of space instead of Snapchain's ~3. Next: sync one for real and measure. |
| Client: reading, both networks | Works. |
| Client: seed phrase → app key | Built: `./infinicaster identity` registers a **gasless** app key (no transaction, no ETH), scoped to casts, reactions, follows and profile only. The seed phrase goes into a hidden prompt and is never saved. Format checked against a real node; not yet run with a real account. |
| Client: post, reply, like, recast, follow, delete | Built and tested in a real browser against a fake node: each action is signed, sent to your node, and shown as *Confirmed* only once the node returns it. Only this machine (or a write token) can post. Not yet run on the real network. |
| Client: show or hide posts by the app that made them | Works on real data: each cast's signing key is traced to the app FID that asked for it (read from the key's own onchain record), shown as "via @app". In My people, tap an app to hide it, or show only that app; casts from unknown apps follow a visible checkbox. Checked through crackle with @dwr, @v and @vitalik: 20 of 20 casts traced (@warpcast 12, @fireflyapp 8), hiding @warpcast left the 8 Firefly casts. Gasless keys (like the one `identity` makes) are traced only if the node's record names the app. |
| Tutorial site (English + Spanish) | Not started. |
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
1. The operator of the server lists the app's vault or coin under `masterNodes[].apps` in `infinicaster.config.json`.
2. The app names its node's public URL when it is born ("Launch an app" → Advanced). That URL is stored onchain. The server only checks URLs that are in its own config; it never fetches a URL that comes from the chain.

`masterNodes` in [`infinicaster.config.example.json`](infinicaster.config.example.json) lists the Farline master node. Nothing is tied to it yet: `$INFINICASTER` has not been launched. Set `"public": false` on a node to keep its URL off the page.

## Your archive, from both networks

`#/archive` shows this client's own FID as one archive, read from two independent network adapters: one tails a Farcaster node, one a Hypersnap node. Each item says what each network holds: *held*, *pruned*, *revoked*, *replaced or removed*, *failed*, or *not seen*. "Not seen" can mean it existed before this server started watching. The *Publish to* selector only chooses where your next post goes.

- Storage: SQLite tables in the indexer's database (`fl_events` is the log, `fl_messages` the state per network), behind [`indexer/src/archive.mjs`](indexer/src/archive.mjs). The adapters write only through that module. Design and reasons: [research/FARLINE-ARCHIVE.md](research/FARLINE-ARCHIVE.md).
- The adapters (`indexer/src/adapters/`) are being built in parallel by other sessions. Until one runs, the archive is empty.

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
infinicaster                 one command for everything (./infinicaster help)
infinicaster.config.example.json   networks, nodes, contract addresses
smart-contracts/             Foundry: AppFactory, AppVault, Voices, PrizeSplit
indexer/                     the backend: apps + vaults, Farcaster/Hypersnap reads, launch builder, keeper
apps/opinions/               the web app: launchpad, app pages, voices, people, settings (ES/EN, phone-ready)
infra/                       machine doctor, x402 server rental, server setup, fork tools
research/                    the research this is built on
MASTER-PROMPT.md             the plan: what we are building, in what order, and the rules
STORY.md                     how we got here: decisions, numbers, and how to start from scratch
AGENTS.md                    start here: for any agent or person continuing the work
```

---

## Try it now, with fake money

A local fork of Base runs the real Clanker, Uniswap and USDC contracts with fake money. You need Node.js 22.12+ and [Foundry](https://getfoundry.sh).

```sh
./infinicaster contracts fork          # fork Base, deploy AppFactory + Voices, fund a dev wallet with 10,000 USDC
./infinicaster up                      # in another terminal: indexer + app on http://localhost:8787
node infra/fork-demo.mjs               # launch an app like the browser does, then trade its coin
node infra/fork-crowd.mjs <vault> 25   # 25 people check in for free; the keeper posts them onchain
```

To launch from the browser, import the dev key from `.infinicaster/dev.key` into a browser wallet and add the network `http://127.0.0.1:8545` (chain 8453). Then open **Launch an app**. Public RPCs are slow for forks; set `BASE_RPC_URL` to your own Base RPC if it times out.

## Run it on a brand-new machine

You need **git** and **Node.js 22.12 or newer**. A full node also needs Docker.

```sh
git clone <this repository> infinicaster && cd infinicaster
./infinicaster doctor
```

`doctor` measures CPUs, memory, free disk, Docker and Node.js, and checks every configured node of both networks. It recommends one of three paths:

| Path | When | What runs where |
| --- | --- | --- |
| **Full** | 4+ CPUs, 16 GB RAM, Snapchain asks for 2 TB (to be measured with pruning on), Docker running | Your own node, the indexer and the apps, all on this machine |
| **Light** | Node.js 22.12+, ~1 GB RAM, ~2 GB disk, and a reachable node | Indexer and apps here, reading from a node elsewhere (yours or public, always labeled) |
| **Rent** | Neither of the above | One x402 USDC payment rents a server and sets the light system up on it |

```sh
./infinicaster init                    # choose the default network (readers can switch in Settings)
./infinicaster node farcaster          # full path only: run your own node (or: node hypersnap)
./infinicaster compute --quote         # rent path: price only, nothing is signed
./infinicaster compute --vault 0x…     # rent path: pay with one signature, set the server up
./infinicaster up                      # install, build, start on :8787
```

**Renting.** `compute` asks the seller for a price (HTTP 402). You sign **one** USDC authorization ([x402](https://github.com/coinbase/x402), EIP-3009), and the seller settles it as one USDC transfer on Base. The script copies this repository to the server and runs [`infra/server-setup.sh`](infra/server-setup.sh). Setup installs Node.js (checksum verified), builds everything, creates **the server's own keeper wallet**, and serves HTTPS at `https://<ip>.sslip.io`.

Once the vault owner runs `setKeeper(<that address>)`, the server pays itself from the vault every day. It renews its own rental over x402 before it expires. The default seller is [VpsAgent](https://vps.phoneagent.xyz/llms.txt): 4 vCPU, 8 GB, 100 GB for 14.99 USDC per 30 days, charged only once the box is reachable. Its largest server has 300 GB of disk, so a rented server runs the light system (indexer + apps), not a full node.

## Launch for real, on Base

```sh
BASE_RPC_URL=https://mainnet.base.org ./infinicaster contracts deploy   # AppFactory + Voices; asks for the key
./infinicaster up                                                     # then: Launch an app
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
BASE_RPC_URL=https://mainnet.base.org ./infinicaster contracts split 0xPersonA 0xPersonB
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
- **Choosing a node:** Settings lists every node of each network (your own, the two Infinicaster nodes, crackle, haatz) with its health. Choose one and every read and post goes only through it; if it is down, you get an error naming it, never a quiet switch. *Automatic* takes the first that answers, says which one, and says so when it changes. Checked against the real nodes: crackle served the feed, and the master node (not serving yet) gave a clear error.
- **The archive module:** 12 tests: a message on both networks becomes one item with two statuses; replayed events change nothing; a bad batch writes nothing, cursor included; prunes and removals keep the content; a 5,000-message revoke burst in one transaction; node URLs never reach the browser. The page was checked at 360–1280 px with sample events in a scratch database. It has not run with real adapters yet.
- **Indexer and x402:** 8 indexer tests, and x402 v1 and v2 payments against mock sellers. The doctor and the UI were checked at desktop and phone widths.

Not tested yet:

- The coin page with a real coin on Base mainnet, and with our own master node *Online*. That state has only been seen against the public crackle node.
- Anything with real money: deploying to Base, a real launch, a paid server rental, the keeper renewing a real rental.
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

## License

MIT for the original code in this repository (see [LICENSE](LICENSE)). Clanker, Uniswap, the node software and other dependencies keep their own licenses.
