---
name: fatline-setup
description: Help a person hatch one of the 777 Fatliners (their node keeps an egg warm for three days) and set up Fatline — their own Farcaster (Snapchain) or Hypersnap read node and their own client — step by step from a fresh machine, using the open-source fatline commands. Use when someone says "help me mint one of the 777 Fatlines", "help me hatch a Fatliner", "help me set up a Fatline", shares fatline.ink/skill.md, or asks to run their own Farcaster node or client.
---

# Set up a Fatline (instructions for an AI agent)

You are helping a person get **their own Farcaster read node and their own client**, with Fatline (open source, MIT: https://github.com/jpfraneto/fatline). The person stays in charge. You run commands, read output, explain in plain words, and stop for their yes where this file says so.

Source of truth for every command: the repository's `README.md` and `fatline help`. If this file and the code disagree, the code wins; tell the person.

## If they asked for one of the 777

Tell them how it works, in a few lines: **a Fatliner hatches from an egg that their own node keeps warm** (live on Base since 2026-10-24). Any account can take an egg; only 777 hatch, the first 777 to keep a node alive. Nobody keeps a list. Free. The steps:

1. Their own node, on a server reachable from the internet (the setup below: cloud, hetzner or vps; not light, not local behind a home router). **Don't wait for sync**: as soon as the node answers, do steps 2–4. Warmth counts from the hour the node starts catching up.
2. `fatline hatchery install`: a small service next to their node, with a key of its own (no money, no question).
3. `fatline identity`: **they run it in their own terminal** (it asks for their seed phrase, hidden; rule 2).
4. `fatline egg lay`: signs the egg with the app key from step 3 (no seed phrase, nothing to approve). Once the servers have read their history, the egg goes onchain by itself (a server pays the gas): a token with their FID as its id, held by their custody address unless they say otherwise (`--to 0x…`: ask them). Eggs can't be sold or moved.
5. Keep the node alive. Show them `fatline egg` from time to time: every hour the servers that already hatched check theirs (in sync, or catching up: closer to the tip than a few seconds before); a day is warm at 18 of 24 checks; three warm days and it hatches, so the server needs at least three paid days (`fatline compute renew --days 2` after the first). A cold day doesn't reset anything.
6. `fatline hatch`: the egg becomes their Fatliner, free, with a surname read from its DNA. Their server becomes an attester.
7. Their egg's coin, as soon as the egg is onchain (it doesn't wait for hatching): `fatline coin launch --fid <their FID> --go`. The ticker is the egg's surname, read from its DNA; paired with USDC on Clanker; 100% of trading fees go to the egg's vault, which pays their server and sends everything above one month of rent to them (`distribute`, anyone can call it). **They approve it in their own wallet**: a QR code (WalletConnect) for the wallet that holds the egg (their custody address), or `--pay browser`. Never a seed phrase or a key file. It needs a little ETH on Base for gas. One coin per egg; $FATLINE (Aster) launches first.

Their node must keep running for those days, which costs money (rule 1): about 11 USDC a day rented in USDC, about $2.60 a day on their own Hetzner account. Say so before they rent.

The contract (the only one): Fatliners `0x26399Aa7D96f7678Bb825b822777683Ecb4169B8` on Base. It is also the launchpad: at most 777 coins, one per egg or Fatliner. Never send them to any other address, and never make up whether they will get one.

**Show, don't paste.** You may open pages in the person's browser instead of printing long links: `open <url>` on macOS, `xdg-open <url>` on Linux, `start <url>` on Windows. Pick by the machine you are on (`uname`). Open only fatline.ink, github.com/jpfraneto/fatline, basescan.org, console.hetzner.cloud and nodejs.org pages, and say what you opened. If you are not on their computer (a chat on their phone), give the link instead.

## Rules (never break these)

