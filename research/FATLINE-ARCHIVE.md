# Fatline archive: shared interface proposal (draft, not approved)

Status: **approved by the owner on 2026-10-22: SQLite now (option A), archive only this client's own FID at first.**
Owner of this file: session 28 (schema, db module, API, frontend).
Adapters: c1 (Snapchain adapter, Farcaster master node), ea (same adapter, Hypersnap node).

## What it is

One personal archive per FID, built from two independently run network adapters.
Each adapter tails its own node and writes normalized events. The two networks are never merged into one truth: every row says which network it came from, and each network's status for a message is kept separately.
The network selector in the UI only chooses where a post is sent. It never changes whose archive is shown.

```
 Farcaster node ──▶ adapter (network=farcaster) ──┐
                                                  ├──▶ ingest() ──▶ fl_events (append-only log)
 Hypersnap node ──▶ adapter (network=hypersnap) ──┘                    │ same transaction
                                                                       ▼
                                                        fl_messages (state per network, per message)
                                                                       │
                                            GET /api/archive/:fid ◀────┘  grouped by message hash
```

## Facts this rests on (measured by c1)

- `/v1/events` is per shard (1 and 2 hold user data). The useful types are `MERGE_MESSAGE`, `PRUNE_MESSAGE`, `REVOKE_MESSAGE`, `MERGE_ON_CHAIN_EVENT` and `MERGE_USERNAME_PROOF`. `BLOCK_CONFIRMED` is skipped.
- **Event ids collide across networks.** crackle and haatz both returned id 803315318784 for shard 1, block 49030476. A raw reference is always `(network, shard, event_id)`.
- The **message hash** (20 bytes, part of the signed message) is the same on both networks when the same message lands on both. That is the cross-network identity.
- Snapchain keeps events for about 3 days. Cursors must be saved, and a gap means re-backfilling the affected FIDs.

## Tables

Written for MySQL 8. The same columns work in SQLite (see "Where it runs").

```sql
-- One row per running adapter.
CREATE TABLE fl_sources (
  id          SMALLINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  network     VARCHAR(16)  NOT NULL,            -- 'farcaster' | 'hypersnap'
  node_url    VARCHAR(255) NOT NULL,            -- never sent to the browser
  label       VARCHAR(64)  NOT NULL,
  UNIQUE KEY (network, node_url)
);

-- Where each adapter is in each shard's event stream.
CREATE TABLE fl_cursors (
  source_id   SMALLINT UNSIGNED NOT NULL,
  shard       SMALLINT UNSIGNED NOT NULL,
  event_id    BIGINT UNSIGNED   NOT NULL,       -- last event fully ingested
  updated_at  DATETIME(3)       NOT NULL,
  PRIMARY KEY (source_id, shard)
);

-- Which FIDs have an archive, and how far each adapter's backfill got.
CREATE TABLE fl_fids (
  fid         BIGINT UNSIGNED PRIMARY KEY,
  added_at    DATETIME(3) NOT NULL
);
CREATE TABLE fl_backfill (
  source_id   SMALLINT UNSIGNED NOT NULL,
  fid         BIGINT UNSIGNED   NOT NULL,
  kind        VARCHAR(24)       NOT NULL,       -- casts | reactions | links | user_data | verifications
  state       VARCHAR(12)       NOT NULL,       -- running | done | failed
  page_token  VARCHAR(255)      NULL,           -- to resume
  done_at     DATETIME(3)       NULL,
  PRIMARY KEY (source_id, fid, kind)
);

-- The log: every event an adapter saw, as it saw it. Append-only.
CREATE TABLE fl_events (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  source_id     SMALLINT UNSIGNED NOT NULL,
  network       VARCHAR(16)       NOT NULL,
  ref           VARCHAR(96)       NOT NULL,     -- raw reference: 'farcaster:1:803315318784', or 'farcaster:backfill:<hash>'
  shard         SMALLINT UNSIGNED NULL,
  event_id      BIGINT UNSIGNED   NULL,         -- NULL for backfill
  event_type    VARCHAR(32)       NOT NULL,     -- MERGE_MESSAGE | PRUNE_MESSAGE | REVOKE_MESSAGE | MERGE_ON_CHAIN_EVENT | MERGE_USERNAME_PROOF | BACKFILL
  dedup_key     VARBINARY(64)     NOT NULL,     -- message hash (20 bytes); onchain: chainId|txHash|logIndex; username proof: name|fid|timestamp
  fid           BIGINT UNSIGNED   NOT NULL,
  msg_type      VARCHAR(48)       NULL,         -- MESSAGE_TYPE_CAST_ADD, ...
  protocol_ts   DATETIME(3)       NULL,         -- the message's own timestamp
  ingested_at   DATETIME(3)       NOT NULL,
  body          JSON              NULL,         -- normalized (same shape as hub.mjs normalizeCast etc.)
  raw           JSON              NULL,         -- the event as the node returned it
  UNIQUE KEY (network, ref),
  KEY (fid, protocol_ts),
  KEY (dedup_key)
);

-- The state: what each network says about each message right now. Updated with the log, in one transaction.
CREATE TABLE fl_messages (
  network       VARCHAR(16)     NOT NULL,
  dedup_key     VARBINARY(64)   NOT NULL,
  fid           BIGINT UNSIGNED NOT NULL,
  msg_type      VARCHAR(48)     NULL,
  protocol_ts   DATETIME(3)     NULL,
  status        VARCHAR(12)     NOT NULL,       -- merged | pruned | revoked | removed (by a later *_REMOVE)
  first_event   BIGINT UNSIGNED NOT NULL,       -- fl_events.id
  last_event    BIGINT UNSIGNED NOT NULL,
  body          JSON            NULL,
  PRIMARY KEY (network, dedup_key),
  KEY (fid, protocol_ts)
);
```

