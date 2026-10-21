# Infinicaster indexer

The backend that feeds the apps. It reads the network the reader chose (Farcaster or Hypersnap) from the first healthy node in the config, preferring your own. It also rebuilds the Voices feed from contract logs into SQLite. Deleting `.infinicaster/indexer.sqlite` and restarting gives the same feed.

```sh
npm ci && npm start        # or from the root: ./infinicaster up
npm test
```

Every network answer includes `source: { network, node, own }`.

| Endpoint | Returns |
| --- | --- |
| `GET /api/config` | networks, default network, contract addresses |
| `GET /api/networks` | every node of every network with sync status, and which one is in use |
| `GET /api/feed?network=&fids=3,2&before=&limit=&replies=1` | voices + casts of the chosen people, newest first. With no `fids`: every voice |
| `GET /api/voices/:id?network=` | one voice, its FID claim checked on that network, and its replies |
| `GET /api/thread?network=&fid=&hash=` | a cast and its direct replies |
| `GET /api/user?network=&q=dwr` | profile by username or FID |
| `GET /api/apps` | every app born from the factory: metadata, coin, live vault state (USDC, fees, life, tier, DAU) |
| `GET /api/apps/:vaultOrCoin` | one app |
| `POST /api/launch/prepare` | everything a wallet needs to launch: predicted vault, app params, and the Clanker deployment built with `clanker-sdk` (fees 100% to the vault, in USDC) |
| `GET /api/health` | indexer and Voices sync state |

**Keeper.** With `KEEPER_PRIVATE_KEY` and `KEEPER_VAULT` set, the server pays itself from its app's vault, once a day's worth is due (the vault harvests trading fees first). When its rented server is within 3 days of expiring, it renews the rental over x402 with that USDC. See `src/keeper.mjs`.

Overrides: `PORT`, `INFINICASTER_CONFIG`, `INFINICASTER_DATA`, `VOICES_RPC`, `VOICES_ADDRESS`, `LAUNCHPAD_RPC`, `LAUNCHPAD_FACTORY`, `KEEPER_PRIVATE_KEY`, `KEEPER_VAULT`, `KEEPER_INTERVAL_MS`. It uses Node's built-in SQLite (`--experimental-sqlite`, Node 22.12+). Dependencies: `viem` and `clanker-sdk` (pinned).
