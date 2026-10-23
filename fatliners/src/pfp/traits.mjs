// Five dimensions (+ networks + coverage) → visual instructions for one reference-conditioned PFP.
// Pure and deterministic. The PFP rulebook, beside dna.mjs (the SVG rulebook). It reads the SAME features,
// seed and DNA and never changes them. Changing a rule = a new TRAITS_VERSION.
//
// Version history:
//   /1  translated the DNA forms 1:1 (first real generations).
//   /2  + flat backdrop palette; accents kept out of the irises.
//   /3  thresholds CALIBRATED on real accounts (calibration/<name>.json). The DNA's absolute thresholds were
//       set on synthetic histories: on real power users every one landed on "ring" orbit, "wide" eyes and
//       "wave" pulse, so the collection looked like one being. Now each ratio is placed against the
//       quantiles of the population that will mint. The DNA forms are kept in the evidence.
//   /4  mouths are seams in the stone, never lips (round 3 drifted toward a human mouth).
//   /5  the owner: "they all look so much the same". Every dimension now changes something you can see in a
//       64 px thumbnail: Roots picks the whole stone (7 substrates from the canon, each with its own colour),
//       Pulse the SHAPE of the forehead wave (arc / S-wave / zigzag) and its thickness, Orbit the light
//       pattern over the crown, Voice the eyes (size, lids, tilt), and the seed the head shape and pose.
//       Calibrated on the real top 777 (calibration/pfp-5.json).
//   /6  the owner on round 5: "they all look so similar. there is no organic feel to them", and the network
//       colours "should be an emergent property, like life force or electricity that runs as they do the work
//       of sustaining the network". So the portrait shows the being AT REST: the forehead path, temple node
//       and branches are living anatomy (raised veins, ridges, a closed pearl organ), unlit, with no blue or
//       pink. The network colours move to `network.live`, for the light a running node will add later. The
//       beings are living creatures with mineral character, not statues: each substance is a kind of living
//       skin, age shows as folds and creases, and the seed now varies the face itself (eye placement, face,
//       build), not just the head outline.
//   /7  the owner liked neither the painted busts nor cartoons, but their image "Sunset Gathering in the Cloud
//       Ruins" (now assets/FATLINERS_STYLE_REFERENCE.png): tiny collectible figurines, golden-hour miniature
//       photos. `figurine` maps the same dimensions to that look (material, eyes, forehead line, crown, pose,
//       setting), plus one small PROP from the Voice temperament: what this being does. The forehead line glows
//       pale white at rest; blue and pink stay with `network.live`.
//
// Every trait carries `evidence` (the measured values and the thresholds that picked it) or `seeded` (picked
// from the seed only, to tell similar histories apart). FID digits never mean anything. Only ratios are
// binned, never volumes, and every form is one short instruction of similar visual weight.

import { prng } from '../prng.mjs';

export const TRAITS_VERSION = 'fatliners.pfp-traits/7';

// The ratios whose quantiles bin/pfp-calibrate.mjs measures on real accounts.
export const CALIBRATED_FEATURES = ['roots.ageDays', 'roots.continuity', 'orbit.replyShare', 'orbit.bonds', 'voice.listening', 'voice.mediaShare',
  'voice.linkShare', 'voice.length', 'voice.longShare', 'voice.mentionShare', 'pulse.burstiness', 'pulse.activeWeekShare', 'bloom.evenness', 'bloom.rootedShare'];

// Below this many posts + reactions, a history is "sparse": readings are noise, so forms are neutral (seeded).
export const SPARSE_MESSAGES = 30;
export const NEWCOMER_DAYS = 120;

