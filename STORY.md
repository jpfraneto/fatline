# The story so far

This file records how Infinicaster got here, what was decided and why. With it, someone (a person or an agent) can start from an empty folder and arrive at the same place. [MASTER-PROMPT.md](MASTER-PROMPT.md) is the plan going forward. This file is the memory behind it.

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
- The repository went **public**: [github.com/jpfraneto/infinicaster](https://github.com/jpfraneto/infinicaster). Shared with J Valeska, hackathon partner.

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
  - A background retry runs every 10 minutes. **Status at time of writing: waiting on the disk.**

## 5. Identity for the real test

- The owner chose **@anky (FID 18350)** for experiments. It has storage room: 4,630 of 10,000 casts used.
- Its seed phrase is only ever typed by the owner into a hidden local prompt: never in chat, logs, files or video.
- Nothing is posted without the owner's explicit yes.

## Start from scratch

1. Read the bounty post, then [MASTER-PROMPT.md](MASTER-PROMPT.md), then this file.
2. `git clone https://github.com/jpfraneto/infinicaster && cd infinicaster && ./infinicaster doctor`
3. Try the launchpad with fake money: `./infinicaster contracts fork`, then `./infinicaster up` (see the README).
4. Node:
   - `./infinicaster compute wallet` creates a wallet; fund it with USDC on Base.
   - `./infinicaster compute --provider agentmetal --days 1 --disk 700 --node` rents the server and sets up the node.
   - `./infinicaster compute status` shows progress.
5. Continue with the first unfinished workstream in the master prompt.

## Rules that never change

- Secrets never go in chat, logs or the repository.
- Real money and real posts need the owner's yes, each time.
- Never invent results, testers or vouches.
- Both networks are treated as equals.
- Keep the README's "tested / not tested" section true.
