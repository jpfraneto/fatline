#!/usr/bin/env bash
# Builds fatline.ink on the master, from its own nodes and hatchery: the server is the site. Run every hour
# by the fatline-site timer (infra/site-setup.sh). It does what the GitHub workflow did, without GitHub:
#   1. the latest code (git pull in /root/fatline-site; a push to main deploys within the hour);
#   2. the skill page, every node's status, Aster's hatching, and each token's metadata (fatline.ink/fatliners/<fid>);
#   3. a new folder with all of it, swapped in at once (/srv/fatline-site/current), so a visitor never sees half a build.
# If a step that reads the network fails, the last good file is kept.
set -euo pipefail
REPO=/root/fatline-site
ROOT=/srv/fatline-site
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

git -C "$REPO" fetch -q origin main && git -C "$REPO" reset -q --hard origin/main
SITE="$REPO/apps/site"
next="$ROOT/build-$(date -u +%Y%m%d%H%M%S)"
mkdir -p "$ROOT"
prev=$(readlink -f "$ROOT/current" 2>/dev/null || true)

node "$SITE/skill-page.mjs" >/dev/null
cp -a "$SITE" "$next"
rm -f "$next/CNAME"
# join.sh installs exactly the commit this site was built from (not whatever main is when someone runs it).
sha=$(git -C "$REPO" rev-parse HEAD)
sed -i "s|^REF=\"\${FATLINE_REF:-main}\"|REF=\"\${FATLINE_REF:-$sha}\"|" "$next/join.sh"
grep -q "FATLINE_REF:-$sha" "$next/join.sh" || log "join.sh: could not pin the commit"
# Start from the last build's generated files, so a failed read keeps them.
if [ -n "$prev" ] && [ -d "$prev" ]; then
  for f in status.json hatching.json; do [ -f "$prev/$f" ] && cp -a "$prev/$f" "$next/$f"; done
  [ -d "$prev/fatliners" ] && cp -a "$prev/fatliners" "$next/"
fi
node "$SITE/status.mjs" "$next/status.json.new" >/dev/null && mv "$next/status.json.new" "$next/status.json" || log "status: kept the last one"
node "$SITE/hatching.mjs" "$next/hatching.json" >/dev/null || log "hatching: kept the last one"
node "$SITE/fatliners.mjs" "$next/fatliners" >/dev/null || log "fatliners: kept the last ones"

ln -sfn "$next" "$ROOT/current.new" && mv -T "$ROOT/current.new" "$ROOT/current"
# Keep the last three builds.
ls -1d "$ROOT"/build-* | sort | head -n -3 | xargs -r rm -rf
log "built $(git -C "$REPO" log -1 --format='%h %s' | cut -c1-70) → $next"