// The whole being is this living substance, head and body: the first thing you see in a thumbnail. A living
// creature with mineral character, never a carving: the skin is soft, breathing tissue that has the colour and
// grain of the stone.
const SUBSTRATE = {
  ivory: { value: 'ivory stone', text: 'the whole being has warm ivory living skin with the colour and grain of a sea-worn pebble: soft, slightly translucent at the thin places, with fine pores and dark freckle-like flecks' },
  sandstone: { value: 'red sandstone', text: 'the whole being has rust, terracotta and ochre skin layered in soft bands like sandstone strata, the bands following the curves of the body the way stripes follow an animal; warm, dry and grainy' },
  marble: { value: 'white marble', text: 'the whole being has cool, pale, smooth skin like white marble, with soft grey veins running under it like blood vessels; fine and young, translucent at the ears and temples' },
  basalt: { value: 'basalt', text: 'the whole being has dark charcoal skin, dense and leathery like volcanic stone, with pale mineral freckles and a soft sheen where the light grazes it' },
  moss: { value: 'mossed stone', text: 'the whole being has grey-green weathered skin that living moss and pale lichen have grown into on the crown, shoulders and hollows, as on an old tree; the face, eyes and forehead path stay clear' },
  gold: { value: 'gold repair', text: 'the whole being has warm ivory living skin that once broke and healed with bold gold scars, like kintsugi grown by the body itself: bright gold seams clearly visible across the crown and cheek' },
  opal: { value: 'opal', text: 'the whole being has young, translucent, milky skin like opal, with soft flashes of green, violet and amber deep inside it, as on a newborn creature still forming' },
};
const PATINA = [null,
  'newly formed: smooth, soft, unmarked skin',
  'young: smooth skin with a few fine pores',
  'mature: natural pores, small marks and faint creases at the eyes',
  'old: deep creases around the eyes and mouth, folds at the neck, scattered marks and pits',
  'ancient: a long-lived, deeply creased and folded skin, rich with marks, still tender in the face',
];
// Legacy seed-only skin glaze → a muted mineral undertone. Never blue or pink: those belong to the networks.
const UNDERTONE = {
  coral: 'faint terracotta', peach: 'warm sand', apricot: 'pale ochre', butter: 'straw', pistachio: 'lichen-grey green',
  mint: 'pale celadon', seafoam: 'verdigris grey', sky: 'cool slate grey', periwinkle: 'flint grey', lilac: 'smoky quartz',
  orchid: 'umber', rose: 'iron-red sandstone',
};

// The pattern of raised veins over the crown, above the forehead path. Living anatomy, unlit. Must read at avatar size.
const ORBIT = {
  river: { value: 'single river', text: 'the crown is smooth and clear: only the one forehead vein and its temple node, nothing above it' },
  satellite: { value: 'one satellite', text: 'a second, smaller pearl-like node high on the crown, joined to the forehead vein by a single curving raised vein' },
  twin: { value: 'twin junction', text: 'two equally large pearl-like temple nodes side by side, joined by a short thick raised vein: a double temple node' },
  net: { value: 'fine net', text: 'a web of fine raised veins spreads over the whole upper cranium, like the veins on a leaf, with many small junctions' },
  constellation: { value: 'constellation', text: 'four or five small pearl-like nodules scattered over the crown, linked by fine raised veins like a constellation grown in the skin' },
};

// Eyes: size, lids and tilt differ enough to tell beings apart at a glance. Always dark almonds.
const EYES = {
  wide: { value: 'wide almond', text: 'very large, wide-open almond eyes taking up much of the face, the gaze leaning eagerly toward the viewer' },
  soft: { value: 'soft-lidded almond', text: 'half-closed, heavy-lidded almond eyes, the upper lids lowered over half of each eye: calm, sleepy, listening' },
  starlit: { value: 'starlit almond', text: 'large shining almond eyes, each with a bright four-pointed star highlight' },
  long: { value: 'long almond', text: 'long, narrow almond eyes, slightly narrowed and glancing to one side, as if in the middle of a thought' },
  alert: { value: 'alert almond', text: 'almond eyes tilted sharply upward at the outer corners, wide awake, quick and a little mischievous' },
  full: { value: 'full almond', text: 'round, soft almond eyes set a little lower and further apart, gentle and curious, like a young creature' },
};
const MOUTH = { dot: 'a tiny, barely-there mouth seam', smile: 'a mouth seam curving up very slightly, a hint of a smile', o: 'a tiny round opening of a mouth, as if about to speak', cat: 'a mouth seam with one corner curled, wry' };
const FINISH = { matte: 'matte, dry skin', satin: 'soft satin finish', gloss: 'polished, smooth finish with gentle highlights', pearl: 'pearlescent finish with a faint inner lustre' };
const TEMPERAMENT = {
  listener: { eyes: 'soft', mouth: 'dot', accent: 'pale silver' },
  visual: { eyes: 'starlit', mouth: 'smile', accent: 'bright gold' },
  storyteller: { eyes: 'long', mouth: 'o', accent: 'deep amber and old gold' },
  linker: { eyes: 'alert', mouth: 'cat', accent: 'verdigris green' },
  balanced: { eyes: null, mouth: 'smile', accent: 'warm amber' },
  unwritten: { eyes: 'full', mouth: 'dot', accent: 'soft white' },
};