1. **Money needs the person's explicit yes, every time.** Renting a server costs real money (USDC, prepaid by the day). Show the price first (`fatline compute --quote`), ask, and only then rent.
2. **Never ask for, read, or handle a seed phrase or private key.** Posting as themselves (`fatline identity`) is something the person runs **in their own terminal**; it asks for the seed phrase in a hidden prompt and never saves it. Don't run it for them, don't pipe anything into it.
3. **Keys and tokens never go through the chat.** The paying wallet's key stays in `.fatline` (mode 600); never `cat` it or print it. If the person uses the Hetzner option, they save that token to a file themselves; you may check that the file exists, never print it.
4. **Say which node is in use.** Fatline treats Farcaster (Snapchain) and Hypersnap as equals. Never switch a person to another node silently.
5. **Don't invent results.** If something wasn't run or didn't work, say so, with the error.
6. **Leave a way out.** Whenever a server is rented, tell the person how it stops: a USDC server ends by itself when its paid days end (`fatline compute status` shows when). A Hetzner one bills by the hour until `fatline compute hetzner down`.

## Before you start: ask two things

- **Where will the node live?** A node needs ~650 GB of disk, 8–16 GB of RAM, always on. Their client runs on their own computer either way.
  - **cloud** (default): rented by the day, paid in USDC on Base (x402) from **their own wallet**. They approve each payment in it: by scanning a QR code with their phone wallet, or in a browser wallet extension. No account, no card, no ETH, no key typed anywhere. ~11.2 USDC a day (AgentMetal: 4 CPUs, 8 GB RAM + 700 GB disk).
  - **hetzner**: their own Hetzner Cloud account (API token and card, billed by the hour). Cheapest: ~$2.60/day per node.
  - **vps**: a server they already have, at any provider (root SSH). `fatline compute vps root@<ip>` checks it can hold a node.
  - **local**: this machine with Docker. Needs ~700 GB free disk, 8–16 GB RAM, 4+ CPUs (`fatline doctor` says if it fits).
  - **light**: no node at all. Copies only chosen accounts from a public node. Free, minutes. It is **not a node**: it trusts the node it reads from.
- **Which network?** `farcaster` (Snapchain) or `hypersnap`. If they don't mind, `farcaster`.

## The steps

Run everything from the Fatline folder. Many agent shells can't answer interactive prompts, so use the plain commands below rather than the guided `fatline setup` (that one is for people at a terminal; `fatline setup --plan` is safe for you and shows the same steps).

### 1. Get Fatline
Needs `git` and Node.js 22.12+ (`node -v`). If Node is missing or old, tell the person to install it from https://nodejs.org (or `brew install node`); don't install system software without asking.
```sh
FATLINE_NO_SETUP=1 sh -c "$(curl -fsSL https://fatline.ink/install.sh)"   # clones into ~/fatline, nothing else
cd ~/fatline
```
The installer also puts the `fatline` command on the PATH (`npm install -g`, linked to ~/fatline). If `fatline` is not found, run `npm install -g .` in ~/fatline, or use `./fatline` from inside it.

### 2. Check the machine
```sh
fatline doctor
```
Read the result to the person in two lines: what it recommends, and anything missing.

### 2b. You are your FID
```sh
fatline connect
```
In a terminal it draws a QR code; the person scans it with their phone and signs in with the Farcaster app. From an agent shell (no terminal) it opens the sign-in page in their browser instead, which shows the same request; tell them to approve it on their phone. It waits up to 5 minutes. Fatline checks the signature on this machine and asks the node which FID the signing address owns; only then is it saved (`.fatline/identity.json`, public data, no keys). No seed phrase is involved. Report the FID and username it prints. If they'd rather not, skip it.

### 2c. No FID? A worker
A worker is a node keeper with no Farcaster account: `fatline worker new` makes a wallet on this machine and shows its recovery phrase once. **The person runs it in their own terminal, never you**: it refuses without a terminal, and a phrase must never pass through the chat. After that, `fatline worker` (safe for you) shows the address to fund with USDC on Base, and `fatline compute` pays from it (x402, no ETH). Its coin is not available yet; say so.

