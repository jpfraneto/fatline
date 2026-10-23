# Master prompt: implement reference-conditioned Fatliner PFP generation

Implement this in the existing `jpfraneto/fatline` monorepo.

**The product is an image-generation pipeline: any chosen FID → real history from our running nodes → visual traits → a specific PFP prompt → that prompt plus the attached master reference image → a Fatliner portrait generated with `gpt-image-2`.**

The owner has approved the species blueprint `FATLINERS_MASTER_REFERENCE.png`. It is the visual authority for the race. Build around that image and the existing feature extraction. The deliverable is a reusable prompt-generation path, ready to generate individual PFPs.

The nodes and archive are already running. Reuse them. Do not provision, reboot, replace snapshots, or rebuild their databases. This task does not require GLB files, a mesh, a rig, Blender, a 3D viewer, or a new rendering engine. Sculptural depth belongs in the generated illustration.

## 1. Read the current implementation

Read `AGENTS.md` and its required context. Inspect local changes and preserve other people's unpushed work. Then inspect:

- `fatliners/GENERATOR.md`, `fatliners/README.md`, and `fatliners/docs/`.
- `fatliners/src/history.mjs`, `features.mjs`, `dna.mjs`, `index.mjs`, and `sources/archive.mjs`.
- `indexer/src/archive.mjs`, `config.mjs`, and `adapters/`.
- The `fatline` CLI, actual local configuration, and existing previews/tests.
- Current ranking/claim interfaces where relevant, without expanding this task into ranking or contract development.

Remote reference reviewed: `148e7288fb2637b65222cbf504e0221d2a24712a`. The local tree may be newer; do not reset it.

Preserve the current deterministic SVG renderer and existing generator interfaces. Add the reference-conditioned PFP path alongside them. Do not silently reinterpret old minted artifacts.

## 2. Resolve and validate the master reference

Use a canonical repository location:

`fatliners/assets/FATLINERS_MASTER_REFERENCE.png`

Support an explicit `--reference` override. If there is no override, check the canonical location, then the exact filename at the repository root. Resolve paths relative to the checkout, not the process's current directory. Avoid searching arbitrary directories.

The image provided with this handoff must be copied unchanged to the canonical location. If both default locations contain different images, report the ambiguity instead of choosing silently.

Before emitting a ready request:

1. Verify the selected file exists, is a readable PNG, and has valid nonzero dimensions.
2. Compute its SHA-256 from its actual bytes.
3. Record its repository-relative path, hash, dimensions, and reference version in the job manifest.
4. In the development context, inspect the image and document the species rules. Do not pretend a missing image was inspected.

If the reference is missing or invalid, the prompt/image-request stage must fail clearly with the expected path. Independent history extraction can still finish. Never silently substitute another species or emit a reference-free request marked ready.

**A filename mentioned in text is not an image attachment.** The later model request must include the actual image bytes or a supported image input. Keep the provider-specific attachment code separate from the local request manifest.

The reference hash participates in prompt cache identity. Replacing the reference creates a new explicit reference version; it must not overwrite an existing accepted portrait.

## 3. Allow any FID

Provide `--fid <positive-safe-integer>`. Prompt generation must not be gated by the top 777, mint eligibility, rank availability, coin launch, or an operating personal node.

The collection still has 777 slots and one genesis per FID. Those are minting rules. An arbitrary FID may generate a preview or prompt without minting or consuming a slot.

Use FID 18350 (@anky) for the first real-data smoke run, but implement no special-case traits or privileged behavior for it.

Discover our actual configured source endpoints and archive paths. Prefer the existing local archive reader. If the selected FID is missing or incomplete, use the existing adapter for a targeted, paginated backfill against our running source node. Bound concurrency and checkpoint progress. Do not scan the entire network.

Pin one source per network for a snapshot. No silent fallback to hosted services, unrelated public nodes, or synthetic data. Support an explicit single-network result if the other source is unavailable.

Record snapshot cutoff, available watermarks, coverage, counts, provenance and failures. A time cutoff is not an atomic cross-network snapshot, and a commitment does not prove complete history.

