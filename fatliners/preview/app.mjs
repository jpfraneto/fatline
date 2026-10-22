import { generate } from '../src/index.mjs';
import { renderSvg } from '../src/render.mjs';
import { sha256Hex } from '../src/hash.mjs';
import { allProfiles, history } from '../src/sources/synthetic.mjs';

const $ = (id) => document.getElementById(id);
const dataUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
const profiles = allProfiles();
let current = null; // { label, history, result }

function select(label, hist, tag) {
  const result = generate(hist, { view: 'owner' });
  current = { label, history: hist, result, tag, first: sha256Hex(result.svg) };
  draw();
  $('verdict').innerHTML = `seed <b>${result.dna.seed.slice(0, 18)}…</b><br>commitment ${result.commitment.slice(0, 18)}… · svg sha256 ${current.first.slice(0, 18)}…`;
}

function draw() {
  const { result } = current;
  const living = $('living').checked;
  const signal = { farcaster: $('fc').checked ? 'synced' : null, hypersnap: $('hs').checked ? 'synced' : null };
  $('big').innerHTML = living ? renderSvg(result.dna, { living: true, signal }) : result.svg;
  $('sizes').innerHTML = [[result.icon, 32, '32 px (icon detail)'], [result.svg, 64, '64 px'], [result.svg, 128, '128 px'], [result.svg, 256, '256 px']]
    .map(([s, px, t]) => `<figure><img width="${px}" height="${px}" src="${dataUrl(s)}" alt=""><figcaption>${t}</figcaption></figure>`).join('');
  const f = result.atlas.features, d = result.atlas.dimensions;
  const rows = {
    roots: { 'age (days)': f.roots.ageDays + (f.roots.ageKnown ? '' : ' (lower bound)'), continuity: f.roots.continuity, returns: f.roots.returns, 'longest silence (d)': f.roots.longestSilenceDays },
    orbit: { 'reply share': f.orbit.replyShare, bonds: f.orbit.bonds, 'circle (eff. people)': f.orbit.circle, spread: f.orbit.spread },
    voice: { listening: f.voice.listening, images: f.voice.mediaShare, links: f.voice.linkShare, length: f.voice.length, 'long casts': f.voice.longShare, mentions: f.voice.mentionShare },
    pulse: { burstiness: f.pulse.burstiness, 'active weeks': f.pulse.activeWeekShare, 'peak at': f.pulse.peakAt },
    bloom: { channels: f.bloom.channels, evenness: f.bloom.evenness, 'in channels': f.bloom.rootedShare, maker: f.bloom.makerShare },
  };
  const title = `<p class="note">${current.tag === 'real' ? '<span class="tag real">real FID, local archive</span>' : '<span class="tag">synthetic</span>'} ${current.label} · ${current.history.messages.length} messages</p>`;
  $('dims').innerHTML = title + Object.keys(rows).map((k) => `<div class="dim"><h3>${k.toUpperCase()} <em>${d[k].trait}</em></h3><p>${d[k].reading}</p><div class="kv">${Object.entries(rows[k]).map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('')}</div></div>`).join('');
  const { features, ...pub } = result.atlas;
  $('atlas').textContent = JSON.stringify(pub, null, 2);
  $('dna').textContent = JSON.stringify({ ...result.dna, pulse: { ...result.dna.pulse, curve: `[${result.dna.pulse.curve.length} points]` } }, null, 2);
  document.querySelectorAll('.list button').forEach((b) => b.classList.toggle('on', b.dataset.id === current.label));
}

$('list').innerHTML = profiles.map((p) => {
  const r = generate(history(p));
  return `<button data-id="${p.id}"><img src="${dataUrl(r.icon)}" alt=""><span>${p.id.replace('syn-', '')}<small>${p.label}</small></span></button>`;
}).join('');
$('list').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const p = profiles.find((x) => x.id === b.dataset.id);
  select(p.id, history(p), 'synthetic');
});
$('regen').onclick = () => {
  // Rebuild everything from the raw history, in a fresh pass, and compare bytes.
  const again = generate(structuredClone(current.history), { view: 'owner' });
  const h = sha256Hex(again.svg);
  $('verdict').innerHTML = h === current.first
    ? `<b>identical ✓</b> regenerated from history: svg sha256 ${h.slice(0, 26)}…`
    : `<span style="color:#ff7f9c">DIFFERENT ✗</span> ${h} vs ${current.first}`;
};
for (const id of ['living', 'fc', 'hs']) $(id).onchange = () => current && draw();
$('load').onclick = async () => {
  const fid = $('fid').value.trim(), reg = $('reg').value.trim();
  if (!/^\d+$/.test(fid)) return;
  $('fidnote').textContent = 'reading the local archive…';
  try {
    const res = await fetch(`/api/fid/${fid}${reg ? `?registeredAt=${reg}` : ''}`);
    if (!res.ok) throw new Error(await res.text());
    const { history: h, sources } = await res.json();
    $('fidnote').textContent = `${h.messages.length} merged messages · sources: ${sources.map((s) => `${s.network} (${s.label})`).join(', ') || 'none'}. Snapshot = now, so the face changes as history grows; a minted face is frozen at its snapshot.`;
    select(`FID ${fid}`, h, 'real');
  } catch (err) {
    $('fidnote').textContent = 'Could not read the archive: ' + err.message;
  }
};
const p0 = profiles[4];
select(p0.id, history(p0), 'synthetic');

// ?selftest: hash every synthetic being's SVG in this browser, for bin/cross-engine.mjs to compare with Node.
if (new URLSearchParams(location.search).has('selftest')) {
  const out = Object.fromEntries(profiles.map((p) => { const r = generate(history(p)); return [p.id, sha256Hex(r.svg + r.icon)]; }));
  const pre = document.createElement('pre'); pre.id = 'selftest'; pre.textContent = JSON.stringify(out); document.body.append(pre);
}
