#!/usr/bin/env bash
# Bring a Farcaster node you already run into Fatline:   curl -fsSL https://fatline.ink/join.sh | sudo bash
#
# Run it on the server where your Snapchain or Hypersnap node runs (Debian/Ubuntu, root). What it does, in order,
# asking before it changes anything:
#   1. finds your node on this machine (Snapchain on port 3381, Hypersnap on 4381) and shows its version and sync;
#   2. installs the hatchery next to it (infra/hatchery-setup.sh: Node 22, Fatline in /root/fatline, a key of
#      this server's own, a service on port 8791). The hatchery is what keeps an egg warm: other servers check
#      your node every hour, and once your egg hatches, your server checks theirs;
#   3. Snapchain only: offers auto-upgrade (a daily ./snapchain.sh upgrade);
#   4. prints how to lay your egg, from any computer, with the wallet tied to your Farcaster account.
# Your node itself is not touched. --check only looks (step 1) and changes nothing.
# Source: https://github.com/jpfraneto/fatline/blob/main/apps/site/join.sh · MIT
set -euo pipefail
RAW="${FATLINE_RAW:-https://raw.githubusercontent.com/jpfraneto/fatline/main}"
CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1

say() { printf '%s\n' "$*"; }
stop() { say ""; say "  $*"; exit 1; }
ask() { # ask "question": yes only with a terminal and a y
  [ -r /dev/tty ] && { : < /dev/tty; } 2>/dev/null || return 1
  printf '  %s [y/N] ' "$1" > /dev/tty; read -r ans < /dev/tty
  case "$ans" in y|Y|yes) return 0 ;; *) return 1 ;; esac
}
command -v curl >/dev/null || stop "curl is missing: apt-get install -y curl"

say ""
say "  FATLINE · bring your node"
say ""

# 1. The node(s) on this machine.
found=""
for pair in "snapchain:3381" "hypersnap:4381"; do
  net="${pair%%:*}"; port="${pair##*:}"
  info=$(curl -fsS -m 8 "http://127.0.0.1:$port/v1/info" 2>/dev/null || true)
  [ -n "$info" ] || continue
  found="$found $net"
  version=$(printf '%s' "$info" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
  # The worst delay over the data shards (shard 0 only carries the others' block headers).
  worst=$(printf '%s' "$info" | grep -o '"shardId":[0-9]*,[^}]*"blockDelay":[0-9]*' | grep -v '"shardId":0,' | grep -o '"blockDelay":[0-9]*' | cut -d: -f2 | sort -n | tail -1)
  msgs=$(printf '%s' "$info" | grep -o '"numMessages":[0-9]*' | head -1 | cut -d: -f2)
  if [ -z "$worst" ]; then sync="sync unknown"
  elif [ "$worst" -le 200 ]; then sync="in sync (${worst} blocks behind at most)"
  else sync="catching up (${worst} blocks behind): that's fine, an egg stays warm while it gets closer"; fi
  label=$([ "$net" = snapchain ] && echo Snapchain || echo Hypersnap)
  say "  ✓ $label ${version:-?} on port $port · ${msgs:-?} messages · $sync"
done
[ -n "$found" ] || stop "No node answers here on port 3381 (Snapchain) or 4381 (Hypersnap). Run this on the node's own server. No node yet? Ask your agent: Help me run a Fatline: https://fatline.ink/skill.md"

ip=$(curl -fsS -m 8 https://api.ipify.org 2>/dev/null || true)
say ""
say "  Other servers check your node from outside, so these must be open to the internet:"
say "    tcp 3381 (Snapchain) or tcp 4381 (Hypersnap), and tcp 8791 (the hatchery)."
if [ "$CHECK" = 1 ]; then
  say ""; say "  --check: nothing was changed. Run without it to join."; exit 0
fi
if systemctl is-active --quiet fatline-hatchery 2>/dev/null; then
  say ""; say "  This server already runs a hatchery. Going on updates it (its key is kept)."
fi

[ "$(id -u)" = 0 ] || stop "The hatchery installs a system service: run this as root (curl -fsSL https://fatline.ink/join.sh | sudo bash)."
command -v apt-get >/dev/null || stop "The hatchery's setup needs Debian or Ubuntu (apt). Other systems: open an issue at https://github.com/jpfraneto/fatline/issues"

# 2. The hatchery.
say ""
ask "Install the hatchery next to your node (Node 22, Fatline in /root/fatline, port 8791)?" \
  || stop "Nothing was changed. Read what it runs first: $RAW/infra/hatchery-setup.sh"
curl -fsSL "$RAW/infra/hatchery-setup.sh" | bash

# 3. Auto-upgrade, for Snapchain.
case "$found" in *snapchain*)
  say ""
  if crontab -l 2>/dev/null | grep -q fatline-autoupgrade; then say "  Snapchain auto-upgrade is already on."
  elif ask "Turn on Snapchain auto-upgrade (checks for a new version once a day; it only restarts on a new one)?"; then
    bash /root/fatline/infra/autoupgrade.sh on
  fi ;;
esac

# 4. The egg.
net1=$(echo $found | cut -d' ' -f1); port=$([ "$net1" = snapchain ] && echo 3381 || echo 4381)
say ""
say "  Your node is part of Fatline now. Next, your egg (one per Farcaster account), from any computer:"
say "    ask your agent:  Help me run a Fatline: https://fatline.ink/skill.md  (say: my node is http://${ip:-<this server>}:$port)"
say "    or by hand:      curl -fsSL https://fatline.ink/install.sh | sh   then   fatline egg --node http://${ip:-<this server>}:$port"
say "  The egg is minted to the wallet tied to your account (you scan a QR code). Three warm days, and it hatches."
say ""
