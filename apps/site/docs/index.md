# Fatline

<video class="demo" controls playsinline preload="metadata" poster="../img/world/the-weaving.jpg" src="media/fatliners-demo.mp4"></video>

*The first demo of the Fatliners and the network they keep.*

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

## Mint one of the 777

Paste this into Claude Code, Codex, or any agent that can run commands:

```text
Help me mint one of the 777 Fatlines. Follow https://fatline.ink/skill.md
```

**The mint is not open yet.** The 777 come from an open ranking of the whole network that will be published and agreed on in public before the mint. Until then, the agent shows you what is coming and helps you run your own node. Why it works this way: [the manifesto](../manifesto.html).

## Run your own node

One line. It downloads Fatline and walks you through it, asking before every step:

```sh
curl -fsSL https://fatline.ink/install.sh | sh
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
fatline node farcaster
```

1. Downloads the code. All of it is open source (MIT): read it first.
2. Puts the `fatline` command on your machine.
3. Rents a server for your node on Hetzner, about $3–5 a day. It shows the price first and creates nothing until you type **create**. To stop paying: `fatline compute hetzner down`.
4. Installs your own read node: `farcaster` (Snapchain) or `hypersnap`. It takes 1–3 hours, plus catching up. When it answers, `fatline up` opens your client at `localhost:8787`.

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

## More

- [The village as it is](../explore.html): the board, the world, the 777
- [The manifesto](../manifesto.html)
- [The source](https://github.com/jpfraneto/fatline): its README lists what is tested and what is not
- [The Fatline protocol](https://github.com/jpfraneto/fatline/blob/main/research/FATLINE-PROTOCOL.md)
- [For agents](../skill.md) · [llms.txt](../llms.txt)