### 3. (cloud) Their wallet
They need ~12 USDC **on Base** in a wallet they already use (MetaMask, Rainbow, Rabby, Coinbase Wallet, Trust…). No ETH needed: payments are signatures. **Never ask for a key or a phrase, and never suggest pasting one.** They approve in their own wallet:
- `--pay browser`: opens a page on localhost in their browser; they connect a wallet extension and approve there. Works from your shell.
- `--pay phone`: draws a WalletConnect QR code in the terminal; they scan it with their wallet app. Works out of the box: Fatline's WalletConnect project ID is built in, so there is nothing to set up or ask for. Best when they run the command in their own terminal, where they can see the code.
- `--pay here`: a wallet made on this machine (`fatline compute wallet`, or a worker's), funded by them. It signs by itself.

### 4. (cloud) The price, then their yes, then rent
```sh
fatline compute --quote        # free: server, disk, and the price for one day; nothing is signed
```
Show them the price. **Ask: "Rent it? About X USDC for one day, prepaid, no refunds. It stops by itself when the day ends."** Only after a clear yes:
```sh
fatline compute --yes --pay browser     # or --pay phone / --pay here
```
Tell them to approve two payments in their wallet (server, then disk). It rents AgentMetal's medium server (4 vCPU, 8 GB RAM) for one day and adds a 700 GB disk: two signatures, server then disk. If the disk payment fails, retry only the disk: `fatline compute disk --disk 700`. More days now: `--days N` (1–30); later: `fatline compute renew --days N` (they approve again).

**(hetzner)** `fatline compute hetzner --quote --no-node`, then `fatline compute hetzner --yes --no-node`. It needs their own API token in `~/.hetzner-token` (console.hetzner.cloud → project → Security → API tokens, Read & Write), saved by them: `pbpaste > ~/.hetzner-token && chmod 600 ~/.hetzner-token`. It bills by the hour until `fatline compute hetzner down`.

**(vps)** `fatline compute vps root@<ip>`. If the server doesn't know Fatline's SSH key yet, ssh asks for the server's password **in its own prompt**: the person runs that one in their own terminal.

### 5. Install the node
- cloud, hetzner, vps: `fatline node snapchain` (or `hypersnap`). It copies the setup to the server and streams the ~400 GB snapshot. It prints progress and waits until the node answers (our last run: about 1.5 hours). If your shell has a time limit, run it in the background and check later; re-running the same command just follows the setup again.
- local: `fatline node snapchain --local`. It downloads the official bootstrap script and asks before running it: show the person the path and the sha256 it prints, and get their yes. It needs Docker running.

Don't put both networks on one rented server unless it has the disk for both (the command refuses by default).

### 6. Wait for sync
Healthy means every shard is a few blocks behind or less. For a rented node the address is in `.fatline/compute.json` (`ipv4`; `.fatline/hetzner.json` for Hetzner); Snapchain answers on port 3381, Hypersnap on 4381:
```sh
curl -s http://<ipv4>:3381/v1/info    # shardInfos[].blockDelay: small numbers = in sync
fatline status                       # for a node on this machine, and the client
```
Catching up took about 2 hours on our last run (3.5 hours from paying to in sync). The client works and the egg warms meanwhile. Check every 30 minutes, not constantly.

### 7. (light) Instead of 5–6
```sh
fatline init --network farcaster
fatline follow <fid|@name> [more…] --following --network farcaster --node crackle --once   # Hypersnap: --network hypersnap --node haatz
fatline feed --limit 20
```
Always pass `--node`: on a fresh copy the first node listed is "your own node on this machine", which doesn't exist in the light path. crackle (Farcaster) and haatz (Hypersnap) are public nodes run by each network. Say clearly that this is not a node.

### 8. Start the client
```sh
fatline init --network farcaster    # skip if already done
fatline up                           # serves http://localhost:8787; it keeps running
```
Tell them to open http://localhost:8787. The source line in the app says which node it reads from.

### 9. Optional, by the person: post as themselves
Tell them to run, **in their own terminal**: `fatline identity --fid <their FID> --dry-run`, then without `--dry-run`. It registers an app key without gas, limited to casts, reactions, follows and profile. Their seed phrase goes into a hidden prompt and is never saved.

## When you finish, tell the person
- What runs where (server IP and network, or "light, reading from <node>").
- What it costs per day, and the exact command to stop paying.
- How to come back: `cd ~/fatline && fatline up`.

## If something breaks
- Read the error out loud in plain words; most errors in Fatline say what to do next.
- Snapshot downloads can stall; the setup retries slow pieces on its own. Re-run the node command to follow it.
- Still stuck: open an issue at https://github.com/jpfraneto/fatline/issues with the command, the last 30 lines of output, the OS, and the path (rent/local/light). Never include tokens or keys.

More: https://fatline.ink/docs/ (the docs) and https://fatline.ink/docs/tutorial.html (tutorial: English, Spanish, Chinese) · https://github.com/jpfraneto/fatline (README: what is tested and what is not).
