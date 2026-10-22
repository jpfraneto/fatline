# The Fatline ranking

Who can mint a Fatliner, and when. One deterministic list of Farcaster accounts, computed from our own nodes.

| Day | Who can mint |
|---|---|
| 1 | ranks 1–777 |
| 2 | ranks 1–7,777 |
| 3 | ranks 1–77,777 |
| 4 on | everyone ranked |

**The score** follows FIP "Proof of Work Tokenization" §6, §8 and §10 (github.com/orgs/farcasterorg/discussions/19), the rules behind Hypersnap's $SNAP retro rewards, kept simple:

```
score       = credibility × growth                       (eligible accounts only)
growth(f)   = Σ ln(1 + f→u + u→f) · credibility(u)       over credible accounts u that f talks with both ways
credibility = 0.25 age + 0.35 trust + 0.20 contact variety + 0.10 app variety
trust       = EigenTrust over follows, seeded by FIDs ≤ 50,000
```

Interactions are replies, mentions, likes, recasts and follows, counted only after both accounts' last change of owner. Eligible: not an app (fewer than 100 accounts gave it app keys), has cast, and at least 3 others interacted with it.

**Both networks, averaged.** The score is computed separately from our Snapchain node and our Hypersnap node. Each account's score becomes a share of that network's total, the two shares are averaged, and the list is ranked by the average. Ties go to the lower FID.

## Run it

```sh
# 1. On each node's server (hours; resumable, 10,000 FIDs per chunk):
node ranking/extract.mjs http://localhost:3381 /data/rank/snapchain
node ranking/extract.mjs http://localhost:4381 /data/rank/hypersnap
# 2. Score and merge (needs the duckdb CLI and jq):
ranking/run.sh /data/rank/snapchain /data/rank/hypersnap ranking.tsv
```

`ranking.tsv`: `rank, fid, tier, avg_share, snapchain, hypersnap`.

## Limits

- The extract reads the node's current state over its HTTP API, not the state at one block. The heights at the start are recorded in `meta.json`; to check our list, rerun step 2 on our published extract files.
- Simplified from the FIP: the data-derived eligibility filters (F3–F6) and stake are left out, and gasless app keys don't count toward app variety.
- Hypersnap's own reference code for this calculation isn't published, so our numbers are ours, not a copy of theirs.
