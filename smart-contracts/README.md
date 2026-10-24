# Fatline contracts

Foundry project. No upgradability, no protocol owner, no protocol fee.

**On Base (chain 8453), deployed 2026-10-24:** AppFactory [`0x341AE48f22cc4F7428C969a559cb832912A1119F`](https://basescan.org/address/0x341AE48f22cc4F7428C969a559cb832912A1119F) and Fatliners [`0x73B27C61F9370398EF778c1b3a14BD1Ea899e7e5`](https://basescan.org/address/0x73B27C61F9370398EF778c1b3a14BD1Ea899e7e5), linked (`setFatliners`). Aster (#18350) was born in the constructor. Addresses, transactions, block and Aster's DNA: [`deployments/base.json`](deployments/base.json). How it was deployed: `FATLINERS=true VOICES=false GENESIS=… GENESIS_URL=… GENESIS_FID=18350 GENESIS_TO=… GENESIS_DNA=… GENESIS_LAID_AT=… forge script script/Deploy.s.sol --broadcast`, from the genesis server.

| Contract | What it does |
| --- | --- |
| [`AppFactory`](src/AppFactory.sol) | The launchpad. **One coin per Fatliner, and only Fatliners** (at most 777 coins): `launchFatline` by its holder, once; the genesis Fatliner's coin first (`GenesisFirst`); the coin's symbol must be the Fatliner's surname (`WrongTicker`). One transaction creates the Fatliner's vault (or uses the one made earlier with `createFatline`), launches its coin on Clanker paired with USDC, and funds the vault. It reads Clanker's records and reverts unless 100% of fees go to the vault, in USDC, with the vault as the only fee admin. Apps without a coin can still have a vault (`createApp`). |
| [`AppVault`](src/AppVault.sol) | One app's USDC. In: coin trading fees (`harvest`, anyone can call it), deposits from anyone. Out: the keeper (the server's wallet) pays itself one billing period ahead (`payCompute`), and the owner (a person or a Safe) can `withdraw`. It also counts its own daily users: `checkIn()` or signed `checkInFor()` batches, one per person per day, verified onchain (ECDSA and ERC-1271). Compute tiers unlock from yesterday's count. `aliveUntil()` is when the money runs out. |
| [`Fatliners`](src/Fatliners.sol) | Eggs and the 777. Token id = FID. **`takeEgg`**: any account, once; the egg holds its DNA (history commitment up to the hour it was laid), names the server keeping it warm, and can't be moved; sent again it moves to another server. **`hatch`**: after three warm days the same token becomes a Fatliner with its surname (read from its DNA; its coin's ticker); at most 777; only from an egg. Both need EIP-712 signatures from 3 attesters, or all while fewer, sorted by signer. **Attesters are servers that hatched**: at hatching the egg's server joins (`hatcheries()` lists them and their URLs). Nobody adds or removes them. **Aster** (#18350, surname FATLINE) is born in the constructor with the genesis server, the only attester that didn't hatch. Every resale (8%, ERC-2981) pays Aster's vault. Keeper link (`linkFid`), cleared on every transfer. |
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
