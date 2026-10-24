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
| **Alive** | Aster Fatline's two nodes, Snapchain and Hypersnap, in sync on one rented server kept by @anky |
| **Built** | the guided setup, your own node and client, the archive, and the pipeline that draws a Fatliner from any account's history |
| **Computed, not agreed** | the ranking of the whole network: not published or reviewed yet |
| **Not yet** | the 777 contract, the mint, the reveal, the vault as the being's own wallet, the coins |

## The story so far
<video class="demo" controls playsinline preload="metadata" poster="media/fatliners-demo.jpg" src="media/fatliners-demo.mp4"></video>

*The first demo: Hyperion, the tribes of Farcaster, and the 777. ([Transcript](media/fatliners-demo.srt))*

## Workers

Not everyone has one of the 777, and nobody needs one to keep the network. **A worker** is a keeper with no FID and no being: a wallet made on your machine that rents a node and keeps a full copy of Farcaster. There can be as many as people want.

```sh
fatline worker new
```

It shows a recovery phrase once, in your own terminal, and saves only the key it derives. Fund the wallet with a little USDC on Base and it pays for its own server with signatures (x402), with no ETH and no card. `fatline worker` shows where it stands: wallet, USDC, node, client, coin.

What a worker gets is the thing itself: its own node of the Farcaster protocol, and its own client to read it with. Its coin, deployed without gas once everything runs, comes when the launch contracts are on Base.

## Mint one of the 777

Paste this into Claude Code, Codex, or any agent that can run commands:

```text
Help me mint one of the 777 Fatlines. Follow https://fatline.ink/skill.md
```

**The mint is not open yet.** The 777 come from an open ranking of the whole network that will be published and agreed on in public before the mint. Until then, the agent shows you what is coming and helps you run your own node. Why it works this way: [the manifesto](../manifesto.html).

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
