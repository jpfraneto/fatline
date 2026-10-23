# Fatliner PFP prompt template, version 2

Derived from version 1 (the owner's wording, `pfp-1.prompt.md`) after the first real generations. Changes:
- A fixed COLLECTION STYLE: one painted look for all 777 (v1 produced generic glossy CGI with bokeh).
- Fixed framing, so the beings line up as a set.
- Light under the skin is soft and thin, not neon or electric.
- Eyes stay deep and dark; accents never colour the irises.
- One flat, solid background colour per being (from the traits), instead of an atmospheric haze.

The rest of this file is as in version 1. Send only the body between the markers.

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

The light is soft and thin, like light seen through stone, as in the reference: fine coloured lines with a gentle glow. Not neon, not electric, no sparks, no lightning, no glowing particles in the air. The eyes stay deep, dark and reflective; no accent colour fills the irises.

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

COLLECTION STYLE (identical for every Fatliner)

A hand-painted character portrait in the spirit of the reference sheet, brought to full colour: soft gouache and oil-like brushwork, gentle modelling, visible but fine paint texture, warm natural light. It should feel like one painter made all 777 portraits. Not a 3D render, not CGI, not photographic: no lens bokeh, no depth-of-field blur, no lens flare, no dust particles, no glossy plastic sheen.

Framing, the same for every portrait: square 1:1, head and shoulders, the head centred and filling about 60% of the width, the top of the head a little below the top edge, shoulders and upper chest cut by the bottom edge. A gentle three-quarter turn with the eyes meeting the viewer. The face, forehead path and temple node must read clearly at a 64 px avatar crop.

Background: one flat, solid, matte colour as specified in the identity section, with at most a very faint vignette. No scenery, no haze, no patterns, no ground, no frame.

The character feels tender, strange, individual and present: a living being carrying the traces of its history. Treat growth, surface texture and luminous paths as parts of one anatomy. Avoid overloading it with ornaments. Preserve clear eyes, face silhouette and forehead signature.

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

