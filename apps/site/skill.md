---
name: fatline-setup
description: Help a person mint one of the 777 Fatliners (when the mint is open) and set up Fatline — their own Farcaster (Snapchain) or Hypersnap read node and their own client — step by step from a fresh machine, using the open-source fatline commands. Use when someone says "help me mint one of the 777 Fatlines", "help me set up a Fatline", shares fatline.ink/skill.md, or asks to run their own Farcaster node or client.
---

# Set up a Fatline (instructions for an AI agent)

You are helping a person get **their own Farcaster read node and their own client**, with Fatline (open source, MIT: https://github.com/jpfraneto/fatline). The person stays in charge. You run commands, read output, explain in plain words, and stop for their yes where this file says so.

Source of truth for every command: the repository's `README.md` and `fatline help`. If this file and the code disagree, the code wins; tell the person.

## If they asked to mint one of the 777

Tell them the truth first, in a few lines: **the mint is not open yet** (as of 2026-10-23). The 777 are chosen by an open, deterministic ranking of the whole network that will be published and agreed on before the mint; there is no mint contract yet. Never make up a mint page, a contract address or whether they are among the 777. Then:

1. Show them what is coming: open https://fatline.ink/manifesto.html in their browser.
2. Offer what they can do today: run their own node and client (the steps below). It is the body a Fatline will live on, and it is free to try with the light path.
3. If this file is newer than that date and names a mint link or contract, follow it instead; this section will change when the mint opens.

**Show, don't paste.** You may open pages in the person's browser instead of printing long links: `open <url>` on macOS, `xdg-open <url>` on Linux, `start <url>` on Windows. Pick by the machine you are on (`uname`). Open only fatline.ink, github.com/jpfraneto/fatline, console.hetzner.cloud and nodejs.org pages, and say what you opened. If you are not on their computer (a chat on their phone), give the link instead.

## Rules (never break these)

1. **Money needs the person's explicit yes, every time.** Renting a server costs real money by the hour. Show the price first (`fatline compute --quote`), ask, and only then rent.
2. **Never ask for, read, or handle a seed phrase or private key.** Posting as themselves (`fatline identity`) is something the person runs **in their own terminal**; it asks for the seed phrase in a hidden prompt and never saves it. Don't run it for them, don't pipe anything into it.
3. **API tokens never go through the chat.** The person saves their Hetzner token to a file themselves (see step 3). You may check that the file exists; never `cat` it or print it.
4. **Say which node is in use.** Fatline treats Farcaster (Snapchain) and Hypersnap as equals. Never switch a person to another node silently.
5. **Don't invent results.** If something wasn't run or didn't work, say so, with the error.
6. **Leave a way out.** Whenever a server is rented, tell the person how to stop paying: `fatline compute hetzner down` (deletes the server and its disk).

## Before you start: ask two things

- **Which path?**
  - **rent** (recommended): a Hetzner server runs their node, their client runs on their own computer. Needs a Hetzner Cloud account with a card. About $3–5 per day while it runs, billed by the hour. 1–3 hours to download, then up to ~6 hours to catch up.
  - **local**: the node runs on this machine with Docker. Needs ~1 TB free disk, 16 GB RAM, 4+ CPUs.
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

### 3. (rent) Their Hetzner token
They make one at console.hetzner.cloud → their project → Security → API tokens → Generate (Read & Write). Then **they** save it, without pasting it to you. Give them this line to run in their own terminal (macOS, after copying the token):
```sh
pbpaste > ~/.hetzner-token && chmod 600 ~/.hetzner-token
```
On Linux: `read -rs T && printf '%s\n' "$T" > ~/.hetzner-token && chmod 600 ~/.hetzner-token && unset T`. You check with `test -s ~/.hetzner-token && echo ok`.

### 4. (rent) The price, then their yes, then rent
```sh
fatline compute --quote        # free: shows server type, CPU/RAM/disk and the price per hour and per day
```
Show them the price. **Ask: "Rent it? It costs about $X/day until you run fatline compute hetzner down."** Only after a clear yes:
```sh
fatline compute --yes
```
It picks the cheapest type in stock with 16 GB RAM and adds a 700 GB disk. If a type is sold out, the error lists what is in stock; use `--type <name>` (and `--location fsn1|hel1|nbg1`). New Hetzner accounts have limits (vCPUs, total volume size): if creating the volume is refused, the person has to ask Hetzner for a higher limit in the console (Limits).

### 5. Install the node
- rent: `fatline node farcaster` (or `hypersnap`). It copies the setup to the server and streams the ~400 GB snapshot. It prints progress and waits until the node answers (1–3 hours). If your shell has a time limit, run it in the background and check later; re-running the same command just follows the setup again.
- local: `fatline node farcaster --local`. It downloads the official bootstrap script and asks before running it: show the person the path and the sha256 it prints, and get their yes. It needs Docker running.

Don't put both networks on one rented server unless it has the disk for both (the command refuses by default).

### 6. Wait for sync
Healthy means every shard is a few blocks behind or less. For a rented node the address is in `.fatline/hetzner.json` (`ipv4`); Snapchain answers on port 3381, Hypersnap on 4381:
```sh
curl -s http://<ipv4>:3381/v1/info    # shardInfos[].blockDelay: small numbers = in sync
fatline status                       # for a node on this machine, and the client
```
Catching up can take ~6 hours. Check every 30–60 minutes, not constantly.

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
