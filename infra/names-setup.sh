#!/usr/bin/env bash
# The names router on the master (run as root on the master; safe to re-run):
#   <surname>.fatline.ink → the server that runs that Fatliner's node (infra/names-router.mjs).
# It takes ports 80 and 443; Caddy (the site, the hatchery's https, the master's own client) moves behind it to
# 127.0.0.1:8080 and :8443. The switch takes a second or two. If the router doesn't come up, Caddy gets 80 and 443 back.
# Needs: the hatchery (GET /names on :8791), Caddy with /etc/caddy/Caddyfile, and one DNS record: *.fatline.ink → this IP.
#   names-setup.sh off   puts Caddy back on 80 and 443 and removes the router.
set -euo pipefail
DIR=/root/fatline
SELF="${NAMES_SELF:-$(curl -fsS -m 8 https://api.ipify.org)}"
GLOBAL=$'{\n\thttp_port 8080\n\thttps_port 8443\n\tdefault_bind 127.0.0.1\n}'

caddy_behind() { # move Caddy to 8080/8443 (adds the global block once)
  grep -q '^\s*https_port 8443' /etc/caddy/Caddyfile || { printf '%s\n' "$GLOBAL" | cat - /etc/caddy/Caddyfile > /etc/caddy/Caddyfile.new && mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile; }
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  systemctl reload caddy
}
caddy_front() { # Caddy back on 80/443
  node -e 'const fs=require("fs");const p="/etc/caddy/Caddyfile";fs.writeFileSync(p,fs.readFileSync(p,"utf8").replace(/^\{\n\thttp_port 8080\n\thttps_port 8443\n\tdefault_bind 127\.0\.0\.1\n\}\n/,""))'
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  systemctl reload caddy
}

if [ "${1:-}" = off ]; then
  systemctl disable -q --now fatline-names 2>/dev/null || true
  rm -f /etc/systemd/system/fatline-names.service; systemctl daemon-reload
  caddy_front
  echo "Router removed; Caddy is on 80 and 443 again."; exit 0
fi

[ -f "$DIR/infra/names-router.mjs" ] || { echo "No $DIR/infra/names-router.mjs: update Fatline first (infra/hatchery-setup.sh)."; exit 1; }
curl -fsS -m 5 http://127.0.0.1:8791/names >/dev/null || { echo "The hatchery doesn't answer GET /names on :8791 (update and restart it first)."; exit 1; }

cat > /etc/systemd/system/fatline-names.service <<EOF
[Unit]
Description=Fatline names router (*.fatline.ink → each Fatliner's own server; this server's names → Caddy)
After=network-online.target fatline-hatchery.service caddy.service

[Service]
ExecStart=$(command -v node) $DIR/infra/names-router.mjs
Environment=NAMES_SELF=$SELF
Environment=NAMES_CACHE=/root/.fatline/names-cache.json
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

if systemctl is-active --quiet fatline-names; then
  systemctl restart fatline-names
else
  caddy_behind
  sleep 1
  systemctl enable -q fatline-names
  systemctl start fatline-names
fi
sleep 2
if ! systemctl is-active --quiet fatline-names || ! ss -ltnH '( sport = :443 )' | grep -q .; then
  echo "The router didn't come up; giving Caddy 80 and 443 back."
  journalctl -u fatline-names -n 20 --no-pager || true
  systemctl disable -q --now fatline-names || true
  caddy_front
  exit 1
fi
journalctl -u fatline-names -n 3 --no-pager | cut -c1-200
echo "Router on 80 and 443 (this server: $SELF). Caddy behind it on 127.0.0.1:8080 and :8443."