// The forehead path is the being's signature: its SHAPE is the most recognisable thing about it. At rest it is
// a raised vein in the skin, the colour of the skin itself; a running node is what lights it.
const PULSE = {
  bursts: { text: 'the forehead path is a raised vein in a sharp, angular zigzag with three or four abrupt peaks, like a seismograph trace, with small knots at the turns; the veins on the neck and shoulders fork abruptly, in clusters' },
  flowing: { text: 'the forehead path is a raised vein in a big serpentine S-wave with two full, deep swells across the forehead; the veins on the neck and shoulders meander like rivers' },
  steady: { text: 'the forehead path is a raised vein in one long, calm, shallow arc, almost straight; the veins on the neck and shoulders are regular and evenly spaced, like a river delta' },
};
const THICK = { high: 'thick, prominent', mid: 'medium', low: 'fine, delicate' };

const BLOOM = {
  bare: { value: 'bare crown', text: 'no growth: a bare, clean crown (the deliberate absence is part of this individual)' },
  bud: { value: 'single bud', text: 'one small closed green bud rooted in the crown, slightly off-centre' },
  sprout: { value: 'sprout', text: 'one small sprout with two or three young leaves rooted in the crown' },
  fern: { value: 'fern and moss', text: 'a few small curled fern fronds and a little moss rooted on one side of the crown' },
  blossom: { value: 'pale blossoms', text: 'a small cluster of tiny white and cream flowers with green leaves rooted on one side of the crown' },
  crystal: { value: 'quartz crystals', text: 'a small cluster of clear and smoky quartz crystals growing from one side of the crown, like a geode breaking the surface' },
};

