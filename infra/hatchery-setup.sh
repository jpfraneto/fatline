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
#   6. fatline update: this server's client at <surname>.fatline.ink, once its egg is laid.
#
# Env (optional): FATLINERS_ADDRESS (default: the one in smart-contracts/deployments/base.json), FATLINERS_CHAIN_ID,
# FATLINERS_RPC, HATCHERY_RELAY=1 (submit mints for people, paying gas from this server's key), FATLINE_REPO, FATLINE_BRANCH,
# FATLINE_REF (a commit on that branch: install exactly that one; join.sh passes the commit it was built from).
#
# The service runs locked down (infra/harden.sh, a systemd drop-in): no root powers, no new privileges, the whole
# filesystem read-only except /root/.fatline, private /tmp and /dev, internet sockets only.
# Check it: systemd-analyze security fatline-hatchery
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
  # One pinned Node.js release, checked against the hash written here (not one fetched next to the file).
  NODE_V=22.23.4
  case "$(uname -m)" in
    x86_64) f="node-v$NODE_V-linux-x64.tar.xz"; sum=1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce ;;
    aarch64|arm64) f="node-v$NODE_V-linux-arm64.tar.xz"; sum=6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b ;;
    *) echo "No Node.js build here for $(uname -m)."; exit 1 ;;
  esac
  command -v xz >/dev/null || apt-get install -y -qq xz-utils >/dev/null
  curl -fsSL "https://nodejs.org/dist/v$NODE_V/$f" -o "/tmp/$f"
  echo "$sum  /tmp/$f" | sha256sum -c --quiet - || { echo "Node.js download did not match its hash. Stopping."; rm -f "/tmp/$f"; exit 1; }
  tar -xJf "/tmp/$f" -C /usr/local --strip-components=1 && rm -f "/tmp/$f"
  hash -r
fi
echo "node $(node -v)"

say "2. Fatline"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch -q origin "$BRANCH"
else git clone -q --branch "$BRANCH" "$REPO" "$DIR"; fi
# A pinned commit must be one that is on the branch: nothing from anywhere else.
REF="${FATLINE_REF:-origin/$BRANCH}"
git -C "$DIR" merge-base --is-ancestor "$REF" "origin/$BRANCH" 2>/dev/null \
  || { echo "FATLINE_REF=$REF is not a commit on $BRANCH of $REPO. Stopping."; exit 1; }
git -C "$DIR" reset -q --hard "$REF" # stays on the branch, so a later fatline update moves forward from here
(cd "$DIR/indexer" && npm ci --omit=dev --ignore-scripts --silent --no-audit --no-fund) # the locked versions; no package runs an install script as root
echo "at $(git -C "$DIR" log -1 --format='%h %s' | cut -c1-80)"
ln -sf "$DIR/fatline" /usr/local/bin/fatline # fatline update, from anywhere on this server

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
Environment=HATCHERY_RELAY=${HATCHERY_RELAY:-0}
ExecStart=$(command -v node) --experimental-sqlite --no-warnings=ExperimentalWarning src/hatchery-run.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q fatline-hatchery
systemctl restart fatline-hatchery
# Locked down with a drop-in next to the unit: writes only $DATA, no root powers (infra/harden.sh).
bash "$DIR/infra/harden.sh" fatline-hatchery http://127.0.0.1:8791/ - "$DATA"

say "5. Port 8791"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 8791/tcp >/dev/null && echo "ufw: 8791/tcp open"; fi
# Sellers with their own firewall (AgentMetal boots with only SSH open). Only for servers Fatline rented:
# join.sh sets FATLINE_OWN_SERVER=1, so a server you run yourself never calls a seller's API.
self=""
[ "${FATLINE_OWN_SERVER:-}" = 1 ] || self=$(curl -fsS -m 10 https://api.agentmetal.dev/v1/self 2>/dev/null || true)
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

say "6. Your client at <surname>.fatline.ink (once your egg is laid; until then: later, with fatline update)"
# The client from this same commit (no pull: a pinned install stays pinned until you run fatline update).
"$DIR/fatline" _rebuild "$(git -C "$DIR" rev-parse --short HEAD)" < /dev/null 2>&1 | tail -5 || true