"Never seen on a network" is not stored. It is the absence of a row for that network, and the API reports it as `null`.

## The interface between adapters and the database

The adapter never writes SQL. It calls the db module (`indexer/src/archive.mjs`, owned by 28):

```js
archive.source({ network, nodeUrl, label })          // -> sourceId (get or create)
archive.cursor(sourceId, shard)                      // -> last event_id or null
archive.ingest(sourceId, events, { shard, cursor })  // one transaction: append events, update fl_messages, save cursor
archive.fids()                                       // FIDs to backfill and filter on
archive.backfill(sourceId, fid, kind, { state, pageToken })
```

One normalized event, as c1 proposed:

```js
{
  network: 'farcaster', shard: 1, eventId: 803315318784n,   // eventId null for backfill
  eventType: 'MERGE_MESSAGE', dedupKey: '0x<20-byte hash>', fid: 18350,
  msgType: 'MESSAGE_TYPE_CAST_ADD', protocolTs: 1792600000000, // ms
  status: 'merged', body: { ... }, raw: { ... },
  target: '0x<hash>' | null,   // for CAST_REMOVE etc.: the message whose status becomes 'removed'
}
```

Rules:
- `ingest` is idempotent. Replaying the same events is safe because of `UNIQUE (network, ref)`.
- The cursor moves only in the same transaction as the events it covers.
- A gap (the saved cursor is older than the node's oldest event) marks every tracked FID's backfill as `running` again for that source.
- Removals of reactions and links point at a body (type and target), not at a hash. The adapter resolves that to the target's `dedup_key` before calling `ingest`.

## What the frontend reads

`GET /api/archive/:fid?before=<ms>&types=cast,reaction,link` returns one list, newest first, grouped by message:

```json
{ "items": [
  { "key": "0x…", "fid": 18350, "type": "MESSAGE_TYPE_CAST_ADD", "at": 1792600000000, "body": { "text": "…" },
    "networks": { "farcaster": "merged", "hypersnap": null } } ],
  "sources": [ { "network": "farcaster", "label": "Fatline master node", "cursorAt": 1792600000000 } ],
  "more": 1792590000000 }
```

The page shows one archive. Each item says which networks hold it. Posting goes to the network chosen in the selector.

## Where it runs: the owner decides

There is no MySQL in this repository today. The indexer uses `node:sqlite`.

| Option | What it means | Cost and risk |
| --- | --- | --- |
| **A. SQLite now, MySQL later** (recommended) | Same tables in the indexer's SQLite file. The db module hides the engine, so moving to MySQL changes one file. | Nothing new to run. Two adapter processes writing one SQLite file works (WAL mode, a busy timeout), but one writer at a time. |
| B. MySQL in Docker on the owner's Mac | `docker run mysql:8` next to the indexer. | Local only. The Mac has ~13 GB free disk. |
| C. MySQL on the master node (Hetzner) | Next to Snapchain on the same box. | 16 GB RAM is shared with Snapchain. MySQL needs ~1–2 GB. Risk to the node's stability. |

Why A: it is the smallest version that works, it uses the existing infrastructure, and the deadline is 2026-10-24. The schema above is written for MySQL so nothing has to be redesigned to switch.

## Decided (owner, 2026-10-22)

1. **Option A:** SQLite, in the indexer's existing file, behind `indexer/src/archive.mjs`. The tables above are created with SQLite types; switching to MySQL later only changes that module.
2. **FIDs:** only this client's own FID (the one registered with `./fatline identity`). `fl_fids` starts with that one row.
