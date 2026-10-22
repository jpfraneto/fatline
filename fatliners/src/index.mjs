// The pipeline: history snapshot → features → commitment → seed → DNA → SVG + Memory Atlas.
// Deterministic end to end, and the same module runs in Node and in the browser preview.

import { validateHistory, commitment as commit, provenance } from './history.mjs';
import { extractFeatures } from './features.mjs';
import { buildDna } from './dna.mjs';
import { renderSvg, RENDERER_VERSION } from './render.mjs';
import { atlas } from './atlas.mjs';

export { renderSvg, RENDERER_VERSION };

export function generate(rawHistory, { view = 'public', token = null } = {}) {
  const history = validateHistory(rawHistory);
  const features = extractFeatures(history);
  const commitment = commit(history);
  const dna = buildDna(features, { subject: history.subject, commitment });
  const prov = provenance(history);
  return {
    history, features, commitment, dna,
    svg: renderSvg(dna),
    icon: renderSvg(dna, { detail: 'icon' }),
    atlas: atlas({ history, features, dna, commitment, provenance: prov, renderer: RENDERER_VERSION, token }, { view }),
  };
}
