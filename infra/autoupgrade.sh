#!/usr/bin/env bash
# Snapchain auto-upgrade for a node that is already running: fatline node autoupgrade on|off|status.
# Runs on the node's machine (fatline pipes it over SSH for a rented server). "on" adds one crontab line that
# runs Snapchain's own ./snapchain.sh upgrade once a day at a random time; it only restarts the node when there
# is a new version. Why daily: v0.15.0 shipped on 2026-10-23 with a protocol change active the same day.
set -euo pipefail
mode="${1:-status}"
d=""
for x in /root/snapchain "$HOME/snapchain"; do [ -x "$x/snapchain.sh" ] && { d="$x"; break; }; done
[ -n "$d" ] || { echo "No Snapchain node here (looked for snapchain.sh in /root/snapchain and ~/snapchain)."; exit 1; }
version=$(curl -s -m 5 localhost:3381/v1/info | grep -o '"version":"[^"]*"' | cut -d'"' -f4 || true)
others=$(crontab -l 2>/dev/null | grep -v 'fatline-autoupgrade' || true)

case "$mode" in
  on)
    # Snapchain's upgrade asks for an operator FID when .env has none; from cron nobody could answer.
    touch "$d/.env"
    grep -q '^HUB_OPERATOR_FID=' "$d/.env" || echo 'HUB_OPERATOR_FID=0' >> "$d/.env"
    grep -q '^SKIP_CRONTAB=' "$d/.env" || echo 'SKIP_CRONTAB=true' >> "$d/.env"
    m=$((RANDOM % 60)); h=$((RANDOM % 24))
    { [ -n "$others" ] && echo "$others"; echo "$m $h * * * cd $d && ./snapchain.sh upgrade >> $d/autoupgrade.log 2>&1 # fatline-autoupgrade"; } | crontab -
    printf 'Auto-upgrade on: Snapchain checks for a new version every day at %02d:%02d (this machine'"'"'s time).\n' "$h" "$m"
    echo "Running now: ${version:-unknown}. Log: $d/autoupgrade.log. Upgrade right now by hand: cd $d && ./snapchain.sh upgrade"
    ;;
  off)
    if [ -n "$others" ]; then echo "$others" | crontab -; else crontab -r 2>/dev/null || true; fi
    echo "Auto-upgrade off. Running: ${version:-unknown}. Upgrade by hand: cd $d && ./snapchain.sh upgrade"
    ;;
  status)
    line=$(crontab -l 2>/dev/null | grep 'fatline-autoupgrade' || true)
    if [ -n "$line" ]; then printf 'Auto-upgrade on: daily at %02d:%02d.' "$(echo "$line" | cut -d' ' -f2)" "$(echo "$line" | cut -d' ' -f1)"
    else printf 'Auto-upgrade off (turn it on: fatline node autoupgrade on).'; fi
    echo " Running: ${version:-unknown}."
    ;;
  *) echo "Usage: fatline node autoupgrade on|off|status"; exit 1 ;;
esac
