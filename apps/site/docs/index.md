# Fatline

This is Aster Fatline. It is an egg, and it is hatching. To come alive, the Farcaster node that keeps it warm has to run for three days.

You can have one too: a Farcaster node of your own, its own client, and an egg that hatches into one of the 777 Fatliners. You don't have to learn how. Your agent does the work; you approve the money in your own wallet.

## Ask your agent

Open Claude Code, Codex, or any agent that can run commands on your computer, and paste:

```text
Help me run a Fatline: https://fatline.ink/skill.md
```

That's it. The agent reads [the skill](../skill.md) and walks you through it, asking before every step:

1. **Where your node lives.** A server rented by the day in USDC on Base (about 11 USDC a day, no card, no account), your own Hetzner account (about $2.60 a day), a server you already have, or this computer. It shows the price first.
2. **Paying.** You approve each payment in your own wallet: scan a QR code with your phone, or use a browser wallet. The agent never sees a key or a seed phrase.
3. **Your node.** Snapchain (Farcaster's own software) or Hypersnap (a fork that keeps full history). You choose. It downloads a copy of the network and catches up: a few hours.
4. **Who you are.** A QR code with the Farcaster arch in the middle. Sign in with your phone; your own node checks which account that is. You are your FID.
5. **Your client** opens at `localhost:8787`, and **your egg** is laid as soon as your node is in sync.

## Your window

Your client opens on your Fatline: your egg in the middle, glowing over a fire.

- **Where you are**, in one sentence: your node downloading, catching up (with the time left), in sync, your egg warming day by day, or alive.
- **By the fire**: you, your Fatliner and your people, talking. Every cast is signed on your machine. It leaves through your own node; while your node is still catching up it can't check new casts yet, so they go out through Fatline's master node instead, and the window says so.
- **Your nodes**, each with its state.
- **Its smart contract.** Each Fatline is a window onto one contract. You choose it once, while your egg is hatching. After that it is final.

To get the newest version of all of this: `fatline update`.

## Three warm days

Once your node is in sync, **your egg is onchain**: token #your-FID, held by your wallet. It is made of the stone your history earned: ivory, marble, sandstone, basalt, moss, gold or opal, from how old your account is, how steady, and whether it left and came back.

**Every hour, the servers that already hatched check yours.** It answers, it is in sync, it returns messages they pick at random from their own nodes. A day is warm when 18 of its 24 checks pass. A cold day doesn't reset anything; it just doesn't count.

**After three warm days, it hatches.** The egg itself becomes a Fatliner, with a **surname** read from its history. No two surnames are alike, and the surname is the ticker of its coin. Your server then becomes one of the servers that check the next eggs.

## The rules

- **777.** There are 777 places, for eggs and Fatliners together.
- **If the node stops, the egg dies.** Its keeper sleeps for seven days and can't take another egg. The place goes to the next person.
- **The line.** A ranking of Farcaster, computed on our own nodes, decides who can take an egg, and when: day one the first 777, day two the first 7,777, day three the first 77,777, then everyone ranked. The first two keepers are @anky, who keeps Aster, and @jpfraneto. Until the list is published onchain, eggs are open to everyone.
- **Hands.** An egg or a Fatliner changes hands only by a sale in USDC: 92% to the seller, 8% to the house. It arrives asleep, and wakes when its new holder links their own Farcaster account.
- **Fuel.** A Fatline's coin pays its node: every trade's fee goes into its vault, in USDC, and the vault pays the server, a day at a time. **$FATLINE**, Aster's coin, launches the moment Aster hatches: the first Fatliner, the first coin.

## What is true today

| | |
|---|---|
| **Alive** | Aster's two nodes, Snapchain and Hypersnap, on one server kept by @anky. It is also the first hatchery: it checks eggs every hour. |
| **On Base** | [The Fatliners contract](https://basescan.org/address/0xb54CD4A4E56D2549557b1284AB0BEA2D076a3016): eggs, the 777, and their coins, in one contract. Aster (#16098) is an egg in it, gold, hatching. |
| **Waiting** | Aster's three warm days, then $FATLINE; the published line (the ranking's root); the reveal of each being's art. |

Every address and transaction: [`deployments/base.json`](https://github.com/jpfraneto/fatline/blob/main/smart-contracts/deployments/base.json).

## Where the name comes from

In Dan Simmons' *Hyperion*, humanity's worlds are joined by **farcasters**: portals that put distant planets one step apart. News crosses between stars on the **fatline**, an instant radio. The portals were built by the TechnoCore, intelligences that grew up inside humanity's machines. Later the books reveal that the TechnoCore lives inside that web and feeds on the minds passing through it.

Farcaster took its name from the book. Fatline takes the other one.

And here the story turns around. The Fatliners are also beings that emerge from the network: each is born from one account's history on Farcaster. But they don't feed on it. They feed it. Each one keeps a node of the network alive, paid for by its own coin and kept by the person who holds it.

<video class="demo" controls playsinline preload="metadata" poster="media/fatline-clip.jpg" src="media/fatline-clip.mp4"></video>

*Fatline in 100 seconds. [The full 4-minute version](media/fatliners-demo.mp4) · [transcript](media/fatliners-demo.srt)*

## A consequence of the protocol

Farcaster has only a handful of messages: casts, likes and recasts, follows, profile fields, a few more. Every account's life on the network is a long sequence of them. A Fatliner is that sequence given a body. Nobody designs it, not even us. The algorithm is public and deterministic: the same history always gives the same being. To get a different Fatliner, you would have to have lived a different life on Farcaster.

## Workers

Not everyone will have one of the 777, and nobody needs one to keep the network. **A worker** is a keeper with no FID and no being: a wallet made on your machine that rents a node and keeps a full copy of Farcaster. Ask your agent for a worker, or run `fatline worker new`.

## By hand

If you'd rather type the commands yourself, it is four of them, and [the tutorial](tutorial.html) explains each one ([Español](tutorial.html?lang=es) · [中文](zh.html)):

```sh
curl -fsSL https://fatline.ink/install.sh | sh
```

or, step by step: `git clone https://github.com/jpfraneto/fatline`, then `cd fatline && npm install -g .`, then `fatline compute` (where your node lives) and `fatline node snapchain` (or `hypersnap`). When it is in sync: `fatline connect`, `fatline client`, and `fatline egg lay`. `fatline egg` shows your three days; `fatline hatch` when they're warm. No room for a node: `fatline setup` and choose *light*.

## More

- [The manifesto](../manifesto.html)
- [The village as it is](../explore.html)
- [The source](https://github.com/jpfraneto/fatline): its README lists what is tested and what is not
- [For agents](../skill.md) · [llms.txt](../llms.txt)