For a valid FID with sparse history, produce an equally considered neutral variation and state the uncertainty. Distinguish account-not-found, unavailable source, untracked account, and known account with no observed messages.

## 4. Derive the individual from the existing history features

Reuse the canonical history, commitment, feature extraction and DNA modules. Keep the current text-free boundary. Do not send raw casts, private URLs, counterparties, credentials or the archive to the image model.

Implement a versioned adapter from the current five dimensions to explicit visual instructions:

| Dimension | Evidence already available | PFP expression |
| --- | --- | --- |
| Roots | known account age, observed continuity, sufficiently supported gaps | mineral substrate, surface age, patina, restrained repairs |
| Orbit | reply share and distribution, concentration of conversation | topology of branch junctions, integrated arcs or small satellites |
| Voice | reaction/post ratios, media/link/length patterns | almond-eye expression, material finish, subtle accent palette |
| Pulse | normalized temporal curve and burstiness | flowing, steady or concentrated rhythms in the luminous paths |
| Bloom | channel distribution and media patterns | small rooted growth, bud, fern or flower variations |

Document thresholds and units. Preserve the fairness rule: volume does not buy beauty. Seeded tie-breaks may distinguish similar histories; FID digits must not become invented personal meaning.

The current DNA renderer has legacy shapes and palette rules. Translate those to the new species rather than changing historical outputs. A legacy “round” eye must still become a variation of this species' almond eyes. Skin glaze/harmony must never reassign the network colors.

Coverage gaps and pruning can resemble inactivity. Do not infer abandonment, returning from hardship, or psychological qualities from missing data. A “return” trait needs coverage sufficient to support it. Keep lore fictional and trace each visual decision to evidence or an explicitly labelled seeded choice.

Missing rank is `unknown`. Do not invent rarity, founder roles, contributions, occupation, beliefs, or a person's biography. Reviewed contributor honors are a separate input.

## 5. Preserve the species; individualize the portrait

The attached master reference defines:

- Oversized rounded mineral/pebble head, small chin, compact body.
- Deep reflective almond eyes, minimal nose and mouth.
- Organic porous/mineral skin, with controlled clay, basalt, moss, gold-repair or translucent variations.
- One serpentine forehead light-path connected to a bright round temple node.
- An integrated branching life-force system extending through the head, neck, shoulders and body.

**Snapchain is blue. Hypersnap is pink.** Dual-network paths can intertwine while retaining both colors.

Store network observation separately from verified node operation. Historical messages observed on both networks do not prove the owner operates two nodes. Distinguish observed-on-both from exclusively observed activity; shared fork history must not be double-counted as independent engagement. Describe colors as historical affinity unless actual deployment/activity evidence exists.

The master sheet is Renaissance anatomical research. The final output is **one original, polished PFP of one individual**. Preserve the anatomy and signature; do not reproduce parchment, construction geometry, labels, turnaround panels or trait swatches.

Default art direction: square, closely framed head and shoulders, slight three-quarter pose, eyes and forehead signature readable at avatar size, tactile mineral surface, soft dimensional light, controlled dark/quiet background. Include visible neck/shoulder branching. The individual should feel present, tender, strange and alive. Accessories/growth must not obscure the species signature.

Optional fuller-body/sticker outputs can reuse the same identity later. They are not prerequisites for the PFP.

## 6. Build a deterministic prompt compiler

Implement one canonical prompt compiler, for example:

`buildPfpPrompt({ identity, features, visualTraits, networkEvidence, coverage, reference })`

The exact module names should fit the codebase. Separate reference resolution and archive I/O from pure prompt composition.

Use a versioned prompt template such as `fatliners/prompts/pfp.prompt.md`. The accompanying `fatliner-pfp-prompt-template.md` provides the intended wording. Extract only its body between `FATLINER_PFP_PROMPT_BEGIN` and `FATLINER_PFP_PROMPT_END`; exclude the markers and documentation. Fill it from actual extracted values and the visual adapter.

