#!/usr/bin/env bash
# Runs on a fresh Debian/Ubuntu server as root, from /opt/infinicaster.
# Installs Node.js, builds the indexer and apps, and starts them as services behind HTTPS.
#   INFINICASTER_IP       public IPv4, used for an automatic HTTPS name (<ip>.sslip.io)
#   INFINICASTER_NETWORK  farcaster | hypersnap (default network for readers)
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates tar xz-utils >/dev/null

case "$(uname -m)" in
  x86_64) NODE_ARCH=x64; GOARCH=amd64 ;;
  aarch64 | arm64) NODE_ARCH=arm64; GOARCH=arm64 ;;
  *) echo "Unsupported CPU $(uname -m)"; exit 1 ;;
esac

if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)'; then
  say "Node.js 22 (checksum verified)"
  BASE=https://nodejs.org/dist/latest-v22.x
  FILE=$(curl -fsSL "$BASE/SHASUMS256.txt" | awk -v a="linux-$NODE_ARCH.tar.xz" '$2 ~ a"$" {print $2}')
  curl -fsSL "$BASE/$FILE" -o "/tmp/$FILE"
  (cd /tmp && curl -fsSL "$BASE/SHASUMS256.txt" | grep " $FILE\$" | sha256sum -c -)
  tar -xJf "/tmp/$FILE" -C /usr/local --strip-components=1
  rm "/tmp/$FILE"
fi
node --version

say "Config"
if [ ! -f infinicaster.config.json ]; then
  cp infinicaster.config.example.json infinicaster.config.json
fi
if [ -n "${INFINICASTER_NETWORK:-}" ]; then
  node -e '
    const fs = require("fs"); const p = "infinicaster.config.json"; const c = JSON.parse(fs.readFileSync(p));
    if (!c.networks[process.argv[1]]) { console.error("unknown network " + process.argv[1]); process.exit(1); }
    c.defaultNetwork = process.argv[1]; fs.writeFileSync(p, JSON.stringify(c, null, 2));' "$INFINICASTER_NETWORK"
fi

say "Indexer and app"
(cd indexer && npm ci --omit=dev --no-audit --no-fund)
(cd apps/opinions && npm ci --no-audit --no-fund && npm run build)

say "The server's own wallet (keeper)"
mkdir -p .infinicaster
if [ ! -f .infinicaster/keeper.env ]; then
  (cd indexer && node -e 'import("viem/accounts").then(({ generatePrivateKey }) => console.log("KEEPER_PRIVATE_KEY=" + generatePrivateKey()))') > .infinicaster/keeper.env
  chmod 600 .infinicaster/keeper.env
fi
if [ -n "${INFINICASTER_VAULT:-}" ]; then echo "KEEPER_VAULT=$INFINICASTER_VAULT" >> .infinicaster/keeper.env; fi
KEEPER_ADDRESS=$(cd indexer && set -a && . ../.infinicaster/keeper.env && node -e 'import("viem/accounts").then(({ privateKeyToAccount }) => console.log(privateKeyToAccount(process.env.KEEPER_PRIVATE_KEY).address))')
echo "Keeper address: $KEEPER_ADDRESS"

say "Services"
cat > /etc/systemd/system/infinicaster.service <<EOF
[Unit]
Description=Infinicaster indexer and apps
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$APP_DIR/indexer
ExecStart=$(command -v node) --experimental-sqlite --no-warnings=ExperimentalWarning src/server.mjs
Environment=PORT=8787
EnvironmentFile=-$APP_DIR/.infinicaster/keeper.env
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

if [ -n "${INFINICASTER_IP:-}" ]; then
  HOST="${INFINICASTER_IP//./-}.sslip.io"
  if [ ! -x /usr/local/bin/caddy ]; then
    curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$GOARCH" -o /usr/local/bin/caddy
    chmod +x /usr/local/bin/caddy
  fi
  cat > /etc/systemd/system/infinicaster-https.service <<EOF
[Unit]
Description=HTTPS for Infinicaster ($HOST)
After=network-online.target infinicaster.service

[Service]
ExecStart=/usr/local/bin/caddy reverse-proxy --from $HOST --to localhost:8787
Environment=HOME=/root
Restart=always

[Install]
WantedBy=multi-user.target
EOF
fi

systemctl daemon-reload
systemctl enable --now infinicaster.service
[ -n "${INFINICASTER_IP:-}" ] && systemctl enable --now infinicaster-https.service

say "Health"
for _ in $(seq 1 20); do
  if curl -fsS localhost:8787/api/health >/dev/null; then break; fi
  sleep 1
done
curl -fsS localhost:8787/api/health && echo
echo "Done. Local: http://localhost:8787${HOST:+   Public: https://$HOST}"
echo
echo "To let this server pay for its own life, the app's vault owner sets it as keeper:"
echo "  cast send <vault> 'setKeeper(address)' $KEEPER_ADDRESS   (from the owner wallet or Safe)"
echo "Then send it a little ETH on Base for gas (a few cents lasts months)."
echo "It will pay itself from the vault every day and renew this server over x402 before it expires."
