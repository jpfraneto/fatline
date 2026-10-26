#!/usr/bin/env bash
# This server's client at https://<its surname>.fatline.ink. Run by fatline update on a node's server (root, with the
# hatchery); safe to run again. Does nothing until this server's egg is laid (that's when it has a name).
# The certificate is made and kept here; the master only passes the encrypted connection on.
# Signing in at that address works only for the egg's account (FATLINE_OWNER_FID).
set -euo pipefail
MASTER="${FATLINE_MASTER:-46.225.208.199}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA=/root/.fatline-client
PORT=8787

say() { printf '%s\n' "$*"; }
skip() { say "  Your client: $*"; exit 0; }
stop() { say "  Your client: $*"; exit 1; }

# Which name is mine? The master matches the address this request comes from against the eggs it checks.
# (Right after fatline update restarts a hatchery, it takes a few seconds to answer: on the master, this is it.)
mine=""
for i in $(seq 1 20); do mine=$(curl -fsS -m 15 "http://$MASTER:8791/names/mine" 2>/dev/null) && break; sleep 2; done
name=""; fid=""
read -r name fid < <(printf '%s' "$mine" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const n=JSON.parse(s).names?.[0];if(n)console.log(n.label,n.fid)}catch{}})') || true
[ -n "${name:-}" ] || skip "not yet (it gets an address once its egg is laid)."
host="$name.fatline.ink"

# The name must point at the master (one *.fatline.ink record), which passes the connection on to this server.
resolved=$(getent ahostsv4 "$host" 2>/dev/null | awk 'NR==1{print $1}' || true)
[ "$resolved" = "$MASTER" ] || skip "$host doesn't point at the master yet. Run fatline update again in a few minutes."

# Ports 80 and 443: Caddy needs them for the certificate and for https.
# (On the master, the names router holds them and Caddy sits behind it.)
busy=""
systemctl is-active --quiet fatline-names 2>/dev/null || busy=$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v caddy || true)
[ -z "$busy" ] || skip "ports 80/443 are taken by another program. Point $host at 127.0.0.1:$PORT in your web server."

mkdir -p "$DATA"; chmod 700 "$DATA"

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
Environment=FATLINE_OWNER_FID=$fid
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q fatline-client
systemctl restart fatline-client
for i in $(seq 1 30); do curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null || stop "Your client didn't start: journalctl -u fatline-client -n 50"
# Locked down (infra/harden.sh): writes only $DATA, no root powers.
bash "$DIR/infra/harden.sh" fatline-client "http://127.0.0.1:$PORT/api/health" - "$DATA"

# https at <name>.fatline.ink.
if [ -f /etc/caddy/Caddyfile ] && systemctl is-active --quiet caddy; then
  # A Caddy is already here (the master runs one): add a site to it.
  printf '# Written by fatline update: this server'"'"'s own client.\n%s {\n\tencode gzip\n\treverse_proxy 127.0.0.1:%s\n}\n' "$host" "$PORT" > /etc/caddy/fatline-client.caddy
  grep -q 'import /etc/caddy/fatline-client.caddy' /etc/caddy/Caddyfile || printf '\nimport /etc/caddy/fatline-client.caddy\n' >> /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || stop "Caddy refused the new config: caddy validate --config /etc/caddy/Caddyfile"
  systemctl reload caddy
else
  if [ ! -x /usr/local/bin/caddy ]; then
    # One pinned Caddy release from its GitHub page, checked against the hash written here.
    CADDY_V=2.11.7
    case "$(uname -m)" in
      x86_64) arch=amd64; sum=a7a433a1b133efc3c8d10eb0b99d52a24b5ef5c322dc77f5282182b1c0402139ab83f3a99f0c52409df77d20123fb0b523edad8a66d8f5e49136197bf61ef0e7 ;;
      aarch64|arm64) arch=arm64; sum=3db36ba90c7a6e8dda40ee3dd71fa08844c76b5fb08f61b31e5e78d2ed38e71c51dc7baed875e50d1ca1279196e84302967237386ae87c91ae9f2aaceada682e ;;
      *) stop "No Caddy build for $(uname -m)." ;;
    esac
    t="/tmp/caddy_${CADDY_V}_linux_$arch.tar.gz"
    curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v$CADDY_V/caddy_${CADDY_V}_linux_$arch.tar.gz" -o "$t"
    echo "$sum  $t" | sha512sum -c --quiet - || { rm -f "$t"; stop "the Caddy download did not match its hash."; }
    tar -xzf "$t" -C /usr/local/bin caddy && chmod 755 /usr/local/bin/caddy && rm -f "$t"
  fi
  mkdir -p /root/.local/share/caddy /root/.config/caddy
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
  systemctl is-active --quiet fatline-client-https || systemctl restart fatline-client-https
  # Locked down: it may bind ports 80 and 443 and keep its certificates, nothing more.
  bash "$DIR/infra/harden.sh" fatline-client-https - CAP_NET_BIND_SERVICE /root/.local/share/caddy /root/.config/caddy
fi
command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active" && { ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; }

for i in $(seq 1 40); do curl -fsS -m 5 "https://$host/api/health" >/dev/null 2>&1 && break; sleep 3; done
curl -fsS -m 5 "https://$host/api/health" >/dev/null 2>&1 && say "  Your client: https://$host (sign in with FID $fid)" \
  || say "  Your client: https://$host isn't answering yet (journalctl -u fatline-client-https -n 50; ports 80 and 443 open?)"
