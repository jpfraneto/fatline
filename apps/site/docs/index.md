# Fatline

**Fatline is a Farcaster client and a USDC launchpad.** The client reads Farcaster from **Snapchain or Hypersnap**, your choice, through a node you can see. The launchpad, on Base, gives every coin a USDC pair, and its trading fees pay for a server that keeps a full copy of the network. More copies, kept by more people, paid for by their own coins.

## The client: two networks, one switch

Farcaster's messages travel on two networks:

- **Snapchain**, run by Farcaster.
- **Hypersnap**, a community fork that keeps full history.

Fatline treats them as equals. In your client, **Settings → Network** picks which one you read, and, for each network, either *automatic* or exactly one node. The client always shows the node it is reading from, and never switches without telling you. The choice is kept in your browser. If one network or node fails you, switch and keep going. Run your own node and it becomes one of the choices.

The home page shows both networks live: [fatline.ink](https://fatline.ink/).

## The launchpad: fees pay for copies

1. **A coin** launches on Clanker, **paired with USDC**. One per egg or Fatliner, at most 777 ever. Its ticker is the Fatliner's surname, read from its history; nobody picks it.
2. **Its fees.** 100% of the coin's creator fees go to its own vault, in USDC. The contract checks this at launch and refuses anything else.
3. **The rent.** Anyone can call `payCompute()`: the vault pays the server's keeper, at most the agreed rate for the period.
4. **The copy.** That server runs a full Snapchain or Hypersnap node. If the vault runs dry, or the holder withdraws (they can take all of it), the node goes dark and its page says so. Anyone can refill the vault.

| On Base (chain id 8453) | Address |
|---|---|
| Fatliners, which is also the launchpad | [`0xb54CD4A4E56D2549557b1284AB0BEA2D076a3016`](https://basescan.org/address/0xb54CD4A4E56D2549557b1284AB0BEA2D076a3016) |
| USDC (Circle) | [`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`](https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) |
| Clanker | [`0xE85A59c628F7d27878ACeB4bf3b35733630083a9`](https://basescan.org/address/0xE85A59c628F7d27878ACeB4bf3b35733630083a9) |

The source of truth is [`deployments/base.json`](https://github.com/jpfraneto/fatline/blob/main/smart-contracts/deployments/base.json). Before you sign anything, check that the address and the chain match it. Fatline will never ask you to send money to any other contract.

## Run your own copy

### Ask your agent

Open Claude Code, Codex, or any agent that can run commands on your computer, and paste:

```text
Help me run a Fatline: https://fatline.ink/skill.md
```

The agent reads [the skill](../skill.md) and asks before every step:

1. **Where your node lives.** A server rented by the day in USDC on Base (about 11 USDC a day, no card, no account), your own Hetzner account (about $2.60 a day), a server you already have, or this computer. It shows the price first.
2. **Paying.** You approve each payment in your own wallet: a QR code for your phone, or a browser wallet. The agent never sees a key or a seed phrase.
3. **Your network.** Snapchain or Hypersnap. The node downloads a copy of the network and catches up in a few hours.
4. **Your client** opens at `localhost:8787`. Press **Cast** to post: the first time, it gives the client its own key for your account (not a new account), approved in the Farcaster app (Sign in with Farcaster, the only way in on any Fatline client). You can cast before your node is in sync; until then casts go out through Fatline's master node, and the client says so. [How it works](tutorial.html#post).

### By hand

```sh
curl -fsSL https://fatline.ink/install.sh | sh
```

Or step by step: `git clone https://github.com/jpfraneto/fatline`, `cd fatline && npm install -g .`, then:

```sh
fatline compute          # rent a server that can hold a node (shows the price, pays nothing until you say so)
fatline node snapchain   # a full node on it (or: fatline node hypersnap)
fatline client           # your client at localhost:8787, reading from your node
```

[The tutorial](tutorial.html) explains each step ([Español](tutorial.html?lang=es) · [中文](zh.html)). No room for a node: `fatline setup` and choose *light* (it copies only the accounts you choose, and trusts the node it copies from). To get the newest version of everything: `fatline update`.

<a id="bring-your-node"></a>

## Already run a node? Bring it in

Snapchain or Hypersnap, on any server you run: it joins as it is. Two ways, both free:

- **Put it on the map** (no install): your node gets a public page, is measured every hour, and shows up for people and developers. One file on your server and one cast. [Bring your node](https://fatline.ink/join), or read [the registry](#the-registry) below.
- **Keep an egg warm** (installs the hatchery): everything above, plus an egg that hatches into a Fatliner after three warm days, and a coin whose fees can pay your node's rent. The steps follow.

### Keep an egg warm

![Bring your own node: one line on its server, and your node keeps an egg warm](../img/join/join.gif)

**1. On your node's server.** Look first; this changes nothing:

```sh
curl -fsSL https://fatline.ink/join.sh | bash -s -- --check
```

It finds your node, shows its version and sync, and lists everything joining would change. Then join (Debian or Ubuntu, as root):

```sh
curl -fsSL https://fatline.ink/join.sh | sudo bash
```

It asks before it installs the hatchery next to your node (port 8791): the small service that keeps eggs warm. Servers in the network check each other's nodes every hour, and once your egg hatches, yours checks theirs. Ports 3381 (Snapchain) or 4381 (Hypersnap) and 8791 must be open to the internet. [Read the script first](https://github.com/jpfraneto/fatline/blob/main/apps/site/join.sh).

What it does to your server, and what it doesn't:

- **Your node isn't touched**: not its files, keys or config. The hatchery only asks it questions over HTTP.
- **One exact version.** The script on fatline.ink names the commit it installs, and installs only that one. Node.js comes from a pinned release, checked against a hash.
- **Locked down.** The hatchery runs with no root powers and can write only `/root/.fatline`; the rest of the disk is read-only to it (`systemd-analyze security fatline-hatchery`). It reaches only public addresses on the internet, never your private network.
- **A new key**, made on your server for its hatchery. It isn't your Farcaster key and holds no money.
- **Updates only when you say so**: `fatline update` shows what's new and asks first.
- **Undo it all**: `curl -fsSL https://fatline.ink/join.sh | sudo bash -s -- --remove`

**No script at all?** Run the hatchery as a container instead: non-root, read-only, no capabilities, one folder, one port. Get [hatchery.compose.yml](https://github.com/jpfraneto/fatline/blob/main/infra/hatchery.compose.yml), then:

```sh
gh attestation verify oci://ghcr.io/jpfraneto/fatline-hatchery:<commit> --owner jpfraneto   # built here, from this repository
mkdir -p data && sudo chown 1000:1000 data
FATLINE_VERSION=<commit> docker compose -f hatchery.compose.yml up -d
```

The container keeps eggs warm; your client at `<surname>.fatline.ink` comes with the script, not the container.

**2. On your own computer**, lay your egg on that node (put your server's address in):

```sh
curl -fsSL https://fatline.ink/install.sh | sh
fatline identity
fatline egg --node http://<your server>:3381
```

`fatline identity` gives Fatline a key for your account (a QR code for the Farcaster app; no app? use the Cast button's wallet sign-in in `fatline client`). `fatline egg` shows the rules, then a QR code: you approve with the wallet tied to your Farcaster account, and the egg is yours. Three warm days and it hatches. Watch it on [the hatchery](https://fatline.ink/).

Or hand both steps to your agent: `I already run a Farcaster node. Bring it into Fatline: https://fatline.ink/skill.md` and tell it your node's address.

## The registry

Every node and client that joined Fatline, who runs each, and whether each node is in sync right now: [fatline.ink/nodes](https://fatline.ink/nodes). A node doesn't need a Fatliner, a coin or Fatline's software to be listed. A client doesn't need a node of its own.

**The records live on Farcaster.** A node joins with one cast whose parent is `https://fatline.ink/nodes`:

```
fatline node
node: https://hub.example.com:3381
client: https://example.com
name: Example
```

`client:` (a client that reads this node, up to 4) and `name:` are optional; so are `usdc:` (an address on Base where people can send support) and `cost:` (what the server costs a month, in USD, in the operator's own words). A record with only `client:` lines lists a client; `reads: <node>` says which node it reads. Every node holds these casts, so anyone can read the list without Fatline: `GET <any node>/v1/castsByParent?url=https://fatline.ink/nodes`. Delete the cast and the node leaves. [Bring your node](https://fatline.ink/join) checks the address, shows the proof to put in place, and publishes the cast from your account.

**Proof.** A record is listed only when the address agrees, so nobody can list someone else's node:

| Proof | What it is |
|---|---|
| `well-known` | `http(s)://<host>/.well-known/fatline` (port 80 or 443) holds `fid: <your FID>`. For a client, at its own address. |
| `dns` | A TXT record at `_fatline.<host>` holds `fid=<your FID>`. |
| `egg` | A Fatline place: its keeper's signed egg names the node, and the hatcheries check it hourly. Other nodes and clients on the same machine, cast by the same keeper, are covered. |

A proof found counts for 30 days after it was last seen, and is looked for again weekly. The first account to prove a node keeps it; a later claim is not listed.

**Health, measured.** Once an hour the server reads each node's `/v1/info`, compares every shard with its own reference nodes for the same network, and asks it for two casts by hash that any node in sync must hold. Never the node's own word (its `blockDelay` is not used).

| `health.state` | Means |
|---|---|
| `synced` | Answers, every shard within 600 blocks (~10 min) of the reference, and returned the casts. |
| `behind` | Answers like a node, but at least one shard is further back. |
| `invalid` | Answers, but not like a Farcaster node: no shards, a shard missing, or a cast missing. |
| `unreachable` | No answer: refused, timed out, an HTTP error, or not a public address. |
| `unknown` | Not measured yet, or no reference node answered, so nothing could be judged. |
| `stale` | The last measurement is more than 2.5 hours old. It is shown with its time, never as now. |

The network is measured too: Hypersnap answers its `/v2/farcaster/user/bulk` API, Snapchain does not. Snapchain and Hypersnap are never mixed.

**For developers.** Read-only JSON, any origin:

```sh
curl 'https://fatline.ink/api/registry'                                  # every listed node and client
curl 'https://fatline.ink/api/registry?network=snapchain&healthy=true'  # only Snapchain nodes in sync now
curl 'https://fatline.ink/api/registry/<id>'                            # one node, with its last 48 measurements
```

Each node has `id`, `url`, `network`, `operator` (`fid`, `username`, `pfp`), `proof`, `clients`, `fatliner`, `funding` and `health` (`state`, `checkedAt`, `lastSyncedAt`, `behindBlocks`, `latencyMs`, `version`, `dataCheck`, `measuredBy`). Then call the node directly: Fatline never sits between your app and the node, and has no gateway. Every Fatline server runs the same registry at `/api/registry` and measures from where it stands, so you can ask more than one. These are hourly measurements from one place, not an uptime promise.

## Hatch a Fatliner

Coins belong only to Fatliners, and a Fatliner is earned by keeping a node alive.

- **Lay an egg.** Any Farcaster account, once, free (a server pays the gas): `fatline egg`. You approve with the wallet tied to your account, and the egg is yours onchain: token #your-FID. It can't be moved. Its stone (ivory, marble, sandstone, basalt, moss, gold or opal) comes from your account's history.
- **Three warm days.** Every hour, the servers that already hatched check yours: it answers, it is in sync, it returns messages they pick at random from their own nodes. A day is warm at 18 of its 24 checks. A cold day resets nothing; it just doesn't count.
- **Hatch.** `fatline hatch`: the egg becomes a Fatliner, with a **surname** read from its history, the ticker of its coin. Your server becomes one of the checkers.
- **Launch its coin.** `fatline coin launch`, approved in your own wallet. One per egg or Fatliner; $FATLINE comes first.

The rules, as the contract enforces them:

- **777 places**, for live eggs and Fatliners together.
- **If the node stops, the egg dies.** Its account sleeps seven days before it can take another.
- **Who goes first.** The contract can publish one ranking, once, to order who may lay an egg (day one the first 777, day two the first 7,777, day three the first 77,777). It has not been published, so eggs are open to everyone.
- **Sales.** An egg or Fatliner changes hands only by a sale in USDC: 92% to the seller, 8% to the builder (jpfraneto.eth). It arrives asleep, and wakes when its new holder links their own Farcaster account.
- **One contract per Fatline.** While it is an egg, its holder can tie one smart contract to it, once: the contract its client runs on.

## Workers

Nobody needs one of the 777 to keep the network. **A worker** is a wallet made on your own machine, no account and no being, that rents a node and keeps a full copy of Farcaster. Its reward is its own node and client. `fatline worker new`, or ask your agent for a worker.

## What is true today (2026-10-29)

| | |
|---|---|
| **Live on Base** | The Fatliners contract, also the launchpad. Eggs are open to every account. Two Fatliners have hatched: Thaituma (#13505) and Aster (#16098, the genesis). One egg is warming: Aenon (#20630). |
| **Coins** | One: $FATLINE, Aster's, `0xf1a97b6ceb7e635acae271f35a30a6c7b8b9580d`, as the contract's `coinOfFatliner(16098)` returns it. Its fees, in USDC, have paid its server's rent once. |
| **Running** | A Snapchain node and a Hypersnap node on one server in Nuremberg, the first checker. Thaituma's and Aenon's servers are off; their places show as asleep. Live state: [fatline.ink/nodes](https://fatline.ink/nodes). |
| **Built, not deployed yet** | The registry (2026-10-29): [fatline.ink/nodes](https://fatline.ink/nodes), `/api/registry`, and Bring your node in every client. Untested with a stranger's node. |

The source lists what is tested and what is not: [README](https://github.com/jpfraneto/fatline#readme).

## Where the name comes from

In Dan Simmons' *Hyperion*, humanity's worlds are joined by **farcasters**, portals that put distant planets one step apart, and news crosses between stars on the **fatline**. Farcaster took its name from the book. Fatline takes the other one: a line you hold at both ends, your keys at one, your own node at the other.

<video class="demo" controls playsinline preload="metadata" poster="media/fatline-clip.jpg" src="media/fatline-clip.mp4"></video>

*Fatline in 100 seconds. [The full 4-minute version](media/fatliners-demo.mp4) · [transcript](media/fatliners-demo.srt)*

## More

- [The manifesto](../manifesto.html)
- [The nodes, as they are](../explore.html)
- [The source](https://github.com/jpfraneto/fatline): its README lists what is tested and what is not
- [For agents](../skill.md) · [llms.txt](../llms.txt)
