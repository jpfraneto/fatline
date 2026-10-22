// The Memory Atlas: why a Fatliner looks the way it does.
//
// Two views. 'public' says what shaped each trait in bands ("about a third", "2–4 years"), never exact
// counts, never message content, never who they talk to or which channels. 'owner' adds the exact
// feature numbers, for the person whose history it is. Raw messages are in neither.

import { subjectKey } from './history.mjs';

export const ATLAS_SCHEMA = 'fatliners.atlas/1';

const band = (x) => (x < 0.05 ? 'almost none' : x < 0.2 ? 'a little' : x < 0.4 ? 'about a third' : x < 0.6 ? 'about half' : x < 0.8 ? 'most' : 'nearly all');
const ageBand = (d) => (d < 90 ? 'under 3 months' : d < 365 ? 'under a year' : d < 730 ? '1–2 years' : d < 1460 ? '2–4 years' : 'over 4 years');

const READINGS = {
  material: {
    dew: 'Newly arrived. Its skin is still fresh dew.',
    kintsugi: 'It went silent for long stretches, and came back. Every return left a seam of gold.',
    stone: 'A long, unbroken presence, worn smooth like river stone.',
    moss: 'A long life lived quietly. Moss grows where things are left in peace.',
    clay: 'Shaped steadily, by hand, like a thrown pot. The lines are its turns on the wheel.',
  },
  orbit: {
    halo: 'It speaks to the room more than to one person: a single halo, not a moon.',
    moon: 'One moon on a tilted orbit: it answers others now and then.',
    binary: 'Two moons, linked. Its conversations keep returning to the same few people.',
    constellation: 'A small constellation: a circle of people it keeps coming back to.',
    ring: 'A wide ring of dust: light contact with many.',
  },
  temperament: {
    listener: 'Mostly a listener. Light passes through it.',
    balanced: 'A balanced voice: neighbouring colours.',
    visual: 'It speaks in images: its colours sit opposite each other.',
    storyteller: 'A storyteller: long casts, split colours, an open mouth mid-sentence.',
    linker: 'It shares the web: three-way colours, a sly grin.',
    unwritten: 'It has not spoken yet. Its colours wait in one hue.',
  },
  pulse: {
    spike: 'It arrives in bursts: the line spikes.',
    wave: 'Its rhythm rises and falls: the line waves.',
    steady: 'It shows up like a metronome: the line runs smooth.',
  },
  bloom: {
    seed: 'It belongs to no channel yet: a single seed of light.',
    bud: 'One deep home: a closed bud.',
    sprout: 'A few homes: a sprout with two leaves.',
    fern: 'It wanders many gardens evenly: an unrolling fern.',
    blossom: 'It makes images and video: an open blossom.',
  },
};

export function atlas({ history, features, dna, commitment, provenance, renderer, token = null }, { view = 'public' } = {}) {
  const f = features;
  const silent = f.pulse.silent;
  const out = {
    schema: ATLAS_SCHEMA,
    subject: subjectKey(history.subject),
    synthetic: history.subject.kind === 'synthetic',
    token: token ?? { id: null, originalFid: history.subject.fid ?? null, mintedBy: null, note: 'not minted' },
    snapshot: {
      at: history.snapshotAt,
      commitment,
      networks: provenance, // count + hash root per network; null = not seen on that network in this snapshot
      ageSource: f.roots.ageKnown ? 'onchain registration' : 'oldest message the node still holds (a lower bound)',
    },
    versions: { features: f.version, dna: dna.version, renderer },
    seed: dna.seed,
    dimensions: {
      roots: {
        trait: dna.roots.material, rings: dna.roots.rings,
        reading: READINGS.material[dna.roots.material] + ` ${dna.roots.rings} growth ring${dna.roots.rings > 1 ? 's' : ''} on its body.`,
        signals: { age: ageBand(f.roots.ageDays), activeMonths: band(f.roots.continuity), returns: f.roots.returns === 0 ? 'none' : f.roots.returns === 1 ? 'one' : f.roots.returns < 4 ? 'a few' : 'many' },
      },
      orbit: {
        trait: dna.orbit.form, reading: READINGS.orbit[dna.orbit.form],
        signals: { repliesOfPosts: band(f.orbit.replyShare), returningConversation: band(f.orbit.bonds) },
      },
      voice: {
        trait: dna.temperament, finish: dna.voice.finish, eyes: dna.voice.eyes, mouth: dna.voice.mouth,
        reading: READINGS.temperament[dna.temperament],
        signals: { listening: band(f.voice.listening), images: band(f.voice.mediaShare), links: band(f.voice.linkShare), length: band(f.voice.length) },
      },
      pulse: {
        trait: dna.pulse.style,
        reading: silent ? 'Its signal is unwritten: a calm wave drawn from its seed, waiting.' : READINGS.pulse[dna.pulse.style] + ' The node sits at its brightest moment.',
        signals: { shape: silent ? 'none yet' : 'the line is its activity over its whole life, left to right', activeWeeks: band(f.pulse.activeWeekShare) },
      },
      bloom: {
        trait: dna.bloom.form, reading: READINGS.bloom[dna.bloom.form],
        signals: { inChannels: band(f.bloom.rootedShare), spread: f.bloom.channels === 0 ? 'none' : band(f.bloom.evenness) },
      },
    },
    palette: { glaze: dna.palette.glaze, harmony: dna.palette.harmony, note: 'the glaze comes from the seed alone' },
  };
  if (view === 'owner') out.features = f;
  return out;
}