// Seeded identity: only makes two similar histories into two different individuals.
const POSES = [
  'turned three-quarters to the viewer\'s left, eyes on the viewer', 'turned three-quarters to the viewer\'s right, eyes on the viewer',
  'facing the viewer, head tilted to one side, curious', 'facing the viewer, chin lowered, looking up from under the brow',
  'in profile three-quarters, glancing back over the shoulder at the viewer', 'facing the viewer, head raised a little, looking slightly up',
];
const HEADS = [
  'a tall, high-domed cranium, noticeably taller than it is wide', 'a very broad, wide cranium, much wider than tall, like a river stone',
  'a round, clearly lopsided pebble head, one side of the crown higher', 'an egg-shaped head, narrow chin, large upper dome',
  'a lumpy, knobbly head with a few small bumps on the crown', 'a heart-shaped head with a soft dip in the middle of the crown',
];
// The face and body, so no two beings share one face. A species varies like dogs or people do.
const EYESET = [
  'the eyes set close together, high on the face, under a small forehead', 'the eyes set very far apart, wrapping toward the sides of the head',
  'the eyes set low, under a huge forehead', 'one eye clearly a little larger and higher than the other',
  'the eyes small for the face, deep-set under a heavy brow', 'the eyes enormous, filling most of the face',
];
const FACE = [
  'a long face ending in a pronounced little pointed chin', 'a short, flat face with almost no chin', 'full, round, soft cheeks',
  'hollow cheeks under high, sharp cheekbones', 'a soft brow ridge that overhangs the eyes like a cliff', 'a wide face with a broad, rounded jaw',
];
const BUILD = [
  'a thin, long neck and narrow, sloping shoulders', 'a thick, short neck and broad, heavy shoulders', 'a slight, small body hunched a little forward',
  'a plump, rounded body with soft folds at the neck', 'a wiry body, collarbones and neck tendons visible', 'one shoulder held higher than the other',
];
// The figurine look (v7). Same dimensions, said in the language of the style reference.
const FIG_MAT = {
  ivory: 'smooth warm ivory porcelain-stone, softly speckled', sandstone: 'warm terracotta and ochre sandstone with soft layered bands',
  marble: 'smooth cool white marble with faint grey veins', basalt: 'matte charcoal-black stone with tiny pale flecks',
  moss: 'dark green stone with soft living moss and lichen grown over the crown and shoulders',
  gold: 'ivory porcelain-stone mended with bright gold kintsugi seams across the head',
  opal: 'translucent milky opal, like a little spirit made of soft glass, with a gentle light inside',
};
const FIG_EYES = {
  wide: 'big round dark eyes, wide open and eager', soft: 'eyes peacefully closed in two soft curved lines, content',
  starlit: 'large dark eyes with tiny star-shaped sparkles', long: 'narrow dark eyes glancing slyly to one side',
  alert: 'dark eyes tilted up at the corners, wide awake and a little mischievous', full: 'round, curious dark eyes set wide apart',
};
const FIG_LINE = { steady: 'a calm, almost straight arc', flowing: 'a gentle S-wave', bursts: 'a little zigzag', unwritten: 'a faint soft curve' };
const FIG_ORBIT = {
  river: 'nothing else on the crown', satellite: 'one tiny second light high on the crown, joined to the line by a thin curve',
  twin: 'two small round lights side by side at the temple', net: 'a few fine glowing cracks spreading over the crown',
  constellation: 'four or five tiny glowing dots scattered over the crown',
};
const FIG_BLOOM = {
  bare: 'a bare, smooth crown', bud: 'one tiny green bud sprouting on top', sprout: 'a tiny sprout with two leaves on top',
  fern: 'a tuft of moss and a tiny curled fern on one side of the head', blossom: 'a little crown of tiny white daisies on one side of the head',
  crystal: 'a small cluster of clear quartz crystals growing from one side of the head',
};
// What this being does, from the Voice temperament. One small prop, never a costume.
const FIG_PROP = {
  listener: 'small headphones resting around its neck', visual: 'a tiny paintbrush in one hand, a small canvas on an easel beside it',
  storyteller: 'a tiny open book in its lap', linker: 'a tiny laptop open in front of it',
  balanced: 'a tiny steaming mug held in both hands', unwritten: 'a small lantern beside it, not yet lit',
};
const FIG_POSE = ['sitting cross-legged', 'sitting with its knees hugged', 'standing, one hand raised in a small wave', 'sitting, leaning forward curiously', 'sitting on a little stone ledge, feet dangling', 'standing, looking up at the sky'];
const FIG_SETTING = ['a warm golden-hour sunset over a sea of clouds', 'old mossy stone ruins with warm lanterns', 'a sunlit garden wall overgrown with vines and flowers', 'a cosy candlelit stone library nook', 'a misty waterfall among ancient stones', 'a stone aqueduct high above the clouds at dusk'];

// Flat, solid, matte backgrounds: the collection's signature colours. Never blue or pink (the networks'),
// and never charcoal behind dark basalt (the silhouette must read at 64 px).
export const BACKDROPS = ['deep oxblood', 'dark olive green', 'burnt ochre', 'charcoal black', 'deep forest green', 'warm umber', 'muted sage green', 'dark mustard', 'terracotta'];

const ev = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v]));

