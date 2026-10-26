#!/usr/bin/env bash
# Locks down one of Fatline's systemd services with a drop-in file next to it, so the service's own unit (and
# anything you changed in it) stays as it is:
#   harden.sh <unit> <health url, or -> <capability, or -> <writable path>...
# The service can then read the system, write only the paths given, open internet sockets, and nothing more:
# no root powers (or just the one capability given), no new privileges, private /tmp and /dev, no kernel tunables.
# It restarts the service and, if it doesn't answer at the health URL within a minute, takes the drop-in away
# again and says so: a lockdown never leaves a service down.
# Undo by hand: rm /etc/systemd/system/<unit>.service.d/fatline-hardening.conf && systemctl daemon-reload
# Check it: systemd-analyze security <unit>
set -euo pipefail
unit="$1"; health="$2"; cap="$3"; shift 3
[ "$(id -u)" = 0 ] && command -v systemctl >/dev/null || exit 0
systemctl cat "$unit" >/dev/null 2>&1 || exit 0
dir="/etc/systemd/system/$unit.service.d"
file="$dir/fatline-hardening.conf"
for p in "$@"; do mkdir -p "$p"; done
[ "$cap" = - ] && cap=""

mkdir -p "$dir"
new=$(cat <<EOF
# Written by Fatline (infra/harden.sh). Remove this file to undo; fatline update writes it again.
[Service]
UMask=0077
NoNewPrivileges=yes
CapabilityBoundingSet=$cap
AmbientCapabilities=$cap
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$*
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
ProtectProc=invisible
RestrictSUIDSGID=yes
RestrictRealtime=yes
RestrictNamespaces=yes
LockPersonality=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallArchitectures=native
SystemCallFilter=@system-service
EOF
)
old=$(cat "$file" 2>/dev/null || true)
[ "$new" = "$old" ] && systemctl is-active --quiet "$unit" && exit 0
printf '%s\n' "$new" > "$file"
systemctl daemon-reload
systemctl restart "$unit"

answers() {
  for i in $(seq 1 30); do
    systemctl is-active --quiet "$unit" || { sleep 2; continue; }
    [ "$health" = - ] && { sleep 3; systemctl is-active --quiet "$unit"; return; }
    curl -fsS -m 3 "$health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}
if answers; then
  echo "  $unit: locked down (systemd-analyze security $unit)"
else
  rm -f "$file"; systemctl daemon-reload; systemctl restart "$unit"
  echo "  FATLINE_WARNING: $unit did not answer when locked down, so it runs as before. Please open an issue with:"
  echo "    journalctl -u $unit -n 50   (https://github.com/jpfraneto/fatline/issues)"
fi
