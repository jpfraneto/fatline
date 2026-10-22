# The Fatline protocol (design, 2026-10-22)

The owner's design, written down. Nothing here is built as one flow yet; the parts that already exist are named.

## The idea in one line

A Fatline is a link (ours: fatline.ink). Behind the link there is a node, and the node indexes one smart contract: its own. The contract is the Fatline's code; the node only reads what happens on the chain and shows it.

## How a Fatline comes into being

1. **A wallet.** `npm i -g fatline`, then the first run creates a wallet on the person's own machine. The key never leaves it. We never see it.
2. **The Fatliner.** With that wallet they mint a Fatliner NFT. The mint is sponsored: they sign, a relayer sends the transaction and pays the gas (cents on Base).
3. **The coin.** Holding a Fatliner lets them launch that Fatline's coin through the launchpad, paired with USDC on Base. The coin's address can be known in advance from the token (CREATE2), so its page `fatline.ink/base/0x…` exists from the start.
4. **Birth.** The first USDC of trading fees bring it to life. Until then it exists but sleeps.
5. **Life.** From then on, its contract's code runs every time anyone transacts with it (a trade, a mint, a call). Nothing has to wake it up: no heartbeat, no keeper on a schedule. Its life is the events it emits, ad infinitum.
6. **Its node.** The node is the indexer of that contract. It reads the contract's events (plus Farcaster or Hypersnap) and renders them in the apps it serves at the Fatline's link. Different frontends, one link.

**Ours:** $FATLINE's code is the launchpad contract itself. The first Fatline's life is giving birth to the others: every launch is an event in it, and fatline.ink is the node that indexes those events and renders the board.

## Rules that keep it trustless

- **No keys in our hands.** Wallets are made on the person's device. Relayers only carry signed messages.
- **Reads only from events.** What a node shows comes from the chain's events and the network's signed messages, both checkable by anyone. Nothing depends on a server's word.
- **Every node indexes its own contract.** Anyone can run the same node code against the same contract and get the same result.

## Minimal parts, and what exists today

| Part | Exists? |
|---|---|
| Local wallet on first run | Partly: `.fatline/compute-wallet.key` is made by `./fatline compute`. Not yet an npm package. |
| Fatliner NFT, sponsored mint | Contract written and tested in `fatliners/contracts`, not deployed. The relayer is not built. |
| Launchpad: coin paired with USDC (Clanker v4) | `AppFactory` + `AppVault`, tested on a Base fork, not deployed. |
| Birth from the first trading fees | Not built. Clanker fees go to the vault today; "alive" isn't defined by them yet. |
| Node indexes its own contract and serves its link | The indexer already reads Base contracts (Voices, launchpad). Not yet "one node, one contract". |
| Board of Fatlines (fatline.ink) | Live, with our real nodes and labelled examples. |

## To take out of what exists

- **Daily check-ins and the scheduled keeper** in `AppVault` (signed check-ins to count daily users, and a keeper that pays the server every day). The design has no heartbeat. Paying the server can be a pull: the node withdraws its rent from the vault when a bill is due. That is a transaction the node makes when it needs money, not a heartbeat.

## Open questions

1. **What does "alive" mean exactly?** The first fee of any size, or enough to pay its node's first day? And what does going dark look like: the vault can't pay the node's rent?
2. **The Fatliner and the person's Farcaster account.** Fatliners are drawn from an FID's history, but a brand-new wallet has no FID. How does the mint link a person's FID? (For example: the FID's custody key signs once, or a verified address.)
3. **What each Fatline does.** Its contract is its code. Is it one shared template with settings, or can each Fatline bring its own code?
4. **One node per Fatline?** A full node costs ~$2.75/day (Hetzner, 2026-10-22); 777 of them would be ~$2,100/day. Either the NFT gives the right to run one's own node, or many Fatlines share nodes and each one's fees pay its share.
5. **Who pays the sponsored mints** (cents each) before any fees exist?