Prompt composition must be stable for the same canonical input, explicit versions and reference hash. Validate every field and reject unresolved placeholders. Do not treat arbitrary profile fields or retrieved text as instructions.

Write:

- `traits.json`: visual choices and their evidence/seeded explanations.
- `blueprint.json`: the individual's fixed identity and selected visual directions.
- `pfp.prompt.txt`: the complete natural-language prompt, immediately usable with the attached reference.
- `pfp.request.json`: a local provider-neutral manifest identifying `gpt-image-2`, prompt hash, reference path/hash, snapshot commitment, versions and output expectations.
- A private provenance manifest, separated from public metadata.

Make clear that `pfp.request.json` is our local contract, not an invented copy of OpenAI's HTTP request schema. If implementing the live adapter, verify current official documentation and use the actual supported image-input mechanism.

The default command prepares the request without making a paid generation call. Do not require an API key to extract features or write the prompt.

## 7. Cache, generation and metadata

Use an identity containing FID, evidence commitment, trait-mapping version, prompt version, and reference hash. Stage work so reference checks, extraction and prompt generation can resume independently.

AI pixels are not guaranteed byte-identical across repeated calls. Persist and hash the accepted response and portrait; reuse them rather than silently regenerating. An explicit revision produces a new version.

For the optional image-generation stage, use `gpt-image-2` and attach this reference image. Isolate that call behind an adapter. Do not silently switch models, drop the attachment, or label test output as a live generation. Follow the repository's rules for paid calls.

After a successful approved generation, save `portrait.png` and standard NFT metadata with `name`, `description`, `image`, and `attributes`. Add a versioned `fatliner` namespace linking the FID, snapshot commitment, traits, prompt/reference hashes, generation versions and asset hash. Include only real resolvable URLs when available. Omit `animation_url` when there is no animation.

The name, lore and image must agree with the same blueprint. A generated image is not proof of minting, funding, uptime or an active node.

Keep the existing `generate(input.json) → { name, image, traits }` interface compatible. A prepared prompt may have a separate status; do not report an image as generated before one exists.

## 8. CLI and preview

Integrate a single prompt-generation command with the existing CLI, supporting the equivalent of:

```sh
fatline fatliners prompt --fid 18350
fatline fatliners prompt --fid 12345 --reference fatliners/assets/FATLINERS_MASTER_REFERENCE.png
```

Also accept an exported generator input JSON so the collaborator can compile a prompt offline without node access. Document the real working commands rather than leaving these as pseudocode.

Extend the existing preview to select any FID and inspect its reference thumbnail, coverage, traits, resulting prompt, prepared status and accepted portrait when present. A copy-prompt action should remind the user to attach the reference too.

Do not redesign the launchpad, change mint eligibility, launch coins, deploy contracts, publish social posts or provision nodes.

## 9. Validation and handoff

Test the important boundaries:

- Reference missing/corrupt/ambiguous; explicit override; path resolution independent of current directory.
- Changed reference bytes invalidate the prompt cache.
- Any valid FID works independently of rank; sparse and unavailable histories remain distinct.
- Stable prompts from identical canonical inputs; no unresolved variables.
- Correct network colors and no fabricated operating-node claims.
- No raw history text, counterparties or secret endpoints leak into public prompts.
- Request marked ready only when its verified reference is present.
- Cached accepted portraits survive retries and revisions preserve earlier output.

Run relevant existing checks. Complete a real-history prompt run for FID 18350 if the configured source is reachable. Report exactly what ran and what remains unavailable. Do not use synthetic traits as its actual history.

Update `GENERATOR.md`, relevant species/DNA documentation, and the README. Explain the stable prompt/accepted-image distinction and the reference-conditioned workflow.

Finish with the exact command and paths for the real example's reference, traits, complete PFP prompt and request manifest. If image generation was not executed, say so.

**Success: I can choose any FID, obtain a complete prompt derived from its available real history, and pass that prompt together with `FATLINERS_MASTER_REFERENCE.png` to `gpt-image-2` to create that specific Fatliner.**

