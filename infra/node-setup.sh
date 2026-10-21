#!/usr/bin/env bash
# Turns a fresh Linux server into a Farcaster read node (Snapchain), unattended.
# Run as root on the server. ./infinicaster compute --node does this for you.
#
#   INFINICASTER_BLOCKS=1day     keep this much block history (Snapchain pruning.block_retention); "all" keeps everything
#   INFINICASTER_SNAPSHOT=stream stream the starting snapshot straight to disk (needs ~1 copy of space);
#                        snapchain uses Snapchain's own download (keeps ~3 copies at its peak)
#
# Safe to re-run: finished steps are skipped, and an interrupted snapshot shard starts over.
set -euo pipefail

BLOCKS="${INFINICASTER_BLOCKS:-1day}"
SNAPSHOT="${INFINICASTER_SNAPSHOT:-stream}"
SNAPSHOT_URL="https://pub-d352dd8819104a778e20d08888c5a661.r2.dev/FARCASTER_NETWORK_MAINNET"
SHARDS="0 1 2"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# 1. Put the node's data on the biggest disk: an attached volume if there is one.
VOLUME=$(ls -d /mnt/HC_Volume_* 2>/dev/null | head -1 || true)
DATA="${VOLUME:-/root}/snapchain"
mkdir -p "$DATA"
if [ "$DATA" != /root/snapchain ] && [ ! -e /root/snapchain ]; then ln -s "$DATA" /root/snapchain; fi
cd /root/snapchain
say "Node data lives in $DATA ($(df -h "$DATA" | awk 'NR==2 {print $4}') free)"

# 2. Snapchain asks for 16 GB of RAM. On smaller machines, add swap so it doesn't get killed.
RAM_GB=$(awk '/MemTotal/ {print int($2/1024/1024)}' /proc/meminfo)
if [ "$RAM_GB" -lt 15 ] && ! swapon --show | grep -q .; then
  # On the server's own disk, so every GB of the paid volume goes to the node.
  say "This machine has ${RAM_GB} GB of RAM; adding 16 GB of swap"
  fallocate -l 16G /swapfile && chmod 600 /swapfile
  mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

# 3. Tools.
command -v jq >/dev/null || { apt-get update -qq && apt-get install -y -qq jq >/dev/null; }
if ! command -v docker >/dev/null; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi

# 4. Snapchain's own management script, with its questions answered up front:
#    no rewards for read nodes (true), and no operator FID.
curl -fsSL "https://raw.githubusercontent.com/farcasterxyz/snapchain/@latest/scripts/snapchain.sh" -o snapchain.sh
chmod +x snapchain.sh
touch .env
grep -q '^AGREE_NO_REWARDS_FOR_ME=' .env || echo 'AGREE_NO_REWARDS_FOR_ME=true' >> .env
grep -q '^HUB_OPERATOR_FID=' .env || echo 'HUB_OPERATOR_FID=0' >> .env

# 5. Our settings live in an override file that Snapchain's upgrades never touch.
{
  echo "# Written by Infinicaster (infra/node-setup.sh)."
  echo "services:"
  echo "  snapchain:"
  echo "    environment:"
  if [ "$BLOCKS" != all ]; then echo "      SNAPCHAIN_PRUNING__BLOCK_RETENTION: \"$BLOCKS\""; fi
  echo "      SNAPCHAIN_SNAPSHOT__LOAD_DB_FROM_SNAPSHOT: \"$([ "$SNAPSHOT" = snapchain ] && echo true || echo false)\""
} > docker-compose.override.yml

# 6. The starting snapshot, streamed: download -> unzip -> unpack, one copy on disk.
#    Snapchain's own loader keeps every compressed piece, then a full tar, then the database.
if [ "$SNAPSHOT" = stream ]; then
  mkdir -p .rocks
  for shard in $SHARDS; do
    [ -f ".snapshot-shard-$shard.done" ] && continue
    meta=$(curl -fsS "$SNAPSHOT_URL/$shard/latest.json")
    key=$(echo "$meta" | jq -r .key_base)
    total=$(echo "$meta" | jq '.chunks | length')
    say "Streaming snapshot shard $shard: $total pieces of ~70 MB"
    rm -rf ".rocks/shard-$shard"
    n=0
    echo "$meta" | jq -r '.chunks[]' | while read -r chunk; do
      n=$((n + 1)); [ $((n % 100)) -eq 0 ] && echo "  shard $shard: $n/$total ($(du -sh .rocks | cut -f1) on disk)" >&2
      curl -fsS --retry 10 --retry-delay 10 --retry-all-errors "$SNAPSHOT_URL/$key/$chunk"
    done | gunzip | tar -x -C .rocks
    touch ".snapshot-shard-$shard.done"
  done
  say "Snapshot unpacked: $(du -sh .rocks | cut -f1)"
fi

# 7. Start it. Snapchain's script installs the compose file, Grafana and its weekly auto-upgrade.
say "Starting Snapchain"
setsid nohup ./snapchain.sh upgrade < /dev/null > upgrade.log 2>&1 &
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:3381/v1/info >/dev/null 2>&1 && break
  sleep 10
done
curl -fsS http://127.0.0.1:3381/v1/info >/dev/null 2>&1 \
  && say "Snapchain is answering on 127.0.0.1:3381. It now catches up with the blocks since the snapshot." \
  || { echo "Snapchain did not answer in 10 minutes. See /root/snapchain/upgrade.log and: docker compose logs snapchain"; exit 1; }

echo "Disk used by the node: $(du -sh .rocks | cut -f1). Check sync with: curl -s localhost:3381/v1/info | jq '.shardInfos[] | {shardId, blockDelay}'"
