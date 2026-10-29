// The SNAP: switching between Snapchain and Hypersnap reboots the client. It powers down for a blink, flashes, and a
// wave of electricity runs through it, top to bottom, in the new network's color (Snapchain warm, Hypersnap cool).
// It is the same client reading another copy of Farcaster: it should feel alive when that happens.

const COLORS = {
  snapchain: { core: '#fff4d6', glow: '#edba54', far: '#f5946b' },
  hypersnap: { core: '#eef3ff', glow: '#8fb4ff', far: '#b48cff' },
};

/** A jagged line across the screen at height y, like a crackle of current. */
function bolt(w, y, jag) {
  let d = `M0 ${y.toFixed(1)}`;
  for (let x = 0; x < w; x += 14 + Math.random() * 22) d += ` L${x.toFixed(1)} ${(y + (Math.random() - 0.5) * jag).toFixed(1)}`;
  return `${d} L${w} ${y.toFixed(1)}`;
}

export function snap(net, { done } = {}) {
  const c = COLORS[net] ?? COLORS.snapchain;
  const root = document.documentElement;
  root.style.setProperty('--snap-core', c.core);
  root.style.setProperty('--snap-glow', c.glow);
  root.style.setProperty('--snap-far', c.far);
  navigator.vibrate?.([12, 40, 24]);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('snap-soft');
    setTimeout(() => { root.classList.remove('snap-soft'); done?.(); }, 450);
    return;
  }
  document.querySelector('.snap-layer')?.remove();
  const w = innerWidth, h = innerHeight;
  const layer = document.createElement('div');
  layer.className = 'snap-layer';
  layer.innerHTML = `<div class="snap-flash"></div><div class="snap-band"></div>
    <svg class="snap-bolts" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <path class="b1"/><path class="b2"/><path class="b3"/></svg>`;
  document.body.append(layer);
  root.classList.add('snap-off');
  const paths = [...layer.querySelectorAll('path')];
  const band = layer.querySelector('.snap-band');
  const start = performance.now() + 140; // the blink of darkness before the current
  const run = 620;
  let swapped = false;
  const frame = (now) => {
    const t = (now - start) / run;
    if (t < 0) return requestAnimationFrame(frame);
    if (!swapped) { swapped = true; root.classList.remove('snap-off'); root.classList.add('snap-on'); done?.(); }
    const e = 1 - (1 - Math.min(t, 1)) ** 2; // fast, then easing out
    const y = -60 + e * (h + 120);
    band.style.transform = `translateY(${y.toFixed(1)}px)`;
    paths[0].setAttribute('d', bolt(w, y, 26));
    paths[1].setAttribute('d', bolt(w, y + 10, 40));
    paths[2].setAttribute('d', bolt(w, y - 30 * Math.random(), 70));
    layer.style.opacity = t > 0.85 ? String(Math.max(0, (1 - t) / 0.15)) : '1';
    if (t < 1) requestAnimationFrame(frame);
    else { layer.remove(); setTimeout(() => root.classList.remove('snap-on'), 700); }
  };
  requestAnimationFrame(frame);
  // A hidden tab gets no frames: never leave the client dark.
  setTimeout(() => {
    if (!swapped) { swapped = true; root.classList.remove('snap-off'); done?.(); }
    if (layer.isConnected) { layer.remove(); root.classList.remove('snap-on'); }
  }, 1600);
}
