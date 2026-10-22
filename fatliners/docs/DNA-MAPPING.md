# From Farcaster history to visual DNA

```
FID ─▶ history snapshot ─▶ features (5 dimensions) ─▶ commitment ─▶ seed ─▶ DNA ─▶ SVG + Memory Atlas
       src/history.mjs      src/features.mjs          history.mjs   dna.mjs  dna.mjs  render.mjs / atlas.mjs
```

Every step is a pure function. The same snapshot gives byte-identical output in Node and in Chrome (`bin/cross-engine.mjs` checks all 36 synthetic beings). Versions: `fatliners.history/1`, `fatliners.features/1`, `fatliners.dna/1`, `fatliners.render/1`. A minted being keeps the versions it was born with. Changing a rule means a new version, never a silent change. Golden hashes in `test/determinism.test.mjs` catch accidental changes.

## 1. The history snapshot (input)

Network-agnostic and text-free. Built by `src/sources/archive.mjs` from the Fatline archive, or by `src/sources/synthetic.mjs` for fixtures.

| Field | From the indexer (`fl_messages`) | Notes |
| --- | --- | --- |
| `hash` | `dedup_key` | Same hash on both networks = same message. Merged by hash, and `networks` keeps both. |
| `networks` | `network` | Provenance. We never assume both networks hold the same history. |
| `kind` | `msg_type` (+ `body.parent` for replies) | cast, reply, reaction, link |
| `ts` | `protocol_ts` (ms) | |
| `channel` | `body.parentUrl`, **hashed** (sha256) | Channel names never reach the Atlas. |
| `parentFid` | `body.parent.fid` | Replies only. Used for shape (bonds, spread), never published. |
| `targetFid` | `body.target.fid` / `body.targetFid` | Reactions and links. |
| `embeds`, `media` | `body.embeds` (count; media = image/video URL patterns) | |
| `textLen`, `long`, `mentions` | `body.text` **length only**, `body.long`, `body.mentions` count | The text is dropped inside the reader. |
| `registeredAt` | **not in the archive today.** Onchain `ID_REGISTER` (`/v1/onChainEventsByFid?...&event_type=EVENT_TYPE_ID_REGISTER`) | Passed in by hand (`--registered-at`). Without it, age is a lower bound. |

Rules agreed with the archive owner: `status = 'merged'` only (a deleted cast stays deleted here too), distinct `dedup_key`, read-only SQLite, never `fl_sources.node_url`.

## 2. The five dimensions

Everything is a **ratio, a shape or a bucket**, never a raw volume. The table lists each feature, its definition and the trait it picks.

### Roots: existing through time → material, growth rings
| Feature | Definition |
| --- | --- |
| `ageDays` | snapshot − registration (or − oldest message) |
| `continuity` | share of 30-day months with any activity |
| `returns` | silences ≥ 90 days **and** ≥ 6× the person's own median gap, followed by activity |
| `longestSilenceDays` | Atlas only |

Material: any return → **kintsugi** (one gold seam per return, up to 3). Age < 120 days → **dew**. Continuity ≥ 0.75 and age ≥ 2 years → **stone**. Continuity < 0.35 and age ≥ 1 year → **moss**. Otherwise → **clay**. Growth rings: 1–5 by age band (thin lines on the belly, not ornament).

### Orbit: connecting with others → orbit form
| Feature | Definition |
| --- | --- |
| `replyShare` | replies / (casts + replies) |
| `bonds` | share of replies to others that go to their 3 most-answered people (needs ≥ 8 replies) |
| `circle` | effective number of people their replies spread over (exp of entropy) |
| `spread` | evenness of that spread, 0..1 (needs ≥ 8 people) |
| `breadth` | log bucket of distinct people touched. **Owner Atlas only; drives no trait** (it grows with volume) |

Form: replyShare < 0.12 → **halo**. bonds ≥ 0.5 → **binary** (circle ≤ 3) or **constellation**. spread ≥ 0.85 → **ring**. Otherwise → **moon**.
*Reciprocity* (do they answer back?) needs the other side's replies. A per-FID archive doesn't hold those, so it's left out until the indexer can serve it.

