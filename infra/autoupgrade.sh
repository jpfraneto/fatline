#!/usr/bin/env bash
# Auto-upgrade for the nodes already running on this machine: fatline node autoupgrade on|off|status.
# Runs on the node's machine (fatline pipes it over SSH for a rented server; `fatline update` runs it on a node's
# server as `ensure`: on, unless "off" was chosen there). "on" adds one crontab line per node, once a day at a random time:
#   Snapchain: its own ./snapchain.sh upgrade (restarts the node only when there is a new version).
#   Hypersnap: /usr/local/sbin/fatline-hypersnap-upgrade, written below: moves to the newest release tag on
#              Docker Hub (never nightly), and goes back to the old one if the new one doesn't answer in 10 minutes.
# Why daily: v0.15.0 shipped on 2026-10-23 with a protocol change active the same day. Our Hypersnap stayed on
# 0.13.5, hit a trie root mismatch and stood still for four days (2026-10-24..28) before anyone saw it.
set -euo pipefail
mode="${1:-status}"
snap=""
for x in /root/snapchain "$HOME/snapchain"; do [ -x "$x/snapchain.sh" ] && { snap="$x"; break; }; done
hyper=""
for x in /root/hypersnap "$HOME/hypersnap"; do
  [ -f "$x/docker-compose.yml" ] && grep -q 'farcasterorg/hypersnap:' "$x/docker-compose.yml" && { hyper=$(readlink -f "$x"); break; }
done
[ -n "$snap$hyper" ] || { echo "No node here (looked for snapchain.sh in /root/snapchain, ~/snapchain and a Hypersnap compose in /root/hypersnap, ~/hypersnap)."; exit 1; }
ver() { curl -s -m 5 "localhost:$1/v1/info" | grep -o '"version":"[^"]*"' | cut -d'"' -f4 || true; }
OPTOUT="$HOME/.fatline-no-autoupgrade"  # left by "off": `fatline update` (mode ensure) then leaves it off
UPGRADER="${FATLINE_UPGRADER:-/usr/local/sbin/fatline-hypersnap-upgrade}"  # the override is for tests

write_upgrader() {
  cat > "$UPGRADER" <<'EOF'
#!/usr/bin/env bash
# Written by Fatline (infra/autoupgrade.sh). Moves Hypersnap to the newest release tag; rolls back if it won't answer.
set -uo pipefail
d="$1"; cd "$d" || exit 1
log() { echo "$(date -u +%FT%TZ) $*"; }
cur=$(sed -n 's|.*image: *farcasterorg/hypersnap:\([^ ]*\).*|\1|p' docker-compose.yml | head -1)
new=$(curl -fsS -m 30 'https://hub.docker.com/v2/repositories/farcasterorg/hypersnap/tags?page_size=100' \
  | grep -o '"name":"[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*"' | cut -d'"' -f4 | sort -V | tail -1)
[ -n "$new" ] || { log "could not read Docker Hub's tags; staying on $cur"; exit 0; }
if [ "$cur" = "$new" ] || [ "$(printf '%s\n%s\n' "$cur" "$new" | sort -V | tail -1)" = "$cur" ]; then log "up to date: $cur"; exit 0; fi
# A snapshot still streaming (setup not finished): don't start the node under it.
[ -f .snapshot-done ] || { log "snapshot not finished; $new waits"; exit 0; }
log "upgrading $cur -> $new"
cp -p docker-compose.yml "docker-compose.yml.before-$new"
sed -i "s|farcasterorg/hypersnap:$cur|farcasterorg/hypersnap:$new|" docker-compose.yml
port=$(sed -n 's|^http_address *= *"[^:]*:\([0-9]*\)".*|\1|p' config.toml | head -1); port=${port:-4381}
if docker compose pull -q hypersnap && docker compose up -d hypersnap; then
  for _ in $(seq 1 60); do curl -fsS -m 5 "http://127.0.0.1:$port/v1/info" >/dev/null 2>&1 && { log "running $new"; exit 0; }; sleep 10; done
fi
log "$new did not answer in 10 minutes; back to $cur"
cp -p "docker-compose.yml.before-$new" docker-compose.yml
docker compose up -d hypersnap
exit 1
EOF
  chmod 755 "$UPGRADER"
}

do_status() {
  cron=$(crontab -l 2>/dev/null || true)
  show() { # name, tag, version
    local line; line=$(grep "# $2\$" <<<"$cron" || true)
    if [ -n "$line" ]; then printf '%s: auto-upgrade on, daily at %02d:%02d.' "$1" "$(cut -d' ' -f2 <<<"$line")" "$(cut -d' ' -f1 <<<"$line")"
    else printf '%s: auto-upgrade off (turn it on: fatline node autoupgrade on).' "$1"; fi
    echo " Running: ${3:-unknown}."
  }
  [ -n "$snap" ] && show Snapchain fatline-autoupgrade "$(ver 3381)"
  [ -n "$hyper" ] && show Hypersnap fatline-autoupgrade-hypersnap "$(ver 4381)"
  true
}

# ensure: from `fatline update` on a node's server. On, unless someone turned it off here.
if [ "$mode" = ensure ]; then
  if [ -f "$OPTOUT" ] || [ -n "${FATLINE_NO_AUTOUPGRADE:-}" ]; then mode=status; else mode=on-keep; fi
fi

case "$mode" in
  on|on-keep)
    [ "$mode" = on ] && rm -f "$OPTOUT"
    lines=$(crontab -l 2>/dev/null || true)
    if [ -n "$snap" ]; then
      # Snapchain's upgrade asks for an operator FID when .env has none; from cron nobody could answer.
      touch "$snap/.env"
      grep -q '^HUB_OPERATOR_FID=' "$snap/.env" || echo 'HUB_OPERATOR_FID=0' >> "$snap/.env"
      grep -q '^SKIP_CRONTAB=' "$snap/.env" || echo 'SKIP_CRONTAB=true' >> "$snap/.env"
      if ! grep -q '# fatline-autoupgrade$' <<<"$lines"; then
        lines=$(printf '%s\n%s' "$lines" "$((RANDOM % 60)) $((RANDOM % 24)) * * * cd $snap && ./snapchain.sh upgrade >> $snap/autoupgrade.log 2>&1 # fatline-autoupgrade")
      fi
    fi
    if [ -n "$hyper" ]; then
      write_upgrader
      if ! grep -q '# fatline-autoupgrade-hypersnap$' <<<"$lines"; then
        lines=$(printf '%s\n%s' "$lines" "$((RANDOM % 60)) $((RANDOM % 24)) * * * $UPGRADER $hyper >> $hyper/autoupgrade.log 2>&1 # fatline-autoupgrade-hypersnap")
      fi
    fi
    sed '/^$/d' <<<"$lines" | crontab -
    do_status
    ;;
  off)
    others=$(crontab -l 2>/dev/null | grep -v 'fatline-autoupgrade' || true)
    if [ -n "$others" ]; then echo "$others" | crontab -; else crontab -r 2>/dev/null || true; fi
    touch "$OPTOUT"
    echo "Auto-upgrade off. It stays off through fatline update; turn it on again: fatline node autoupgrade on"
    ;;
  status) do_status ;;
  *) echo "Usage: fatline node autoupgrade on|off|status"; exit 1 ;;
esac
