#!/usr/bin/env bash
# Your client at https://<your surname>.fatline.ink:   curl -fsSL https://fatline.ink/client.sh | sudo bash
#
# Run it on your node's server, after join.sh (the hatchery) and once your egg is laid. What it does, asking first:
#   1. asks the master hatchery which name is yours: your egg's surname, matched by this server's address;
#   2. builds the default Fatline client (in /root/fatline) and runs it as a service, fatline-client, on
#      127.0.0.1:8787, reading your own node; its data and write token are in /root/.fatline-client;
#   3. serves it over https at <surname>.fatline.ink with Caddy (ports 80 and 443). The certificate is made and kept
#      here: the master only passes the encrypted connection on, so it can't read your pages or your write token;
#   4. prints your link, with the write token in it once. Open it in your browser and you can cast from there.
# Source: https://github.com/jpfraneto/fatline/blob/main/apps/site/client.sh · MIT
set -euo pipefail
RAW="${FATLINE_RAW:-https://raw.githubusercontent.com/jpfraneto/fatline/main}"
MASTER="${FATLINE_MASTER:-46.225.208.199}"
DIR=/root/fatline
DATA=/root/.fatline-client
PORT=8787

say() { printf '%s\n' "$*"; }
stop() { say ""; say "  $*"; exit 1; }
ask() { # ask "question": yes only with a terminal and a y (or FATLINE_YES=1: the person already said yes)
  [ "${FATLINE_YES:-}" = 1 ] && { printf '  %s yes (FATLINE_YES=1)\n' "$1"; return 0; }
  [ -r /dev/tty ] && { : < /dev/tty; } 2>/dev/null || return 1
  printf '  %s [y/N] ' "$1" > /dev/tty; read -r ans < /dev/tty
  case "$ans" in y|Y|yes) return 0 ;; *) return 1 ;; esac
}

say ""
say "  FATLINE · your client at <name>.fatline.ink"
say ""
[ "$(id -u)" = 0 ] || stop "This installs system services: run it as root (curl -fsSL https://fatline.ink/client.sh | sudo bash)."
command -v curl >/dev/null || stop "curl is missing: apt-get install -y curl"
[ -d "$DIR/.git" ] && command -v node >/dev/null || stop "Fatline isn't on this server yet. First: curl -fsSL https://fatline.ink/join.sh | sudo bash"

# 1. Which name is mine? The master matches the address this request comes from against the eggs it checks.
mine=$(curl -sS -m 15 "http://$MASTER:8791/names/mine" || true)
name=$(printf '%s' "$mine" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.names?.length)console.log(j.names[0].label);else console.error(j.error??s)}catch{console.error(s||"no answer")}})' 2>/tmp/fatline-name.err || true)
[ -n "$name" ] || stop "No name for this server yet: $(cat /tmp/fatline-name.err). Your name is your egg's surname; it exists once your egg is laid (fatline egg)."
host="$name.fatline.ink"
say "  ✓ Your name: $host"

# The name must point at the master (one *.fatline.ink record), which passes the connection on to this server.
resolved=$(getent ahostsv4 "$host" 2>/dev/null | awk 'NR==1{print $1}' || true)
[ "$resolved" = "$MASTER" ] || stop "$host doesn't point at the Fatline master yet (it gives '${resolved:-nothing}'). Try again in a few minutes."

# Ports 80 and 443: Caddy needs them for the certificate and for https.
# (On the master, the names router holds them and Caddy sits behind it.)
busy=""
systemctl is-active --quiet fatline-names 2>/dev/null || busy=$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v caddy || true)
[ -z "$busy" ] || stop "Something other than Caddy already uses port 80 or 443 here:
$busy
  Free them, or put $host → 127.0.0.1:$PORT in the web server you run."

say ""
ask "Serve your client at https://$host (builds it, a service on 127.0.0.1:$PORT, Caddy on ports 80 and 443)?" \
  || stop "Nothing was changed. Read what it runs first: $RAW/apps/site/client.sh"

