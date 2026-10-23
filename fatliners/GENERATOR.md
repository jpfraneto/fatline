# The Fatliner generator: the contract between us

> **Species authority:** [SPECIES-CANON.md](SPECIES-CANON.md) (v1.0) and `assets/FATLINERS_MASTER_REFERENCE.png`. What a Fatliner is, its anatomy, the five dimensions, the DNA record and the acceptance tests live there; this page is only the input/output contract.

**Who builds what.** Three people, a third each:
- **Fatline (this repo):** the nodes, the ranking of every account, the mint tiers, the contracts, the site.
- **The generator (you):** one Fatliner from one account: its image, its name, its traits.
- **The owner (@anky):** the lore and the final call on the look.

You don't need a node or anything else in this repo to do your part. You get a JSON file per account and send back a JSON file plus an image.

## Your job in one line

```
generate(input.json) → { name, image, traits }
```

Same input → same output, byte for byte, forever. Your code may use the input only: no clock, no network, no unseeded randomness. If you use randomness, seed it from `input.seed`.

## What we send you: `input.json`

One file per FID. Everything comes from our own Farcaster node (Snapchain) and our Hypersnap node, at one published block.

```json
{
  "schema": "fatliners.input/1",
  "fid": 18350,
  "username": "anky",
  "rank": 4210,
  "tier": 2,
  "seed": "0x… (sha256 of the history commitment)",
  "score": {
    "composite": 0.0123,
    "trust": 0.41,
    "ageFactor": 1.0,
    "growth": 37.2,
    "credibility": 0.66
  },
  "history": { "schema": "fatliners.history/1", "…": "see docs/DNA-MAPPING.md §1" },
  "features": { "schema": "fatliners.features/1", "…": "the five dimensions, see docs/DNA-MAPPING.md §2" }
}
```

- `rank`, `tier`, `score` come from the Fatline ranking (an average over Snapchain and Hypersnap). Tier 1 = ranks 1–777, tier 2 = up to 7,777, tier 3 = up to 77,777, tier 4 = everyone ranked.
- `history` is the account's activity without any text: kinds of messages, timestamps, who they replied to, hashed channels. The format is already defined in `docs/DNA-MAPPING.md`.
- `features` are the five dimensions the first generator computes from that history (Roots, Orbit, Voice, Pulse, Bloom). Use them, change them, or ignore them; they are a starting point, not a rule.

Sample inputs: real ones for the top accounts will be added to `fatliners/samples/` once the ranking runs. Until then, `npm run preview` in `fatliners/` shows the first generator on synthetic histories.

## What you send back

```json
{
  "schema": "fatliners.output/1",
  "fid": 18350,
  "generator": "your-generator@1.0.0",
  "name": "Aster",
  "image": "18350.png",
  "traits": [
    { "trait_type": "…", "value": "…" }
  ]
}
```

- **Image:** PNG, 1024 × 1024, transparent or dark background, the being centred. It must also read at 64 px (it will be an avatar).
- **Name:** one word, generated from the input, unique across all 777.
- **Traits:** the standard NFT format (`trait_type` / `value`). **Which traits exist is not decided yet: see "Open: the trait list" below.**

## Open: the trait list

To be filled from the owner's design conversation. For each trait we need: its name, its possible values, which data picks the value, and how rare each value should be.

The first generator (by FATLINERS-01, in `src/`) uses these, as a starting point:

| Dimension | What it reads | Trait it picks |
|---|---|---|
| Roots | age, continuity, returns after long silences | material: stone, clay, moss, dew, kintsugi; growth rings 1–5 |
| Orbit | how they reply to others | orbit form: halo, moon, binary, constellation, ring |
| Voice | listening vs posting, media, links, text length | colours, finish, face |
| Pulse | when they appear (bursty or steady) | the line: spike, wave, steady |
| Bloom | what they cultivate (channels, making) | the sprout: seed, bud, sprout, fern, blossom |

Rule kept from it: **volume doesn't buy beauty.** Traits come from ratios and shapes, never raw counts, so a quiet account can be as beautiful as a loud one. Rarity comes from the rank, not from how much someone posts.

## The reference-conditioned PFP path (built)

Beside this contract there is now a second way to make a Fatliner's image: a **prompt** compiled from the same history and DNA, sent to `gpt-image-2` **together with** the approved species blueprint (`assets/FATLINERS_MASTER_REFERENCE.png`). It works for any FID, from our own nodes, or offline from an exported file:

```sh
./fatline fatliners export --fid 18350 > 18350.input.json    # what we send you: fatliners.input/1 (+ coverage)
./fatline fatliners prompt --input 18350.input.json          # traits.json, blueprint.json, pfp.prompt.txt, pfp.request.json
```

`generate(input.json) → { name, image, traits }` still holds: `name` = `blueprint.json` name, `traits` = `traits.json` attributes, `image` = `portrait.png` **once an image was generated and accepted**. Until then the status is `prepared`, never `generated`. The prompt is deterministic; the image isn't, so the first accepted image is kept and reused. Everything: [docs/PFP.md](docs/PFP.md).

## How to plug it in

Put your generator in `fatliners/generator/` with one entry point:

```sh
node fatliners/generator/index.mjs fatliners/samples/18350.json > 18350.output.json
```

Any language is fine if it builds from this repo with one command and runs on Linux and macOS.
