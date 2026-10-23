# Fatliner PFP prompt template

This is a compiler template. Send only the body between the BEGIN and END markers, after replacing its uppercase template slots with validated pipeline output. Do not invent trait values. Attach the actual `FATLINERS_MASTER_REFERENCE.png` as reference image 1; mentioning the filename in the prompt does not attach it.

Model selection: `gpt-image-2`. This document defines prompt content, not an HTTP API payload.

---

<!-- FATLINER_PFP_PROMPT_BEGIN -->

Create exactly one original profile-picture illustration of the Fatliner associated with Farcaster FID {{FID}}.

REFERENCE IMAGE 1 — SPECIES AUTHORITY

Use the attached FATLINERS_MASTER_REFERENCE.png as the canonical species and anatomical reference. Keep this being recognizably a member of that race. The reference's different views depict one consistent anatomy; its bottom studies describe permitted variations. Select and combine only the individual traits specified below.

Do not reproduce the reference sheet itself. Do not reproduce its parchment, title, labels, calligraphy, construction circles, diagram panels, swatches or multiple views.

SHARED SPECIES ANATOMY

An oversized, softly asymmetric rounded pebble/mineral head, widest around the upper cheeks, tapering into a little chin; compact body and short neck. Deep reflective dark almond eyes with a thoughtful, expressive gaze, almost no nose, and a subtle mouth. Organic, tactile mineral skin with fine natural pores and flecks.

Preserve the species' defining serpentine luminous path across the forehead, joining a distinct round temple light. It grows within the skin; it is not a headband, headset or piece of armor.

Carry delicate branching life-force paths through the temples, neck, collarbone, shoulders and visible upper chest. They should resemble living rivers, roots or nerves beneath mineral skin. Integrate them into the anatomy. Their topology contributes to this individual's identity.

INDIVIDUAL IDENTITY AND TRAITS

{{IDENTITY_DIRECTIVE}}

Roots — substrate, patina, age texture and any justified repairs:
{{ROOTS_DIRECTIVE}}

Orbit — relational branching, junctions and any restrained integrated orbital detail:
{{ORBIT_DIRECTIVE}}

Voice — almond-eye expression, finish and supporting accent palette:
{{VOICE_DIRECTIVE}}

Pulse — the shape and rhythm of the luminous pathways:
{{PULSE_DIRECTIVE}}

Bloom — controlled organic growth or its deliberate absence:
{{BLOOM_DIRECTIVE}}

NETWORK EXPRESSION

{{NETWORK_DIRECTIVE}}

Maintain the fixed color semantics wherever those channels appear: Snapchain is blue; Hypersnap is pink. Where both are specified, let the two networks intertwine organically while remaining distinguishable. Surface materials and background accents must not swap those meanings.

COVERAGE AND ARTISTIC INTERPRETATION

{{COVERAGE_DIRECTIVE}}

The supplied traits are an artistic translation of observed activity patterns, not a psychological diagnosis or a literal biography. Do not add an occupation, ideology, trauma, founder status or achievement that has not been explicitly supplied. A sparse history deserves an equally beautiful, coherent individual.

{{OPTIONAL_HONOR_DIRECTIVE}}

PORTRAIT COMPOSITION AND FINISH

Make a single square 1024×1024 PFP: one character, closely framed head and shoulders with enough upper chest to read the branching system. A gentle three-quarter pose and an engaging gaze. The face, forehead path and temple node must remain immediately recognizable at a 64 px avatar crop. Leave a little breathing room so no important feature touches the frame.

Give the illustration sculptural depth, sensitive soft light, tactile material detail and a coherent art direction. A quiet, dark, softly atmospheric background supports the silhouette without competing with the face. The character feels tender, strange, individual and present. It is a still portrait of a living being, carrying the traces of its history.

Treat growth, surface texture and luminous paths as parts of one anatomy. Avoid overloading it with ornaments. Preserve clear eyes, face silhouette and forehead signature.

OUTPUT

Exactly one polished original Fatliner PFP. No text, numbers, ticker, FID, watermark, logos, chart, frame, split screen, turnaround sheet, separate floating trait samples, human face, animal ears, robot armor or unrelated mascot. Do not copy a specific individual's appearance from the reference: instantiate this shared species using the traits above.

<!-- FATLINER_PFP_PROMPT_END -->

---

## Compiler variables

- `FID`: validated positive integer; an identifier, never a visual inscription.
- `IDENTITY_DIRECTIVE`: stable name/identity cues if already accepted, plus restrained seed-derived variation. For a first portrait, state that this is a new individual.
- `ROOTS_DIRECTIVE` through `BLOOM_DIRECTIVE`: complete visual instructions from the versioned feature-to-trait adapter. Avoid raw metrics unless they materially clarify the visual.
- `NETWORK_DIRECTIVE`: specific observed-network expression and color balance, including provenance uncertainty. Do not translate missing data into a negative claim about node operation.
- `COVERAGE_DIRECTIVE`: short, evidence-aware constraints. For sparse data use neutral choices, not a claim of inactivity.
- `OPTIONAL_HONOR_DIRECTIVE`: reviewed contributor honor only, otherwise an empty string. The compiler must remove the empty slot cleanly.

Every image request must retain the snapshot commitment, reference SHA-256, trait-mapping version, prompt version and prompt hash outside the visible artwork. The same accepted identity must remain recognizable in later revisions.

