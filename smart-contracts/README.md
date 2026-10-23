# Fatline contracts

Foundry project. No upgradability, no protocol owner, no protocol fee.

| Contract | What it does |
| --- | --- |
| [`AppFactory`](src/AppFactory.sol) | Gives birth to apps. One transaction creates the app's vault, optionally launches its coin on Clanker paired with USDC, and funds the vault (`launchAppWithPermit` needs no separate approval). After launching it reads Clanker's records and reverts unless 100% of fees go to the vault, in USDC, with the vault as the only fee admin. |
| [`AppVault`](src/AppVault.sol) | One app's USDC. In: coin trading fees (`harvest`, anyone can call it), deposits from anyone. Out: the keeper (the server's wallet) pays itself one billing period ahead (`payCompute`), and the owner (a person or a Safe) can `withdraw`. It also counts its own daily users: `checkIn()` or signed `checkInFor()` batches, one per person per day, verified onchain (ECDSA and ERC-1271). Compute tiers unlock from yesterday's count. `aliveUntil()` is when the money runs out. |
| [`Fatliners`](src/Fatliners.sol) | The 777 beings. Token id = FID. Free mint from **that day's list** (day one the top 777, day two the top 7,777, …). **Nobody posts the list alone:** a fixed group of attesters, people who run their own nodes, each compute it with the same public code and vote for its Merkle root; it becomes the list when **more than half** vote for the same root (half rounded down, plus one, so two lists can never both win). No majority, no mint that day. An agreed root never changes; a proof only works on its day. **The keeper link:** the holder links the FID they live through (`linkFid`); it starts as the origin FID and is cleared on every transfer, so a new holder brings their own frame of reference, while the body it was born with (its DNA) stays. Each leaf binds FID, the address that may mint it, rank and a hash of its history (its DNA, kept onchain for the hatching reveal). Resales: 8% royalty (ERC-2981) to the Fatliner's own vault, as fuel; not enforced on transfers. |
| Fatliner vaults | `AppFactory.createFatline` / `launchFatline`: one vault per Fatliner, at an address known before it exists (`predictFatlinerVault`, so royalties are never lost), created only by the holder. **Its owner is whoever holds that Fatliner**, read live: sell the NFT and the vault, its coin's fees and its history go with it. 100% of the coin's fees go to it; the holder decides what to do with them. Any other coin can still launch without a Fatliner. |
| [`Voices`](src/Voices.sol) | Long-form opinions, up to 16 KiB, stored in event logs. A voice can claim a FID; indexers verify it on the network the reader chose. |
| [`PrizeSplit`](src/PrizeSplit.sol) | A payout address owned 50/50 by two people, for ETH and any ERC-20. |

```sh
forge test                                                            # unit + fuzz tests (the fork test skips)
BASE_RPC_URL=https://mainnet.base.org forge test --match-path "test/fork/*" --ffi -vv   # real Clanker on a Base fork
../fatline contracts fork | local | deploy | split
```

Default tiers ([`script/Deploy.s.sol`](script/Deploy.s.sol)) are in USDC units per second, where 1 unit/s = 2.592 USDC per 30 days:

| Tier | Rate | Unlocks at |
| --- | --- | --- |
| Seed | 6 (~15.55 USDC / 30 days) | always |
| Grow | 18 (~46.66 USDC / 30 days) | 100 DAU |
| Node | 58 (~150.34 USDC / 30 days) | 1,000 DAU |

Tiers are fixed per factory.

## Limits to know

- **The keeper is trusted for compute.** The contract cannot see whether the server really runs. It limits the keeper to one billing period ahead and to the money that exists.
- **DAU counts wallets, not humans.** Every check-in is verified onchain, but fresh wallets are free. `setMinCoinToCount` limits counting to coin holders. Inflating the count only makes the owner's own app spend faster.
- **The owner can withdraw everything.** That is the owner's agency. It cannot claw back compute already paid.
- **A Fatliner's holder can empty its vault, even right before selling it.** Buyers should look at the vault's balance (it is public) when they buy, not before.
- **A majority of attesters is trusted.** If more than half of them lie together, their list wins. Anyone can rebuild each day's tree from the public ranking and see it. The group is fixed at deployment.
- **The keeper link is a claim.** The contract records the FID the holder names; readers check on a node that the holder's address belongs to it.
- **Royalties are a request.** ERC-2981 is read by marketplaces, not enforced on transfers.
- **Voices are permanent.** Text stays in chain history after `retract`.
- None of these contracts has had an external audit, and none is deployed to a public chain yet.
