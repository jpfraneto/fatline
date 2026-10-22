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

## Which wallets belong to an FID (checked on our own node, 2026-10-22)

Farcaster links wallets to an FID in two official ways. Our node serves both:

- **Custody address:** the wallet that owns the FID, recorded on Optimism by the IdRegistry contract. Our node keeps these onchain events: `/v1/onChainEventsByFid?fid=…&event_type=EVENT_TYPE_ID_REGISTER` (register and transfer events; the latest one is the current owner). For @anky (FID 18350): `0x3ae5…6b60`, registered at Optimism block 111,894,699.
- **Verified addresses:** `VERIFICATION_ADD_ETH_ADDRESS` messages (`/v1/verificationsByFid`). Each one carries a signature by the wallet itself saying "I belong to this FID", so both sides agreed. @anky has two Ethereum and one Solana address.

**For the claim on Base:** our nodes compute the 777 FIDs and, for each, its custody address and verified Ethereum addresses at one fixed block. The Merkle root of those (FID, address) pairs goes into the Fatliners contract. The person connects any of those wallets and signs the claim on Base; the contract checks the Merkle proof. Anyone with a node can recompute the root, so nobody has to trust us. A wallet linked after the snapshot needs a root update.

## The $SNAP score (found 2026-10-22)

Source: **FIP "Proof of Work Tokenization", Section 10** (github.com/orgs/farcasterorg/discussions/19, by @cassie, created 2026-03-24, edited 2026-10-12). Her casts point there whenever someone asks how the retro was calculated (2026-04-15 to 04-18), and on 2026-04-27 she said the finalized calculation was being published.

- The retroactive distribution rewarded **growth only**, using the same score as Hypersnap's forward "Growth" work market (Section 6), run once over all history before the fork. 200M of the 2B $SNAP went to it (her casts, 2026-04-15 and 04-16).
- `allocation(fid) = composite(fid) / Σ composite · RETROACTIVE_POOL`, with `composite = credibility × growth_score`, for eligible FIDs only.
- `growth_score(f) = Σ over credible counterparties u with reciprocal engagement: ln(1 + mutuality) · credibility(u)`. Replies, mentions, reactions and follows count, only after the last custody transfer of both FIDs.
- `credibility = 0.25 · age_factor + 0.35 · trust_score + 0.20 · interaction_entropy + 0.10 · stake (0 for the retro) + 0.10 · client_diversity`.
- `trust_score` = EigenTrust over the follow graph, seeded by FIDs ≤ 50,000, damping 0.85, normalized by the average of the top 100, times age_factor (full at 180 days since the last custody change).
- Eligibility filters F0–F6: not an app (fewer than 100 signers requested), casts > 0, engaged by ≥ 3 others, plus data-derived diversity thresholds.
- It is deterministic: one fixed snapshot, integer arithmetic, FID order, no outside data. The FIP names a reference implementation, `src/bin/retro_rewards_finalize.rs`, but **it is not in farcasterorg/hypersnap's main branch** (checked 2026-10-22). The allocations were paid by an Ethereum contract whose address we haven't found yet.

**So the 777:** the top 777 FIDs by retro allocation. Two ways to get them: read the published allocations (the contract or the final list; fastest, if we find it), or recompute them on our own node with the FIP's rules (fully ours and checkable, but a big job: EigenTrust over the whole follow graph). Best: take the published list first, recompute later to check it.

## Open questions

1. **Proving FID ownership on Base:** proposed above (Merkle root of custody + verified addresses at a fixed block). To confirm.
2. **The $SNAP list:** find the retro distribution contract or the published final list (hypria.app), or recompute.
3. **Who pays the first claims,** before any vault has fees? Probably the $FATLINE vault, since the launchpad is the first Fatline.
4. **Naming (decided):** `FATLINERS.sol` is the collection of 777. `FATLINER.sol` is one Fatliner's own code, hello world at first. Different contracts.
5. **Cost of a body.** A full node is ~$2.75/day (Hetzner, 2026-10-22), so a Fatliner needs about $1,000 a year of fees to stay alive. All 777 alive would be ~$2,100/day. Only the ones whose coins trade will have bodies.
