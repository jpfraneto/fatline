# Infinicaster contracts

Foundry project. No upgradability, no protocol owner, no protocol fee.

| Contract | What it does |
| --- | --- |
| [`AppFactory`](src/AppFactory.sol) | Gives birth to apps. One transaction creates the app's vault, optionally launches its coin on Clanker paired with USDC, and funds the vault (`launchAppWithPermit` needs no separate approval). After launching it reads Clanker's records and reverts unless 100% of fees go to the vault, in USDC, with the vault as the only fee admin. |
| [`AppVault`](src/AppVault.sol) | One app's USDC. In: coin trading fees (`harvest`, anyone can call it), deposits from anyone. Out: the keeper (the server's wallet) pays itself one billing period ahead (`payCompute`), and the owner (a person or a Safe) can `withdraw`. It also counts its own daily users: `checkIn()` or signed `checkInFor()` batches, one per person per day, verified onchain (ECDSA and ERC-1271). Compute tiers unlock from yesterday's count. `aliveUntil()` is when the money runs out. |
| [`Voices`](src/Voices.sol) | Long-form opinions, up to 16 KiB, stored in event logs. A voice can claim a FID; indexers verify it on the network the reader chose. |
| [`PrizeSplit`](src/PrizeSplit.sol) | A payout address owned 50/50 by two people, for ETH and any ERC-20. |

```sh
forge test                                                            # unit + fuzz tests (the fork test skips)
BASE_RPC_URL=https://mainnet.base.org forge test --match-path "test/fork/*" --ffi -vv   # real Clanker on a Base fork
../infinicaster contracts fork | local | deploy | split
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
- **Voices are permanent.** Text stays in chain history after `retract`.
- None of these contracts has had an external audit, and none is deployed to a public chain yet.
