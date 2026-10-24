#!/usr/bin/env bash
# The hatchery, on a Fatline server, next to its node. Run as root on the server (fatline hatchery install
# does it over SSH). Safe to re-run: it updates the code and restarts the service; the key is kept.
#
# What it does:
#   1. Node.js 22 and git, if missing.
#   2. Fatline in /root/fatline (cloned, or pulled if it is there).
#   3. This server's attester key in /root/.fatline/attester.key (mode 600), made once.
#   4. A systemd service, fatline-hatchery, that checks eggs every hour against this server's own node
#      (127.0.0.1:3381, and 4381 for Hypersnap) and signs the ones that hatch. It restarts by itself.
#   5. Port 8791 open, so other servers and clients can reach it.
#
# Env (optional): FATLINERS_ADDRESS, FATLINERS_CHAIN_ID (8453), FATLINERS_RPC, FATLINE_REPO, FATLINE_BRANCH.
set -euo pipefail
say() { printf '\n== %s\n' "$*"; }

REPO="${FATLINE_REPO:-https://github.com/jpfraneto/fatline}"
BRANCH="${FATLINE_BRANCH:-main}"
DIR=/root/fatline
DATA=/root/.fatline

say "1. Tools"
command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git >/dev/null; }
command -v jq >/dev/null || { apt-get update -qq && apt-get install -y -qq jq >/dev/null; }
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node -v)"

say "2. Fatline"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else git clone -q --branch "$BRANCH" "$REPO" "$DIR"; fi
(cd "$DIR/indexer" && npm ci --omit=dev --silent --no-audit --no-fund)
echo "at $(git -C "$DIR" log -1 --format='%h %s' | cut -c1-80)"

say "3. This server's attester key"
mkdir -p "$DATA"
(cd "$DIR/indexer" && FATLINE_DATA="$DATA" node --experimental-sqlite --no-warnings=ExperimentalWarning src/hatchery-run.mjs init)

say "4. The service"
cat > /etc/systemd/system/fatline-hatchery.service <<EOF
[Unit]
Description=Fatline hatchery (checks eggs, signs the ones that hatch)
After=network-online.target docker.service

[Service]
WorkingDirectory=$DIR/indexer
Environment=FATLINE_DATA=$DATA
Environment=FATLINERS_ADDRESS=${FATLINERS_ADDRESS:-}
Environment=FATLINERS_CHAIN_ID=${FATLINERS_CHAIN_ID:-8453}
Environment=FATLINERS_RPC=${FATLINERS_RPC:-https://mainnet.base.org}
ExecStart=$(command -v node) --experimental-sqlite --no-warnings=ExperimentalWarning src/hatchery-run.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q fatline-hatchery
systemctl restart fatline-hatchery

say "5. Port 8791"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 8791/tcp >/dev/null && echo "ufw: 8791/tcp open"; fi
# Sellers with their own firewall (AgentMetal boots with only SSH open).
self=$(curl -fsS -m 10 https://api.agentmetal.dev/v1/self 2>/dev/null || true)
id=$(printf '%s' "$self" | jq -r '.server_id // empty' 2>/dev/null || true)
if [ -n "$id" ] && [ "$(echo "$self" | jq -r '.firewall.managed // false')" = true ] \
   && ! echo "$self" | jq -e '.firewall.rules[]? | select(.protocol == "tcp" and .port == "8791")' >/dev/null; then
  curl -fsS -m 15 -X POST "https://api.agentmetal.dev/v1/servers/$id/firewall/rules" -H 'content-type: application/json' \
    -d '{"protocol":"tcp","port":"8791","description":"Fatline hatchery"}' >/dev/null \
    && echo "Opened tcp/8791 in the seller's firewall" || echo "FATLINE_WARNING: could not open tcp/8791 in the seller's firewall"
fi

for i in $(seq 1 30); do curl -fsS -m 3 http://127.0.0.1:8791/ >/dev/null 2>&1 && break; sleep 1; done
if curl -fsS -m 3 http://127.0.0.1:8791/ >/dev/null 2>&1; then
  echo "FATLINE_HATCHERY $(curl -fsS http://127.0.0.1:8791/ | jq -r .attester)"
else
  echo "The hatchery did not answer. See: journalctl -u fatline-hatchery -n 50"; exit 1
fi
