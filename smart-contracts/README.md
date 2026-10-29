# Fatline contracts

Foundry project. No upgradability, no protocol owner, no protocol fee.

**On Base (chain 8453), deployed 2026-10-24:** Fatliners [`0xb54CD4A4E56D2549557b1284AB0BEA2D076a3016`](https://basescan.org/address/0xb54CD4A4E56D2549557b1284AB0BEA2D076a3016), which is also the launchpad (one contract; vaults are clones of one AppVault). Aster (#16098, the keeper's own FID) is reserved for its keeper, who claims it with `claimGenesis`. Addresses, transactions, block and Aster's DNA: [`deployments/base.json`](deployments/base.json). How it was deployed: `FATLINERS=true VOICES=false GENESIS=… GENESIS_URL=… GENESIS_FID=16098 GENESIS_TO=… GENESIS_DNA=… GENESIS_LAID_AT=… forge script script/Deploy.s.sol --broadcast`, from the genesis server.

| Contract | What it does |
| --- | --- |
| [`AppFactory`](src/AppFactory.sol) | The launchpad. **One coin per Fatliner, and only Fatliners** (at most 777 coins): `launchFatline` by its holder, once; the genesis Fatliner's coin first (`GenesisFirst`); the coin's symbol must be the Fatliner's surname (`WrongTicker`). One transaction creates the Fatliner's vault (or uses the one made earlier with `createFatline`), launches its coin on Clanker paired with USDC, and funds the vault. It reads Clanker's records and reverts unless 100% of fees go to the vault, in USDC, with the vault as the only fee admin. Apps without a coin can still have a vault (`createApp`). |
| [`AppVault`](src/AppVault.sol) | One app's USDC. In: coin trading fees (`harvest`, anyone can call it), deposits from anyone. Out: the keeper (the server's wallet) pays itself one billing period ahead (`payCompute`), and the owner (a person or a Safe) can `withdraw`. It also counts its own daily users: `checkIn()` or signed `checkInFor()` batches, one per person per day, verified onchain (ECDSA and ERC-1271). Compute tiers unlock from yesterday's count. `aliveUntil()` is when the money runs out. |
| [`Fatliners`](src/Fatliners.sol) | Eggs and the 777. Token id = FID. **`takeEgg`**: any account, once; the egg holds its DNA (history commitment up to the hour it was laid), names the server keeping it warm, and can't be moved; sent again it moves to another server. **`hatch`**: after three warm days the same token becomes a Fatliner with its surname (read from its DNA; its coin's ticker); at most 777; only from an egg. Both need EIP-712 signatures from 3 attesters, or all while fewer, sorted by signer (see Limits: any 3, however many there are). **Attesters are servers that hatched**: at hatching the egg's server joins (`hatcheries()` lists them and their URLs). Nobody adds or removes them. **Aster** (#16098, surname FATLINE) is reserved for its keeper (`claimGenesis`), with the genesis server, the only attester that didn't hatch. Every resale (8%, ERC-2981) pays Aster's vault. Keeper link (`linkFid`), cleared on every transfer. |
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
- **Any 3 attesters are trusted, however many there are** (`threshold()` = all attesters while fewer than 3, then 3). Attesters are permissionless: every server that hatches joins, and nobody removes one. Three that sign together can lay eggs for FIDs they don't own (to their own address), hatch them at once, and make each new server another attester of theirs: the 777 slots and their coins, and the real owners locked out (an FID with an egg only moves for the same owner). Running 3 servers honestly for 3 days is enough to become those three.
- **The three warm days are not checked onchain.** `hatch()` checks only the signatures and the surname; `WARM_DAYS` is a constant the contract never reads. The attesters' hatcheries enforce it, offchain.
- **A coin's Clanker config is mostly the launcher's.** `launchFatline` checks the ticker, fees 100% to the vault in USDC, and the USDC pair; the rest of `deployToken` (name, image, extensions, dev buy) is whatever the holder sends. Only the holder can launch, so this affects that coin's buyers, not the protocol.
- **The keeper link is a claim.** The contract records the FID the holder names; readers check on a node that the holder's address belongs to it.
- **Royalties are a request.** ERC-2981 is read by marketplaces, not enforced on transfers.
- **Voices are permanent.** Text stays in chain history after `retract`.
- None of these contracts has had an external audit. Fatliners, its vault implementation and Voices are deployed on Base (see above) and cannot be upgraded or paused: any fix is a new deployment.

## Known issues, with dates

- **2026-10-29: the attester gap** (the "any 3 attesters" and "warm days" limits above), reported by an unsolicited audit pitch (KupiaSec email; accurate on the code, wrong that it wasn't deployed). Not exploitable yet: on that day there were 2 attesters (the genesis server and Thaituma's, #13505), so both had to sign everything. **It opens when there are 4 or more attesters** (Aenon hatching makes 3, still all of them). Check: `cast call 0xb54CD4A4E56D2549557b1284AB0BEA2D076a3016 "attesters()(address[])" --rpc-url https://mainnet.base.org`.
  - If the owner decides to redeploy, the fix: `hatch` requires `block.timestamp >= laidAt + WARM_DAYS * 1 days`, and a signature set needs more than half of all attesters (not a flat 3). The cost of majority: if many servers go offline, nothing can be signed; decide how dead attesters drop out. Migration has to carry the Fatliners, live eggs and $FATLINE (already launched, bound to this contract's vault for Aster).
  - Not fixed. Owner's call (2026-10-29): keep awareness, no redeploy for now.