/** Which networks hold which messages. Shared (fork) history is counted once, as shared. */
export function networkEvidence(history, readNetworks) {
  const read = [...readNetworks].sort();
  let both = 0, farcasterOnly = 0, hypersnapOnly = 0;
  for (const m of history.messages) {
    const n = m.networks.filter((x) => read.includes(x));
    if (n.length === 2) both++; else if (n[0] === 'farcaster') farcasterOnly++; else if (n[0] === 'hypersnap') hypersnapOnly++;
  }
  // Observed history is not deployment evidence. We hold no proof this account runs a node.
  return { read, total: both + farcasterOnly + hypersnapOnly, both, farcasterOnly, hypersnapOnly, nodeOperation: 'unverified' };
}

// The portrait shows the being at rest. The network light is emergent: it runs through the veins only while the
// being does the work of sustaining the network (a running node), so it is drawn by a live layer, never painted in.
const AT_REST = 'This portrait shows the being at rest. Its forehead path, temple node and veins are living anatomy, the same colour as the skin (or a shade darker), and they are unlit: no blue, no pink, no glow, no light inside them anywhere. The network light appears only while a live node is at work for it; it is not part of this painting.';
function networkTrait(n, silent) {
  const l = liveLight(n, silent);
  return { value: l.value, evidence: l.evidence, live: l.text, text: AT_REST };
}

/** The light a running node will show in the veins (Snapchain blue, Hypersnap pink), from where the history is held. */
function liveLight(n, silent) {
  const bothRead = n.read.includes('farcaster') && n.read.includes('hypersnap');
  const evidence = ev({ read: n.read.join('+') || 'none', shared: n.both, snapchainOnly: n.farcasterOnly, hypersnapOnly: n.hypersnapOnly, nodeOperation: n.nodeOperation });
  if (!n.read.length) return { value: 'unobserved', evidence, text: 'No network was read for this snapshot. Draw the luminous paths in a soft neutral white light, without blue or pink, and do not imply anything about either network.' };
  if (silent) {
    return { value: 'unwritten', evidence, text: `${bothRead ? 'Both networks were read' : `Only ${n.read[0] === 'farcaster' ? 'Snapchain' : 'Hypersnap'} was read`} and hold no messages for this account yet. Draw the paths faint and pale: a quiet white light with only the softest hint of ${bothRead ? 'blue and pink' : n.read[0] === 'farcaster' ? 'blue' : 'pink'} at the edges, as if not yet lit.` };
  }
  if (!bothRead) {
    const [name, colour] = n.read[0] === 'farcaster' ? ['Snapchain', 'blue'] : ['Hypersnap', 'pink'];
    return { value: `${colour} (${name} read only)`, evidence, text: `Only ${name} was read for this snapshot. Draw the luminous paths in ${name} ${colour}, with the temple node white-hot at its core. Do not add the other network's colour, and do not imply anything about the other network: it was not read.` };
  }
  const excl = n.farcasterOnly + n.hypersnapOnly;
  const exclShare = n.total ? excl / n.total : 0;
  if (exclShare < 0.02) {
    return { value: 'braided blue and pink', evidence, text: 'This history is held identically on both networks. Draw every luminous path as a braid of two intertwined strands, Snapchain blue and Hypersnap pink, in equal measure and clearly distinguishable, meeting in a white-hot core at the temple node. The colours describe where the history is held, not which nodes this being runs.' };
  }
  const lean = n.farcasterOnly >= n.hypersnapOnly ? ['blue', 'pink', 'Snapchain'] : ['pink', 'blue', 'Hypersnap'];
  if (Math.max(n.farcasterOnly, n.hypersnapOnly) / Math.max(1, excl) < 0.65) {
    return { value: 'braided, with separate tips', evidence, text: 'Most of this history is held on both networks, plus some messages held on only one or the other. Draw the main paths as a braid of Snapchain blue and Hypersnap pink in equal measure; let a few fine outer branch tips run in a single colour, some blue and some pink.' };
  }
  return { value: `braided, leaning ${lean[0]}`, evidence, text: `Shared history is a braid of Snapchain blue and Hypersnap pink. ${Math.round(exclShare * 100)}% of messages are held only on ${lean[2]}: let ${lean[0]} lead in the outer branches, with ${lean[1]} still present in the braid. The colours describe where the history is held, not which nodes this being runs.` };
}

