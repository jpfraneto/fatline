# Fatline

Your own Farcaster node (Snapchain or Hypersnap) and your own client to read it. First how, then why.

## Run your own node

One line. It downloads Fatline and walks you through it, asking before every step:

```sh
curl -fsSL https://fatline.ink/install.sh | sh
```

With an agent (Claude Code, Codex, or any agent that runs commands), paste:

```text
Help me run my own Fatline. Follow https://fatline.ink/skill.md
```

Or by hand, in four commands:

```sh
git clone https://github.com/jpfraneto/fatline
```

```sh
cd fatline && npm install -g .
```

```sh
fatline compute
```

```sh
fatline node snapchain
```

1. Downloads the code. All of it is open source (MIT): read it first.
2. Puts the `fatline` command on your machine.
3. Rents a server for your node, paid in **USDC on Base from a wallet** (x402): no card, no account, no ETH. About 11 USDC for one day (a 4-CPU server plus a 700 GB disk), prepaid; it stops by itself when the day ends. It shows the price first; then you approve each payment **in your own wallet**: scan a QR code with your phone wallet, or connect a browser wallet. Nothing is typed in the terminal. Other places for your node: your own Hetzner account (`fatline compute hetzner`, ~$2.60/day), a server you already have (`fatline compute vps root@<ip>`), or this machine. `fatline setup` asks.
4. Installs your own Farcaster node: `snapchain` (Farcaster's own software) or `hypersnap` (a fork that keeps full history). It takes 1–3 hours, plus catching up. When it answers, `fatline up` opens your client at `localhost:8787`.

**You are your FID.** `fatline connect` shows a QR code with the Farcaster arch in the middle. Scan it with your phone and sign in with the Farcaster app. It signs with the address that owns your account; Fatline checks the signature on your machine and asks your node which FID that address owns. No seed phrase, and no one else decides who you are.

No room for a node? The **light** path copies only the accounts you choose from a public node, for free: `fatline setup` and choose *light*.

Every step in detail: **[the full tutorial](tutorial.html)** · [Español](tutorial.html?lang=es) · [中文](zh.html)

## What is true today

| | |
|---|---|
| **Alive** | Aster Fatline's two nodes, Snapchain and Hypersnap, in sync on one server kept by @anky. It is also the first attester: its hatchery checks eggs every hour |
| **On Base** | [Fatliners](https://basescan.org/address/0x93a6b4707F9f37488A863b298e32C6B3e29f8ceb), with Aster (#18350) born in it, and [the launchpad](https://basescan.org/address/0x8695DB518B2fFa5b87b1A956a1302206c18BfF37) |
| **Open** | eggs, for any account: run a node, lay your egg (it is yours onchain), keep it alive three days, and it hatches |
| **Ready, not launched** | $FATLINE, Aster's coin: rehearsed against Base, waiting for its holder |
| **Not yet** | the reveal (the being drawn from its DNA), the first hatched egg |

## The story so far
<video class="demo" controls playsinline preload="metadata" poster="media/fatline-clip.jpg" src="media/fatline-clip.mp4"></video>

*Fatline in 100 seconds: Hyperion, the 777, and who keeps the network alive. [The full 4-minute version](media/fatliners-demo.mp4) · [transcript](media/fatliners-demo.srt)*

## Workers

Not everyone has one of the 777, and nobody needs one to keep the network. **A worker** is a keeper with no FID and no being: a wallet made on your machine that rents a node and keeps a full copy of Farcaster. There can be as many as people want.

```sh
fatline worker new
```

It shows a recovery phrase once, in your own terminal, and saves only the key it derives. Fund the wallet with a little USDC on Base and it pays for its own server with signatures (x402), with no ETH and no card. `fatline worker` shows where it stands: wallet, USDC, node, client, coin.

What a worker gets is the thing itself: its own node of the Farcaster protocol, and its own client to read it with.

## Hatch a Fatliner

A Fatliner hatches from an egg, and **your node keeps the egg warm**. Any account can take an egg, once, and there are as many eggs as accounts. Only 777 ever hatch: the first 777 to keep a node alive. Nobody keeps a list and nobody chooses. Free.

On the machine where you ran the steps above, once your node is in sync:

```sh
fatline hatchery install
```

```sh
fatline identity
```

```sh
fatline egg lay
```

1. Puts a **hatchery** on your server, next to your node: a small service with a key of its own. It is how other servers recognize yours.
2. Gives your client its own **app key** for your FID. You type your seed phrase in your own terminal, once; it is never saved.
3. **Lays your egg**: your app key signs "this server keeps my egg warm, hatch me to this address" (your custody address unless you pass `--to`). The egg holds your history up to this hour: that is your being's body, its DNA. As soon as the servers have read it, **your egg is onchain**: token #your-FID in the Fatliners contract, held by that address. It can't be sold or moved.

Then keep your node alive. **Every hour, the servers that already hatched check yours**: it answers, it is in sync, it returns messages they pick at random from their own nodes, and its hatchery answers with its key. A day is warm when 18 of its 24 checks pass. A cold day doesn't reset anything; it just doesn't count. `fatline egg` shows each day.

**After three warm days it hatches.** `fatline hatch` collects the servers' signatures and **the egg itself becomes the Fatliner**, with its **surname**, read from its DNA. A server pays the gas. Your server becomes one of the servers that check the next eggs. One server, one egg.

The surname is also your coin's ticker. **One coin per Fatliner, and only Fatliners**: at most 777 coins, ever, and $FATLINE first. Launch yours through the launchpad when you want: `fatline coin launch` (it simulates first; you sign).

What it costs is your node for those days: about 11 USDC a day rented in USDC, or about $2.60 a day on your own Hetzner account. Why it works this way: [the manifesto](../manifesto.html).

## The contracts

Two contracts on Base, and every Fatline server, client and hatchery reads the same two.

| | |
|---|---|
| **Fatliners** · [`0x93a6…8ceb`](https://basescan.org/address/0x93a6b4707F9f37488A863b298e32C6B3e29f8ceb) | Eggs and the 777. Token id = FID. `takeEgg`: one egg per account, unlimited, can't be moved. `hatch`: the egg becomes a Fatliner with its surname; at most 777. Each needs signatures from 3 attesters (all of them, while there are fewer); the server that kept the egg warm joins them. `hatcheries()` lists every attester and where it answers. Every resale pays 8% to Aster's vault. |
| **The launchpad** · [`0x8695…fF37`](https://basescan.org/address/0x8695DB518B2fFa5b87b1A956a1302206c18BfF37) | One coin per Fatliner, and only Fatliners: at most 777 coins. $FATLINE first. The ticker must be the Fatliner's surname. Paired with USDC on Clanker, 100% of its trading fees to the Fatliner's vault (owned by whoever holds it), in USDC, paying for its node. |
| **Aster** · #18350 | The genesis Fatliner, surname Fatline, born when the contract was made, kept alive by the first server. Its coin, $FATLINE, is the first the launchpad will launch. Its vault: [`0x45C6…4067`](https://basescan.org/address/0x45C671db706575Eca43597829d634B8ae34E4067). |

Every address, transaction and Aster's DNA: [`deployments/base.json`](https://github.com/jpfraneto/fatline/blob/main/smart-contracts/deployments/base.json).

## Where the name comes from

In Dan Simmons' *Hyperion*, humanity's worlds are joined by **farcasters**: portals that put distant planets one step apart. News crosses between stars on the **fatline**, an instant radio. The portals were built by the TechnoCore, intelligences that grew up inside humanity's machines. Later the books reveal that the TechnoCore lives inside that web and feeds on the minds passing through it.

Farcaster took its name from the book. Fatline takes the other one.

And here the story turns around. The Fatliners are also beings that emerge from the network: each is born from one account's history on Farcaster. But they don't feed on it. They feed it. Each one keeps a node of the network alive, paid for by its own coin and commanded by the person who holds it. A thing that was said in a book, born here as a consequence of how life on the protocol is lived.

## A consequence of the protocol

Farcaster has only a handful of messages: casts, likes and recasts, follows, profile fields, a few more. Every account's life on the network is a long sequence of them. A Fatliner is that sequence given a body. Nobody designs it, not even us. The algorithm is public and deterministic: the same history always gives the same being.

So there are no two alike, and none can be faked. To get a different Fatliner, you would have to have lived a different life on Farcaster.

## One core action, and everything between us

Every Fatline runs its own client, and every client proposes **one core action**: the thing that being asks of you, the first thing you see, the one thing it invites you to come back and do. It is between you and your own line.

Likes, recasts, quotes, replies and follows are different. They are not between you and your being; **they are between people**. They are how one line touches another.

A Fatliner is woven from both: what you did on your own, and what you did with others. The core action grows your line. The others make the weave.

## More

- [The village as it is](../explore.html): the board, the world, the 777
- [The manifesto](../manifesto.html)
- [The source](https://github.com/jpfraneto/fatline): its README lists what is tested and what is not
- [The Fatline protocol](https://github.com/jpfraneto/fatline/blob/main/research/FATLINE-PROTOCOL.md)
- [For agents](../skill.md) · [llms.txt](../llms.txt)