# 2. The client: the newest Fatline (this also updates and restarts the hatchery; its key is kept), then the app.
say ""; say "  Updating Fatline and the hatchery…"
curl -fsSL "$RAW/infra/hatchery-setup.sh" | bash >/tmp/fatline-hatchery.log 2>&1 || { tail -20 /tmp/fatline-hatchery.log; stop "Updating failed (log above, full log in /tmp/fatline-hatchery.log)."; }
say "  Building the client…"
(cd "$DIR/apps/opinions" && npm ci --silent --no-audit --no-fund && npm run build --silent) >/tmp/fatline-client-build.log 2>&1 \
  || { tail -20 /tmp/fatline-client-build.log; stop "The build failed (log above)."; }

mkdir -p "$DATA"; chmod 700 "$DATA"
[ -s "$DATA/write.token" ] || { (umask 077; openssl rand -hex 32 > "$DATA/write.token" 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))' > "$DATA/write.token"); }
chmod 600 "$DATA/write.token"
token=$(cat "$DATA/write.token")

cat > /etc/systemd/system/fatline-client.service <<EOF
[Unit]
Description=Fatline client ($host), reading this server's own node
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$DIR/indexer
ExecStart=$(command -v node) --experimental-sqlite --no-warnings=ExperimentalWarning src/server.mjs
Environment=PORT=$PORT
Environment=FATLINE_BIND=127.0.0.1
Environment=FATLINE_DATA=$DATA
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q fatline-client
systemctl restart fatline-client
for i in $(seq 1 30); do curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null || stop "The client didn't start: journalctl -u fatline-client -n 50"
say "  ✓ The client runs on 127.0.0.1:$PORT"

# 3. https at <name>.fatline.ink.
if [ -f /etc/caddy/Caddyfile ] && systemctl is-active --quiet caddy; then
  # A Caddy is already here (the master runs one): add a site to it.
  printf '# Written by Fatline (client.sh): this server'"'"'s own client.\n%s {\n\tencode gzip\n\treverse_proxy 127.0.0.1:%s\n}\n' "$host" "$PORT" > /etc/caddy/fatline-client.caddy
  grep -q 'import /etc/caddy/fatline-client.caddy' /etc/caddy/Caddyfile || printf '\nimport /etc/caddy/fatline-client.caddy\n' >> /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || stop "Caddy refused the new config: caddy validate --config /etc/caddy/Caddyfile"
  systemctl reload caddy
else
  if [ ! -x /usr/local/bin/caddy ]; then
    case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) stop "No Caddy build for $(uname -m)." ;; esac
    curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$arch" -o /usr/local/bin/caddy
    chmod +x /usr/local/bin/caddy
  fi
  cat > /etc/systemd/system/fatline-client-https.service <<EOF
[Unit]
Description=https for the Fatline client at $host
After=network-online.target fatline-client.service

[Service]
Environment=HOME=/root
ExecStart=/usr/local/bin/caddy reverse-proxy --from $host --to 127.0.0.1:$PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable -q fatline-client-https
  systemctl restart fatline-client-https
fi
command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active" && { ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; }

say "  Getting its certificate (up to a minute or two)…"
ok=""
for i in $(seq 1 40); do curl -fsS -m 5 "https://$host/api/health" >/dev/null 2>&1 && { ok=1; break; }; sleep 3; done
[ -n "$ok" ] || say "  Not answering over https yet. Check: journalctl -u fatline-client-https -n 50 (or -u caddy), and that ports 80 and 443 are open to the internet."

# 4. The link.
say ""
say "  Your client:  https://$host"
say ""
say "  To cast from it, open this link once in your own browser. It keeps the write token there:"
say "    https://$host/#key=$token"
say "  Don't share that link: anyone with it can cast through your client. The token is in $DATA/write.token."
say "  Then press Cast to give this client its own key for your account (a QR code for the Farcaster app)."
say ""
