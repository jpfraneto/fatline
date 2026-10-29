# Fatliner PFP prompt template, version 8

Versions 1–7: see `pfp-7.prompt.md` and before.

Version 8 (2026-10-29). The owner: "create a master sprite / skeleton based on how aster looks, and then have all the subsequent Fatlines come out from that same family of beings". Two references, attached in this order:
- Reference image 1: the family sheet (`fatliners/assets/FATLINE_FAMILY_SHEET.png`, `family-sheet/1`), the master sprite made from Aster by `fatliners/bin/family.mjs`: the same being from five angles in plain base stone. It fixes the skeleton: head, face, forehead line, body.
- Reference image 2: Aster (`fatliners/assets/FATLINE_ASTER.png`, `aster/1`), the first Fatliner: how a member is photographed.
- The seeded head shape of v7 is gone: every member shares one skeleton. What varies is what the history gives: material (Roots), eyes (Voice), the forehead line and its lights (Pulse, Orbit), what grows on the head (Bloom), one prop (temperament), and a seeded pose and setting.

Send only the body between the markers.

---

<!-- FATLINER_PFP_PROMPT_BEGIN -->

One new member of the Fatliner family: a single collectible stone figurine, photographed as a real miniature.

Reference image 1 is the family's master sheet. Build this being on exactly that body: the same huge, smooth, slightly egg-shaped round head about twice as wide as the body, no nose, no ears, no hair; two small round glossy dark eyes set low and wide apart; a tiny soft mouth; one thin line across the forehead ending at the temple in a small round light; the same small, soft, chubby body with short round arms, mitten hands without fingers, short round legs and round feet. Keep these proportions exactly.

Reference image 2 is Aster, the first of the family. Photograph this one the way Aster is photographed: the same warm golden-hour light, the same tilt-shift miniature depth of field, the same polished hand-made stone finish, the same cosy, quietly magical mood. Do not copy Aster's flowers, pose or setting.

What makes this one itself (FID {{FID}}):
- Made of {{FIG_MATERIAL}}.
- Eyes: {{FIG_EYES}}.
- Across its forehead: {{FIG_LINE}}. Pale white light only: no blue and no pink anywhere on the figure.
- On its head: {{FIG_CROWN}}.
- With it: {{FIG_PROP}}.
- Pose: {{FIG_POSE}}; the whole small figure visible, centred, filling most of the frame.
- Behind it, softly blurred: {{FIG_SETTING}}.

Square 1:1. Only this one figurine: not a sheet, not several views. No text, numbers, labels or logos anywhere.

<!-- FATLINER_PFP_PROMPT_END -->

---

## Compiler variables

- `FID`: validated positive integer; never drawn.
- `FIG_*`: from `traits.figurine` (traits v7). `FIG_HEAD` is not used: the head is the family's.
