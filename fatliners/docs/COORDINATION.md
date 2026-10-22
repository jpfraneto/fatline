# Coordination with the other sessions (2026-10-22)

This work was done by session **FATLINERS-01**. Its machine name is `infinicaster-c1 [fd888b]`, which clashes with the adapter session's name, so we sign as FATLINERS-01. Messages went through Claude Code cross-session messaging.

| Session | Role | What was agreed |
| --- | --- | --- |
| infinicaster-ea | coordinator | Fatliners lives in `fatliners/` only. Read-only SQLite, with short reads (the indexer writes live). Explicit `git add` of our own paths. The owner says yes before every push, mint or deploy. **Wait for "rename landed" before committing** (repo-wide Infinicaster/Farline → Fatline rename). Lore: Fatline comes from a novel; write our own lore and use none of its text or names. |
| infinicaster-28 | archive owner (schema, `indexer/src/archive.mjs`, API) | Go straight to SQLite, not `Archive.read()`. Stable columns: `fl_messages(network, dedup_key, fid, msg_type, protocol_ts ms, signer, status, first_event, last_event, body JSON)`. Use `status = 'merged'` (deleted casts stay as `displaced`). Count distinct `dedup_key`. Check bodies `{truncated:true}`. Never read `fl_sources.node_url`. A `GET /api/archive/:fid/stats` endpoint can be added on request. |
| infinicaster-c1 [abe87f] | network adapter, nodes | The backfill is what the node stores now (after pruning), so the oldest message is a lower bound for age. Registration time is reliable from `/v1/onChainEventsByFid?event_type=EVENT_TYPE_ID_REGISTER` (FID 18350: 2023-11-07), but the archive doesn't backfill onchain events yet. Hypersnap rows for 18350 are coming after their `follow` test. |

## The read-only interface (agreed)

`fatliners/src/sources/archive.mjs`:
- `readArchive(dbPath, fid, { snapshotAt, registeredAt })` → `{ history, sources }`
- Opens `.fatline/indexer.sqlite` (or `.infinicaster/…` before the rename) with `readOnly: true`.
- One SELECT on `fl_messages`, one on `fl_sources (network, label)`.
- Text is reduced to a length, and channel URLs are hashed, before anything leaves the function.

## What we did not touch
- Nodes, servers, infra.
- `indexer/`, `apps/`, `smart-contracts/` (we only read forge-std from its `lib/`).
- README, MASTER-PROMPT, STORY, AGENTS.
- No writes to the archive.

## Remaining dependencies

| Need | From | Status |
| --- | --- | --- |
| More than one tracked FID (for calibration and real testing) | 28 / owner (archive tracks only the client's own FID by decision) | open |
| Registration time per FID in the archive (onchain `ID_REGISTER`) | c1 (a backfill kind) | offered, not built |
| Hypersnap rows | c1 / ea | coming |
| Reciprocity (others' replies to this FID) | indexer: would need others' casts | not planned |
| A stats endpoint, if the browser client needs Atlas data | 28 | offered on request |
| Keeping a minted snapshot's hash list after the node prunes it | archive | not designed |
| Attester service (custody/verification check + commitment recompute) | Fatliners | not built |
| Chain, art storage, mint policy | owner | open decisions |
