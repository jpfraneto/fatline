// Is this node live? Read from the hatchery's hourly checks of it (GET <hatchery>/eggs/<fid>).
// A check passes when the node answers, is in sync (or catching up), holds real data and runs its hatchery.
// Used by the home page (one line per card) and by fatline.ink/<FID> (the full picture).
(() => {
  const NET = { farcaster: 'Snapchain', snapchain: 'Snapchain', hypersnap: 'Hypersnap' };
  const ago = (ms) => {
    const m = Math.max(0, Math.round(ms / 60e3));
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} days ago`;
  };
  const behindText = (blocks) => (blocks < 120 ? `${blocks} blocks` : blocks < 7200 ? `~${Math.round(blocks / 60)} min` : `~${Math.round(blocks / 3600)} h`);

  /**
   * w: the hatchery's status for one egg, or null.
   * Returns { state, title, detail, network, lastAt, passed, total }.
   * state: live | syncing | down | quiet | hatched | unknown.
   */
  function nodeHealth(w, now = Date.now()) {
    if (!w) return { state: 'unknown', title: 'Not checked here', detail: 'The hatchery has no egg for this account, so it is not checking a node for it.' };
    const network = NET[w.network] ?? w.network;
    const recent = w.recent ?? [];
    const last = recent.at(-1);
    const passed = recent.filter((c) => c.ok).length, total = recent.length;
    const base = { network, lastAt: last?.at ?? null, passed, total };
    if (w.hatched) return { ...base, state: 'hatched', title: 'Hatched', detail: 'Its egg hatched, so the hatchery stopped its hourly checks.' };
    if (!last) return { ...base, state: 'unknown', title: 'No checks yet', detail: 'The hatchery has not checked this node yet.' };
    const age = now - last.at;
    // Checks come about once an hour. Two hours of silence means the hatchery itself is not checking.
    if (age > 2.2 * 3600e3) return { ...base, state: 'quiet', title: 'No recent checks', detail: `The last check was ${ago(age)}. The hatchery has not checked it since, so its state now is unknown.` };
    if (last.ok === false) return { ...base, state: 'down', title: 'Missed its last check', detail: `${ago(age)}: ${last.reason ?? 'no reason given'}.` };
    if (last.syncing) return { ...base, state: 'syncing', title: 'Live, catching up', detail: `Checked ${ago(age)}: ${behindText(last.behind ?? 0)} behind and getting closer. That still counts as warm.` };
    // An older hatchery doesn't report speed or sync with each check: then all we know is that it passed.
    if (last.ms == null) return { ...base, state: 'live', title: 'Live', detail: `Passed its last check ${ago(age)}: it answered, was in sync or catching up, and held real data.` };
    return { ...base, state: 'live', title: 'Live and in sync', detail: `Checked ${ago(age)}: answered in ${last.ms} ms, in sync, and returned the messages it was asked for.` };
  }

  window.nodeHealth = nodeHealth;
  window.nodeHealthAgo = ago;
})();
