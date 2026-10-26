# The story so far

This file records how Fatline got here, what was decided and why. With it, someone (a person or an agent) can start from an empty folder and arrive at the same place. [MASTER-PROMPT.md](MASTER-PROMPT.md) is the plan going forward. This file is the memory behind it.

Dates are UTC. The project began on 2026-10-18.

## 1. Where it started (Oct 18–20)

- **Balaji's bounty** ([the post](https://farcaster.xyz/balajis.eth/0x50184b62)) offers $2,048 for the easiest path to your own Farcaster read node plus a client, in three commands. Requirements:
  - no API keys from anyone;
  - import a seed phrase and give the client its own app key;
  - post, follow, react, and include or exclude casts from other clients;
  - a phone- and desktop-friendly tutorial that explains the protocol;
  - at least one other human going through it and vouching publicly.
  - Deadline: **2026-10-24 14:47:30 UTC**.
- **First research** went into [research/](research/): the state of Farcaster, Snapchain vs Hypersnap, gasless app keys, why client filtering needs signer → app attribution, and a first product called "My Wall".
- **A friend's idea:** a feed for opinions longer than 320 characters (a cast's limit). It became **Voices**, opinions up to 16 KiB stored onchain on Base.
- **The principle, from the owner:** "if we want this thing to be aligned with a cypherpunk manifesto, *it needs to be open and the users need to be able to choose*." In practice:
  - Farcaster and Hypersnap are treated as equals;
  - the user picks the network and the node;
  - we collaborate instead of making enemies;
  - the prize is split 50/50 with a friend, enforced by a contract ([`PrizeSplit`](smart-contracts/src/PrizeSplit.sol)).
- **"It has life, and that life is money":** the setup checks the machine. If the machine is too small, it proposes renting compute with one x402 USDC payment.

## 2. The pivot: a launchpad (Oct 21)

The owner's realization: **an onchain launchpad where coins are always paired with USDC, and the trading fees pay for the app's own compute over x402.**

- Every app is a Farcaster client.
- The creator chooses whether to launch a coin.
- If there is no coin, people can feed the app directly in USDC.
- If the USDC runs out, the server can't pay itself, and the app dies.

The owner's rulings, in their words where possible:

- "the launchpad *is* our submission for the hackathon." It is not a separate project.
- Self-hosted node, or reading and writing through Neynar or Hypersnap nodes: "possible, but hidden in the settings."
- **Trading fees go to the app's vault in USDC.** The owner (a person or a multisig) has agency over it: they can add to it, or buy other coins with it.
- Payments are made daily if possible, monthly if not.
- **Compute tiers unlock with daily active users.**
- Clanker supports USDC pairs on Base, so we use Clanker. Solana was the fallback.
- "All of this will be enforced onchain … the transparency is inherent and that is how we defend ourselves. All the code is open source."
- "every app should have a smart contract associated from which we could establish the daily users. So everything is onchain."

What was built and proven on a fork of Base mainnet, against the real Clanker and Uniswap v4 contracts:

- [`AppFactory`](smart-contracts/src/AppFactory.sol) gives birth to an app in one transaction: vault, coin and deposit. It **reverts unless 100% of the fees go to the vault, in USDC**.
- [`AppVault`](smart-contracts/src/AppVault.sol) handles harvest, `payCompute` (the keeper pays one period ahead at most), death and revival, owner withdrawals, and tiers.
- **Onchain daily users:**
  - people sign free daily check-ins, and the vault verifies them (plain and smart-contract wallets);
  - the keeper posts them in batches;
  - tiers unlock from yesterday's count;
  - an optional rule counts only coin holders.
- Results:
  - 5,000 USDC of trades produced 74.13 USDC of fees;
  - the server paid itself 15.55 USDC;
  - 25 people checked in onchain, and a forged check-in was rejected.
- Caveat, stated everywhere: **wallets are not people.**

## 3. Facing the bounty honestly (Oct 21)

Asked whether this fits Balaji's post, the answer was: **partly.**

- The launchpad is extra. Judges look at the three commands, the posting side, the tutorial and the vouch.
- The owner's response was to gear the whole repository toward winning, which is why [MASTER-PROMPT.md](MASTER-PROMPT.md) exists.
- Money: Clanker v4 allows several fee recipients, so the launchpad could take a fixed, public share. That share could go to PrizeSplit or to a grants treasury. **Not decided yet.**

More decisions that day:

