# The Fatline protocol (design, 2026-10-22)

The owner's design, written down. Nothing here is built as one flow yet; the parts that already exist are named.

## The idea in one line

A Fatline is a link (ours: fatline.ink). Behind the link there is a node, and the node indexes one smart contract: its own. The contract is the Fatline's code; the node only reads what happens on the chain and shows it.

## How a Fatline comes into being

1. **The 777.** The collection is a hall of fame: the top 777 Farcaster accounts in Farcaster's history, each one reserved for its FID. A Fatliner's rarity follows from that account's score, computed deterministically from the $SNAP allocation (the owner's method; its exact rule and data source still need writing down here).
2. **Claiming it.** The person connects the wallet that owns their FID and signs there. Owning the FID is what matters, so the claim has to come from the FID's own wallet. The gas is paid for them (step 6).
3. **Its code.** Every Fatliner starts as hello world: `FATLINER.sol` in `/smart-contract` at the root of the repo. To change what a Fatliner does, its owner forks the repo, edits `FATLINER.sol` and deploys it. The contract is the Fatliner's code.
4. **The coin.** The owner launches that Fatliner's coin through the launchpad, paired with USDC on Base. Its address is `fatline.ink/base/0x…`.
5. **Birth.** It comes to life when its trading fees are enough to pay for its node. Until then it exists but has no body.
6. **The vault pays.** Each Fatliner has a vault. Fees flow in; the vault pays the node's server and the gas of the Fatliner's own transactions, including the claim. That is the point of the vault.
7. **The Fatliner is the node.** One node per Fatliner. It indexes its own contract's events (plus Farcaster or Hypersnap) and serves its apps at its link. Its code runs every time anyone transacts with it: no heartbeat, nothing on a schedule.

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

## Decided (owner, 2026-10-22)

- Alive = trading fees cover its node.
- Claim = connect the FID's own wallet and sign there.
- The 777 = the top Farcaster accounts in history, rarity from the $SNAP allocation score.
- Code = hello world `FATLINER.sol` in `/smart-contract`, changed by forking the repo.
- One node per Fatliner: the Fatliner is the node.
- Gas and servers are paid by the Fatliner's vault.

## Open questions

1. **Proving FID ownership on Base.** FIDs live on Optimism (IdRegistry); the Fatliner lives on Base. A contract on Base can't read Optimism directly, so something has to carry the proof: a signed attestation (someone to trust), a storage proof (trustless, more work), or the FID's custody key signing a message the Base contract checks against a published list of the 777 custody addresses (simple, but custody can change after the list is made).
2. **The $SNAP score.** Write down the exact rule and where the data comes from, so anyone can recompute the 777 and their rarity.
3. **Who pays the first claims,** before any vault has fees? Probably the $FATLINE vault, since the launchpad is the first Fatline.
4. **Naming.** `fatliners/contracts/Fatliners.sol` is the collection (777 NFTs); `FATLINER.sol` would be each Fatliner's own code. Keep both names, or merge?
5. **Cost of a body.** A full node is ~$2.75/day (Hetzner, 2026-10-22), so a Fatliner needs about $1,000 a year of fees to stay alive. All 777 alive would be ~$2,100/day. Only the ones whose coins trade will have bodies.
