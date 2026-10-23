# Fatliner PFP prompt template, version 7

Versions 1–6: see `pfp-6.prompt.md` and `pfp-5.prompt.md`.

Version 7 (2026-10-23). The owner rejected the painted busts ("not playful enough … they are like weird") and four cartoon styles, and pointed at their own image "Sunset Gathering in the Cloud Ruins" instead:
- Reference image 1 is now that image (`fatliners/assets/FATLINERS_STYLE_REFERENCE.png`, `style-cloud-ruins/1`), used for STYLE: tiny collectible figurines with a huge round head on a small soft body, calm sweet faces, handmade materials, warm golden-hour light, tilt-shift miniature photography. The species blueprint is no longer attached: it pulled every image back to one solemn face.
- The prompt is short and leads with the look. The traits come as `figurine` (traits v7): material, head, eyes, the forehead line, crown growth, one prop from the Voice temperament, a seeded pose and setting.
- The forehead line glows pale white at rest. Blue (Snapchain) and pink (Hypersnap) are for a running node, never painted in.

Send only the body between the markers.

---

<!-- FATLINER_PFP_PROMPT_BEGIN -->

One single collectible Fatliner figurine, photographed as a miniature, in exactly the style of the beings in the attached image: the same tiny designer-toy proportions (a huge round head on a small, soft body), the same simple, calm, sweet faces (small dark eyes, almost no nose, a tiny mouth or none), the same handmade materials, cinematic warm golden light and shallow tilt-shift depth of field. Playful, cosy, a little magical.

This Fatliner (FID {{FID}}):
- Made of {{FIG_MATERIAL}}.
- Head: {{FIG_HEAD}}.
- Eyes: {{FIG_EYES}}.
- Across its forehead: {{FIG_LINE}}. Pale white light only: no blue and no pink anywhere on the figure.
- On its head: {{FIG_CROWN}}.
- With it: {{FIG_PROP}}.
- Pose: {{FIG_POSE}}; the whole small figure visible, centred, filling most of the frame.
- Behind it, softly blurred: {{FIG_SETTING}}.

Square 1:1. Only this one figurine. Do not copy the attached image's composition, banners, logos, letters, hats or other characters. No text, numbers or logos anywhere.

<!-- FATLINER_PFP_PROMPT_END -->

---

## Compiler variables

- `FID`: validated positive integer; never drawn.
- `FIG_*`: from `traits.figurine` (traits v7). Pose and setting are seeded; the rest come from the five dimensions.