### Voice: how they express themselves → colours, finish, face
| Feature | Definition |
| --- | --- |
| `listening` | reactions / (reactions + posts) |
| `mediaShare`, `linkShare` | posts with image/video, posts with other links |
| `length` | mean text length / 320 |
| `longShare`, `mentionShare` | posts that are long casts, posts that mention someone |

Temperament is the highest of four scores, if it reaches 1: listener (listening/0.7), visual (media/0.35), storyteller (max(length/0.45, long/0.1)), linker (links/0.35). If none reaches 1 → balanced. No history → unwritten.
Temperament → colour harmony (echo, kin, counter, split, triad) and mouth (dot, smile, o, cat). Translucency = 0.12 + 0.55 × listening (the glow inside the head). Finish by length: matte, satin, gloss, pearl. Eyes: wide (replyShare > 0.6), soft lids (listening > 0.75), star catchlight (media > 0.35), round. Blush: mentions > 0.25.

### Pulse: when they appear → **the line**
- 48 bins over the whole life (registration → snapshot). Count per bin, square-rooted, divided by its own maximum, lightly smoothed.
- Drawn curve: centred on its own mean and stretched until its largest swing fills the line. Gain is capped at 2.5, so a metronome stays a calm, straight line and isn't turned into amplified noise.
- Style: burstiness (weekly (σ−μ)/(σ+μ)) > 0.35 → **spike** (straight segments). < −0.1 → **steady** (24 smooth points). Otherwise → **wave**.
- The node sits at the bin with the most activity. Glow strength follows the share of active weeks.
- No messages at all → an "unwritten" calm sine from the seed.

### Bloom: what they cultivate → the sprout on the head
| Feature | Definition |
| --- | --- |
| `channels` | distinct (hashed) channels posted in |
| `evenness` | normalized entropy of posts across channels |
| `rootedShare` | share of posts made in a channel |
| `makerShare` | = mediaShare |

Form: maker ≥ 0.35 → **blossom**. No channel or rooted < 5% → **seed**. ≤ 2 channels or evenness < 0.35 → **bud**. ≥ 7 channels and evenness ≥ 0.6 → **fern**. Otherwise → **sprout**.
No topics, no keywords, no reading of text. Interests stay structural (where and how they post), never what they're about.

## 3. Seed and commitment

- `commitment = sha256(canonical({schema, subject, snapshotAt, registeredAt, networks: {farcaster: {count, root}, hypersnap: …}}))`. `root` = sha256 of that network's sorted message hashes.
- `seed = sha256(canonical({dna: 'fatliners.dna/1', subject, commitment}))`.
- Each part of the renderer draws from its own labelled stream (`prng(seed, 'orbit')` etc.), so adding a random draw in one place never shifts another.
- **Only the skin glaze comes from the seed alone.** This keeps two near-identical quiet histories from becoming twins.

## 4. Fairness: volume doesn't buy beauty

Tested in `test/fairness.test.mjs`:
- Across the 36 synthetic beings, the number of drawn marks vs log(message count): **r = −0.00** (must stay |r| < 0.35).
- Quiet beings average 55.7 marks against 59.4 for loud ones (must be ≥ 85%).
- The same habits at 1/10 the volume give the same temperament, bloom and finish.
- The silent and the newcomer are complete beings: line, node, eyes and bloom.

Design choices behind it:
- Forms are chosen from short lists, and each costs about the same to draw. A halo gets glints, and a moon gets a wake, to match a ring's dust.
- Satellites are capped at 3.
- `breadth` (people touched) drives nothing.
- No follower counts, likes received, or wealth are ever read.

## 5. Not calibrated yet

The thresholds were set by eye on synthetic profiles. Synthetic reply partners are chosen uniformly, so **ring** is over-represented (16/36). Real distributions are more skewed. Before minting:
1. Run `features.mjs` over a sample of real FIDs (needs the indexer to track more than one FID).
2. Set thresholds so each form has a healthy share (roughly 10–35%), then bump `fatliners.dna/2`.
3. Re-check the fairness tests on real data.