- **An app is a fixed artifact.** A client, mini app, frame, post or video, pinned by hash at birth. "A new version becomes a new app. Simplicity. Finality. Straightforwardness." Not built yet.
- **Grants:** a public treasury that pays apps' vaults daily and pays for shared full nodes. Not built yet.
- **A debit card funded from the vault** could pay the treasury's cloud bills. It doesn't work as automatic per-app infrastructure: card issuers do identity checks and hold the money in between.
- The repository went **public**: [github.com/jpfraneto/fatline](https://github.com/jpfraneto/fatline). Shared with J Valeska, hackathon partner.

## 4. The node: from "2 TB" to about 600 GB (Oct 21)

- **The problem:** Snapchain asks for 2 TB of disk. The x402 sellers top out at 300 GB (VpsAgent) and 800 GB (VPSWolf).
- **Fork Snapchain to drop history?** Not needed:
  - Read nodes already have `pruning.block_retention`.
  - Messages are already capped by each account's storage rent.
  - The node now keeps **1 day** of blocks by default, the owner's choice. Validators keep every block, so a node that was offline longer still catches up.
- **Where the 2 TB comes from:** we read Snapchain's snapshot loader. It keeps every compressed piece, then a full tar, then the database, so about three copies at the peak. The snapshot is ~400 GB compressed and ~600 GB unpacked (measured ratio about 1.5×).
- **Our fix:** [`infra/node-setup.sh`](infra/node-setup.sh) streams download → unzip → unpack, so there is only one copy on disk. It also answers Snapchain's installer questions so it runs unattended.
- **Paying for it:** the owner can't afford a month, and "this money should be streamed".
  - [AgentMetal](https://agentmetal.dev/llms.txt) rents by the day in USDC over x402 and sells disk at $0.01/GB/day.
  - A 3-day plan was ~42.60 USDC, too much. The owner chose **one day: ~11.20 USDC**. That is 4 vCPU / 8 GB RAM (plus swap, since Snapchain wants 16) and 700 GB of disk.
  - The keeper now renews daily rentals one day at a time.
- **What happened when we paid:**
  - The owner funded a dedicated compute wallet, `0x754ab772Ee4E608A8c3E758AA6E91B6a82727F4E`, with 12 USDC.
  - The server rented fine: 4.20 USDC, `srv_ty63heep40jd`, paid until 2026-10-22 23:09 UTC.
  - AgentMetal's disk endpoint answered **HTTP 502** on every paid attempt. Nothing was charged for those attempts, because a payment only settles when the purchase succeeds.
  - Retries were stopped when the owner chose to try a minimal node instead.

### The "5 USDC node" experiment (Oct 21, late)

- **The owner's idea:** a minimal Snapchain, so anyone could run a node plus Fatline for ~5 USDC a day.
- **What we tried:** Snapchain's newer startup mode, `bootstrap_method = Replicate`, copies only the current state from other nodes, with no block history. We ran it on the server we had already paid for.
- **Result:** it doesn't work today.
  - The mode asks a peer's `ReplicationService`.
  - Every public Farcaster node we could reach answers *Unimplemented* (gRPC code 12): rho, crackle, snap, and four validator IPs.
  - We checked the call format against `HubService/GetInfo`, which answers.
  - So no public node serves replication right now.
- **The way it can work:**
  1. Once one Fatline node is fully synced, *it* serves replication. The Snapchain default is `replication.enable = true`.
  2. Every new node points `replication_peers` at it and starts from the current state only.
  3. That one shared node is exactly what the grants treasury is for.
  4. A second option: publish a pruned snapshot of our node.
- Either way, someone has to do one full ~600 GB sync first.

- **Retry, 2026-10-22 ~01:00 UTC:** the disk endpoint still answers HTTP 502 within 2 seconds. That is not a timeout; their server fails on the paid request. This happened with our two payment headers and with exactly the header their docs describe. Nothing was charged (the balance stayed at 7.80 USDC). The quote is a flat 7 USDC for 700 GB with "1d remaining", so it is not prorated by the hour.

## 5. Identity for the real test

- The owner chose **@anky (FID 18350)** for experiments. It has storage room: 4,630 of 10,000 casts used.
- Its seed phrase is only ever typed by the owner into a hidden local prompt: never in chat, logs, files or video.
- Nothing is posted without the owner's explicit yes.

## 6. Posting (Oct 21, night)

- **What was built:**
  - `fatline identity` registers a **gasless** app key, following Snapchain's current writing guide: an EIP-712 `KEY_ADD` signed by the custody address. It needs no ETH and confirms in seconds.
  - The key is scoped: it can't add or remove other keys.
  - The client signs casts, replies, likes, recasts, follows and deletes. Each one is read back from the same node before it's shown as confirmed.
- **Findings from the real network:**
  - crackle (Farcaster's public node) validated our message formats.
  - It also accepts submissions without a password: it refused a test only because the key wasn't registered. So the real @anky test doesn't have to wait for our own node.
- **Security:** posting is allowed only from the same machine, or with a write token when the client runs behind a server's proxy. Other websites in the same browser are blocked.

## 7. Cheaper node, then a pause (Oct 22, ~01:00–02:00 UTC)

- AgentMetal's disk failed again (HTTP 502 within 2 s, not charged). The owner asked for a cheaper provider "just to test things out".
- **Hetzner directly**, billed by the hour on the owner's account (card, not USDC): a cx43 with 16 GB RAM plus a 700 GB volume costs **~$2.50/day**, about a fifth of AgentMetal's ~11.20 USDC/day.
- The owner created an API token, stored only in `~/.hetzner-token` (mode 600).
- `infra/hetzner.mjs` creates, checks and deletes the whole node (`fatline compute hetzner …`).
- Quoted, **not created**: the owner paused to start a fresh session with new ideas.
- A friend independently explained the R2 snapshot, the same file we measured. The friend is a tester candidate.

## 8. Fatliner portraits from real histories (Oct 22–23)

- The owner approved a species blueprint (`fatliners/assets/FATLINERS_MASTER_REFERENCE.png`) and asked for a tool: any FID → its history from our nodes → visual traits → a `gpt-image-2` prompt that uses the blueprint → that FID's portrait. Then iterate until it feels like a collection.
- **No API key, but Codex:** the Codex CLI on this machine is logged in with the owner's ChatGPT account, and its built-in image tool takes the blueprint as an attached image. About 2 minutes per portrait.
- **Four rounds:**
  1. The owner's prompt as written: on-species, but generic glossy 3D with orange haze and neon veins.
  2. One painted style, fixed framing, a flat background colour each: it became a set.
  3. 16 real accounts showed the traits collapse: every power user got the same orbit, eyes and pulse, because the DNA's thresholds were set on synthetic histories. The traits are now **calibrated** on the quantiles of 33 real active accounts. Also one fixed light.
  4. The mouth became a seam (it was drifting to human lips), the eyes darker, the expressions readable at avatar size.
- **Found on the way:** every account we read holds the identical message set on Snapchain and Hypersnap, so all are drawn with braided blue and pink. During the run the Hypersnap volume was detached and the node moved onto the master (another session, commit 542930c); the pipeline labelled those reads "Snapchain read only" instead of guessing.
- A moving "now" changed every being on each run: the default cutoff is now the collection snapshot, 2026-10-22 00:00 UTC.

## 9. The world, and a friend's first PR (Oct 23)

- The owner asked for the README, docs and site to catch up with everything, and for images that make the Fatliners feel like a world where each being's life feeds the network.
- **The world:** nine scenes in the figurine look (the Weaving, You Are Your FID, Two Currents, the Vault, the Sleeper, the Archive, the Hall of 777, A Node Is Born, a map) and Aster, the being of $FATLINE. Each scene stands for a real part of Fatline. Made through the Bankr LLM gateway with `gpt-image-2.5-sunburst`. The gateway has no image-edit route, so the style reference couldn't be attached; the look is described in words, and it held.
- **The first outside contribution:** a friend (jvaleskadevs) sent PR #1: `follow --followers --depth` and `fatline feed`. Reviewed, three bugs fixed (an empty page when replies were hidden, the wrong label for the network, an older username winning), merged.

## 10. A friend runs it for real (Oct 24)

- A friend rented a server and installed Snapchain by hand, from the docs. Both shards downloaded in about an hour and a half; then it started catching up (shard 1 ten hours behind, shard 2 two days).
- Every place he got stuck was wording or a timeout, not the node: "indexer" sounded like another program, the client didn't say its address, `connect` gave up after 15 seconds on a lookup that takes 20-30, and the Farcaster app said its sign-in was unavailable. He also asked the right question: is an app key a new account? (No: a second key for yours.)
- Fixed the same day: a fast ownership check, plain messages, the client opens itself, and the Cast button gained the link and a browser-wallet way in.

## 11. Bring your node, without being scared (Oct 25)

- The question: would someone who already runs a node trust `curl | sudo bash` on their node's server? Read as they would read it, no. It ran as root, piped a second script straight from main, followed main forever, installed Node through another `curl | bash`, downloaded an unverified Caddy binary, and asked a seller's API about every server.
- One finding was a real bug: anyone with a Farcaster app key could lay an egg naming a private address, and the hatchery would fetch it. Now egg URLs reach only public addresses.
- What changed: one pinned commit, pinned hashes, services that can't do anything but their job, an update that asks, an undo, and a container for people who won't run a script at all. Nothing that already ran had to move: the lockdown is a separate file next to each service.

## Start from scratch

1. Read the bounty post, then [MASTER-PROMPT.md](MASTER-PROMPT.md), then this file.
2. `git clone https://github.com/jpfraneto/fatline && cd fatline && fatline doctor`
3. Try the launchpad with fake money: `fatline contracts fork`, then `fatline up` (see the README).
4. Node:
   - `fatline compute wallet` creates a wallet; fund it with USDC on Base.
   - `fatline compute --provider agentmetal --days 1 --disk 700 --node` rents the server and sets up the node.
   - `fatline compute status` shows progress.
5. Continue with the first unfinished workstream in the master prompt.

## Rules that never change

- Secrets never go in chat, logs or the repository.
- Real money and real posts need the owner's yes, each time.
- Never invent results, testers or vouches.
- Both networks are treated as equals.
- Keep the README's "tested / not tested" section true.