/** low | mid | high against the calibrated tertiles. */
const level = (x, q) => (x < q.q33 ? 'low' : x > q.q67 ? 'high' : 'mid');

/**
 * @param {object} o
 * @param {object} o.features     fatliners.features/1
 * @param {object} o.dna          fatliners.dna/1 (seed, glaze and legacy forms are reused, never changed)
 * @param {object} o.network      networkEvidence()
 * @param {object} o.coverage     { state, messages }
 * @param {object} o.calibration  calibration/<name>.json
 */
export function visualTraits({ features: f, dna, network, coverage, calibration }) {
  if (!calibration?.quantiles) throw new Error('traits: a calibration is required');
  const Q = calibration.quantiles;
  const R = (label) => prng(dna.seed, `pfp:${label}`);
  const messages = coverage.messages ?? 0;
  const silent = f.pulse.silent;
  const sparse = !silent && messages < SPARSE_MESSAGES;
  const neutral = silent || sparse;
  const cal = { calibration: calibration.name };

  // ---- ROOTS
  let mat;
  const age = f.roots.ageDays;
  if (age < NEWCOMER_DAYS) mat = 'opal';
  else if (f.roots.returns >= 1 && !neutral && network.read.length) mat = 'gold';
  else if (neutral) mat = 'ivory';
  else if (f.roots.continuity < Q['roots.continuity'].q20) mat = 'moss';
  else if (age >= Q['roots.ageDays'].q67) mat = f.roots.continuity >= Q['roots.continuity'].q50 ? 'basalt' : 'sandstone';
  else if (age <= Q['roots.ageDays'].q33) mat = 'marble';
  else mat = 'ivory';
  const sub = SUBSTRATE[mat];
  const seams = mat === 'gold' ? Math.min(3, f.roots.returns) : 0;
  const qa = Q['roots.ageDays'];
  const patina = age < NEWCOMER_DAYS ? 1 : 1 + [qa.q20, qa.q50, qa.q67, qa.q80].filter((t) => age > t).length;
  const undertone = UNDERTONE[dna.palette.glaze];
  const roots = {
    value: sub.value, patina, undertone, seeded: ['undertone'],
    evidence: ev({ ageDays: age, ageIsLowerBound: !f.roots.ageKnown, continuity: f.roots.continuity, returns: f.roots.returns, ...(neutral ? { neutral: silent ? 'no messages' : 'sparse history' } : {}), legacyMaterial: dna.roots.material, ...cal }),
    text: `${sub.text}${seams ? ` (${seams === 1 ? 'one seam' : `${seams} seams`}, thin and restrained, crossing the crown and one cheek, never through the eyes)` : ''}; ${PATINA[patina]}; a faint ${undertone} undertone in the skin.`,
  };

  // ---- ORBIT
  let orb;
  if (neutral) orb = R('orbit-neutral').pick(['river', 'satellite']);
  else {
    const reply = level(f.orbit.replyShare, Q['orbit.replyShare']);
    const close = f.orbit.bonds >= Q['orbit.bonds'].q67;
    orb = reply === 'low' ? 'river' : reply === 'mid' ? (close ? 'twin' : 'satellite') : (close ? 'constellation' : 'net');
  }
  const orbit = {
    value: ORBIT[orb].value,
    ...(neutral ? { seeded: ['form'] } : {}),
    evidence: ev({ replyShare: f.orbit.replyShare, bonds: f.orbit.bonds, legacyForm: dna.orbit.form, ...cal }),
    text: `${ORBIT[orb].text}. All of it is part of the skin, never added on, never lit.`,
  };

  // ---- VOICE: the ratio that sits furthest into its own top fifth sets the temperament.
  let temp = silent ? 'unwritten' : 'balanced';
  let scores = {};
  if (!neutral) {
    scores = {
      listener: f.voice.listening / Q['voice.listening'].q80,
      visual: f.voice.mediaShare / Q['voice.mediaShare'].q80,
      storyteller: Math.max(f.voice.length / Q['voice.length'].q80, Q['voice.longShare'].q80 > 0 ? f.voice.longShare / Q['voice.longShare'].q80 : 0),
      linker: f.voice.linkShare / Q['voice.linkShare'].q80,
    };
    const [best, s] = Object.entries(scores).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (s >= 1) temp = best;
  }
  const T = TEMPERAMENT[temp];
  const eyeKey = T.eyes ?? (level(f.orbit.replyShare, Q['orbit.replyShare']) === 'high' ? 'wide' : 'full');
  const lenLevel = level(f.voice.length, Q['voice.length']);
  const finish = neutral ? 'satin' : f.voice.length >= Q['voice.length'].q80 ? 'pearl' : { low: 'matte', mid: 'satin', high: 'gloss' }[lenLevel];
  const glow = !neutral && f.voice.listening >= Q['voice.listening'].q67;
  const blush = !neutral && f.voice.mentionShare >= Q['voice.mentionShare'].q80;
  const voice = {
    value: EYES[eyeKey].value, temperament: temp, finish, accent: T.accent,
    evidence: ev({ temperament: temp, ...Object.fromEntries(Object.entries(scores).map(([k, v]) => [`${k}VsTop20`, v])), listening: f.voice.listening, mediaShare: f.voice.mediaShare, linkShare: f.voice.linkShare, length: f.voice.length, longShare: f.voice.longShare, mentionShare: f.voice.mentionShare, legacyTemperament: dna.temperament, ...cal }),
    text: `${EYES[eyeKey].text}; ${MOUTH[T.mouth]}; ${FINISH[finish]}; ${glow ? 'thin, translucent skin at the temples, warm where the light passes through' : 'opaque skin'}${blush ? '; a faint warm mineral flush on the cheeks' : ''}. Accent colour, used sparingly in a few mineral flecks and the tiny highlight in each eye (the irises stay dark): ${T.accent}.`,
  };

  // ---- PULSE
  const pk = neutral ? 'flowing' : { low: 'steady', mid: 'flowing', high: 'bursts' }[level(f.pulse.burstiness, Q['pulse.burstiness'])];
  const wl = level(f.pulse.activeWeekShare, Q['pulse.activeWeekShare']);
  const strength = neutral ? 'a medium vein' : `a ${THICK[wl]} vein`;
  const where = dna.pulse.nodeAt < 0.34 ? 'near where the path begins' : dna.pulse.nodeAt < 0.67 ? 'midway along the path' : 'close to the temple node';
  const pulse = {
    value: silent ? 'unwritten' : pk,
    thickness: neutral ? 'medium' : THICK[wl],
    evidence: ev({ burstiness: f.pulse.burstiness, activeWeekShare: f.pulse.activeWeekShare, peakAt: f.pulse.peakAt, ...(neutral ? { neutral: silent ? 'no messages' : 'sparse history' } : {}), legacyStyle: dna.pulse.style, ...cal }),
    text: silent
      ? 'the forehead path is a calm, faint, gently curved vein; the body veins are few and fine.'
      : `${PULSE[pk].text}; ${strength}${neutral ? '' : `; one small knot in the vein ${where}`}.`,
  };

  // ---- BLOOM
  let bk;
  if (neutral) bk = R('bloom-neutral').pick(['bare', 'bud', 'sprout']);
  else if (f.bloom.makerShare >= Q['voice.mediaShare'].q80) bk = 'blossom';
  else if (f.voice.linkShare >= Q['voice.linkShare'].q80) bk = 'crystal';
  else if (f.bloom.rootedShare < Q['bloom.rootedShare'].q20) bk = 'bare';
  else if (f.bloom.evenness >= Q['bloom.evenness'].q67) bk = 'fern';
  else if (f.bloom.evenness < Q['bloom.evenness'].q33) bk = 'bud';
  else bk = 'sprout';
  const bloom = {
    value: BLOOM[bk].value,
    ...(neutral ? { seeded: ['form'] } : {}),
    evidence: ev({ makerShare: f.bloom.makerShare, linkShare: f.voice.linkShare, rootedShare: f.bloom.rootedShare, evenness: f.bloom.evenness, legacyForm: dna.bloom.form, ...cal }),
    text: `${BLOOM[bk].text}. Small, never covering the forehead path or temple node.`,
  };

  const net = networkTrait(network, silent);
  const identity = {
    pose: R('pose').pick(POSES), head: R('head').pick(HEADS),
    eyes: R('eyeset').pick(EYESET), face: R('face').pick(FACE), build: R('build').pick(BUILD),
    backdrop: R('backdrop').pick(mat === 'basalt' ? BACKDROPS.filter((b) => b !== 'charcoal black') : BACKDROPS),
    templeSide: R('temple').pick(['left', 'right']),
    seeded: ['pose', 'head', 'eyes', 'face', 'build', 'backdrop', 'templeSide'],
  };

  const figurine = {
    material: FIG_MAT[mat], head: identity.head, eyes: FIG_EYES[eyeKey],
    line: `one thin line, ${silent ? FIG_LINE.unwritten : FIG_LINE[pk]}, softly glowing pale white, ending at the temple on the viewer's ${identity.templeSide} in a small round light; ${FIG_ORBIT[orb]}`,
    crown: FIG_BLOOM[bk], prop: FIG_PROP[temp], pose: R('fig-pose').pick(FIG_POSE), setting: R('fig-setting').pick(FIG_SETTING),
    seeded: ['pose', 'setting'],
  };

  let coverageText;
  if (coverage.state === 'known-no-messages' || silent) coverageText = 'This account exists but its history holds no messages yet. Its traits are neutral, not a statement about the person. Make it an equally finished, beautiful individual.';
  else if (sparse) coverageText = `This history is sparse (${messages < 10 ? 'fewer than 10' : 'fewer than 30'} messages), so its readings are uncertain and its forms are neutral. Keep every trait restrained; do not exaggerate any of them.`;
  else coverageText = `History read from ${network.read.map((x) => (x === 'farcaster' ? 'Snapchain' : 'Hypersnap')).join(' and ')}.${f.roots.ageKnown ? '' : ' Its true age may be older than measured.'} Treat gaps in activity as unknown, not as absence.`;

  return {
    version: TRAITS_VERSION, calibration: calibration.name, sparse, identity,
    roots, orbit, voice, pulse, bloom, network: net, figurine,
    coverage: { state: coverage.state, messages, sparse, text: coverageText },
  };
}

/** Standard NFT attributes from the traits (public; no raw metrics). */
export function attributes(t) {
  return [
    { trait_type: 'Roots', value: t.roots.value },
    { trait_type: 'Patina', value: t.roots.patina, display_type: 'number' },
    { trait_type: 'Orbit', value: t.orbit.value },
    { trait_type: 'Voice', value: t.voice.value },
    { trait_type: 'Temperament', value: t.voice.temperament },
    { trait_type: 'Finish', value: t.voice.finish },
    { trait_type: 'Pulse', value: t.pulse.value },
    ...(t.pulse.thickness ? [{ trait_type: 'Signal', value: t.pulse.thickness }] : []),
    { trait_type: 'Head', value: t.identity.head.split(',')[0].replace(/^an? /, '') },
    ...(t.identity.face ? [{ trait_type: 'Face', value: t.identity.face.replace(/^an? /, '') }] : []),
    { trait_type: 'Bloom', value: t.bloom.value },
    { trait_type: 'Networks', value: t.network.value },
    ...(t.figurine ? [{ trait_type: 'Prop', value: t.figurine.prop.replace(/^(a |small )+/, '').split(/[,.]/)[0] }] : []),
    { trait_type: 'Background', value: t.identity.backdrop },
  ];
}
