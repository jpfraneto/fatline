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

## Where we are (2026-10-21)

Built and tested:
- the machine check (`./infinicaster doctor`);
- the read client for Farcaster and Hypersnap;
- x402 server rental;
- the launchpad contracts, indexer and UI;
- onchain daily users per app.

Details are in the README's "tested / not tested" section.

Not built or not proven, in bounty order:
- **J2, in progress (2026-10-21):** AgentMetal rents by the day for USDC (x402) and sells disk volumes up to 1 TB at $0.01/GB/day. `compute --provider agentmetal --days 1 --disk 700 --node` costs ~11.20 USDC for one day (the owner chose the cheapest run), paid from a dedicated compute wallet (`compute wallet`). `infra/node-setup.sh` streams the snapshot (~600 GB unpacked) and adds swap, because their biggest plan has 8 GB of RAM and Snapchain asks for 16. Waiting on the owner to fund the wallet.
- **Earlier finding:** no x402 seller found sells a server big enough for a node with its built-in disk. Checked 2026-10-21: VpsAgent goes up to 300 GB, VPSWolf up to 800 GB, and Snapchain asks for 2 TB.
  - For the bounty: script a regular cloud provider that offers attachable volumes or big disks (paid by card, the person's own account).
  - Ask the x402 sellers for a bigger plan (VpsAgent has a free `POST /feedback`).
  - Long term: grant-funded shared nodes (W6c).
  - Idea: a crypto debit card funded from a vault or the treasury pays the cloud bill. This could work for the treasury paying shared nodes, but not as automatic per-app infrastructure. Reasons:
    - The card is issued to a person after identity checks.
    - The card issuer holds the money while it sits on the card.
    - Some cloud providers refuse prepaid cards.
  - **Smaller node, no fork (checked 2026-10-21):**
    - Snapchain already has `pruning.block_retention` for read nodes. It's off by default and deletes old blocks daily.
    - Messages themselves are already capped by each account's storage rent.
    - Today's starting snapshot is about 400 GB compressed (5,695 chunks of about 70 MB across shards 0–2).
    - To do: sync once with `block_retention` set to 7 days and measure the real disk use. That is the number the tutorial gives, not "2 TB" by default.
    - Forking Snapchain to drop history was rejected: weeks of Rust, and judges asked for a Snapchain read node.
    - A database with only the relevant casts is what the light path (indexer + public node) already is. It's fine for apps, but it doesn't count as the bounty's node.
  - **For the bounty, a node is required but who pays for it is not.** The tester must run the commands themselves. A machine we pay for is fine; it would be the first grant.
- **J3:** a node has never been synced on a fresh machine by us.
- **J5–J8:** the whole write path is missing: seed phrase, app key, cast, follow, like, client filter. `indexer/src/hub.mjs` only reads.
- **J9:** no microsite. The README is not a tutorial.
- **J11:** no tester yet. This is the critical path, and it needs days, because syncing a node takes hours.

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
