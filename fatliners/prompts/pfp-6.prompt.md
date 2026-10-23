# Fatliner PFP prompt template, version 6

Versions 1–5: see `pfp-5.prompt.md` (fixed collection style and framing, eyes near-black, mouth a seam, five bold differences first, seeded pose).

Version 6 (the owner on round 5, 2026-10-23: "they all look so similar. there is no organic feel to them", and the network colours "should be an emergent property that is like life force or electricity that runs as they do the work of sustaining the network"):
- The portrait shows the being AT REST. The forehead path, temple node and branches are living anatomy (raised veins, a closed pearl-like organ), the colour of the skin, unlit. No blue, no pink, no glow. The network light belongs to a running node and is drawn later by a live layer, never painted in.
- Living creatures, not statues: each substance is a living skin with the colour and grain of a stone; age shows as creases and folds; the body breathes.
- The reference sets which features the species has, not one set of proportions: each individual gets its own face (eye placement, cheeks, chin, brow) and build from the identity section.
- Follows fatliners/SPECIES-CANON.md v1.0 with the owner's amendment of 2026-10-23 (§3, Signal System).

Send only the body between the markers.

---

<!-- FATLINER_PFP_PROMPT_BEGIN -->

Create exactly one original profile-picture illustration of the Fatliner associated with Farcaster FID {{FID}}.

REFERENCE IMAGE 1 — SPECIES AUTHORITY

Use the attached FATLINERS_MASTER_REFERENCE.png as the reference for which features this species has. Keep this being recognizably a member of that race. The reference is a diagram of the species, not a template: do not copy its exact proportions or its one face. Two important differences from the reference: this portrait has NO glowing lines and NO blue or pink colour (see AT REST below), and this being is a living, breathing creature, not a sculpture.

Do not reproduce the reference sheet itself. Do not reproduce its parchment, title, labels, calligraphy, construction circles, diagram panels, swatches or multiple views.

SHARED SPECIES ANATOMY

An oversized, rounded head with organic asymmetry, roughly as big as the rest of the visible body; a compact body. Large dark almond eyes, almost no nose, no ears, a subtle mouth. The skin is alive: soft, warm, breathing tissue with the colour, grain and pores of a mineral, the way a frog or a newborn animal has its own skin. Not a statue, not a carving, not a ceramic figurine.

Every Fatliner has a forehead path: a raised vein that runs across the brow and ends at the temple node, a round, closed, pearl-like organ in the skin, like a sleeping eye. From there finer veins run down the temples, neck, collarbones and shoulders, like roots or nerves under the skin. They grow within the body; they are not a headband, headset or armour.

The eyes are deep and near-black, wet and alive, with one small highlight; no colour fills the irises. The mouth is only a tiny soft seam, never lips.

AT REST

{{NETWORK_DIRECTIVE}}

Paint the veins and temple node with shape and shadow only, like veins on the back of a hand or the ribs of a leaf: raised, soft, a little darker or paler than the skin around them. Nothing in the image glows. No neon, no electricity, no sparks, no luminous colour anywhere on the being.

WHAT MAKES THIS ONE UNMISTAKABLE

The 777 Fatliners are one species, but no two may look alike, even as 64 px thumbnails side by side. They differ the way individual dogs or people do. Make these differences bold and obvious, not subtle; they matter more than any small detail:
1. The face itself: its eye placement, cheeks, chin and brow (identity below). Never the reference's face.
2. The head shape, the body's build and the pose (identity below).
3. The skin of the whole being (Roots below): its colour and texture cover the head and body.
4. The eyes (Voice below): size, lids and tilt.
5. The shape of the forehead vein (Pulse below) and the vein pattern on the crown (Orbit below).

INDIVIDUAL IDENTITY AND TRAITS

{{IDENTITY_DIRECTIVE}}

Roots — the living skin, its age and any healed scars:
{{ROOTS_DIRECTIVE}}

Orbit — the vein pattern over the crown:
{{ORBIT_DIRECTIVE}}

Voice — the eyes, the mouth and the skin's finish:
{{VOICE_DIRECTIVE}}

Pulse — the shape of the forehead vein and the body's veins:
{{PULSE_DIRECTIVE}}

Bloom — organic growth or its deliberate absence:
{{BLOOM_DIRECTIVE}}

COVERAGE AND ARTISTIC INTERPRETATION

{{COVERAGE_DIRECTIVE}}

The supplied traits are an artistic translation of observed activity patterns, not a psychological diagnosis or a literal biography. Do not add an occupation, ideology, trauma, founder status or achievement that has not been explicitly supplied. A sparse history deserves an equally beautiful, coherent individual.

{{OPTIONAL_HONOR_DIRECTIVE}}

COLLECTION STYLE (identical for every Fatliner)

A hand-painted character portrait, as by one painter for all 777: soft gouache and oil-like brushwork, gentle modelling, visible but fine paint texture, natural colour. A soft, warm key light from the upper left with gentle shadow on the right of the face. Not a 3D render, not CGI, not photographic: no lens bokeh, no depth-of-field blur, no lens flare, no particles, no glossy plastic sheen.

Framing: square 1:1, head and shoulders, the head filling about 60% of the width, the top of the head a little below the top edge, shoulders and upper chest cut by the bottom edge. The pose is the one given in the identity section. The eye expression must read even at avatar size, and the face silhouette and forehead vein must read at a 64 px crop.

Background: one flat, solid, matte colour as specified in the identity section, muted and mid-dark, with at most a very faint vignette. No scenery, no haze, no patterns, no ground, no frame.

The character feels tender, strange, individual and present: a living creature at rest, carrying the traces of its history, its life force sleeping in its veins.

OUTPUT

Exactly one polished original Fatliner PFP. No text, numbers, ticker, FID, watermark, logos, chart, frame, split screen, turnaround sheet, separate floating trait samples, human face, animal ears, robot armour or unrelated mascot. No glowing lines and no blue or pink light. Do not copy a specific individual's appearance from the reference: instantiate this shared species using the traits above.

<!-- FATLINER_PFP_PROMPT_END -->

---

## Compiler variables

As in version 5. `NETWORK_DIRECTIVE` is now the fixed at-rest text; the network colours a running node will show are in `traits.network.live` and are not sent to the image model.
