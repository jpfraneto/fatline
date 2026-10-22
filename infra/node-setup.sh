#!/usr/bin/env bash
# Turns a fresh Linux server into a Farcaster read node (Snapchain), unattended.
# Run as root on the server. ./infinicaster compute --node does this for you.
#
#   INFINICASTER_BLOCKS=1day     keep this much block history (Snapchain pruning.block_retention); "all" keeps everything
#   INFINICASTER_SNAPSHOT=stream    stream the starting snapshot straight to disk (needs ~1 copy of space, ~600 GB)
#                        replicate copy only the current state from other nodes, no old blocks (smallest; experimental)
#                        snapchain use Snapchain's own download (keeps ~3 copies at its peak)
#   INFINICASTER_REPLICATION_PEERS=http://IP:3383[,http://IP2:3383]
#                        with replicate: which nodes to copy state from. Snapchain's default is rho.farcaster.xyz,
#                        which answers "Unimplemented" (it sits behind a proxy), so point it at a node that serves it.
#
# Safe to re-run: finished steps are skipped, and an interrupted snapshot shard starts over.
set -euo pipefail

BLOCKS="${INFINICASTER_BLOCKS:-1day}"
SNAPSHOT="${INFINICASTER_SNAPSHOT:-stream}"
# The bucket root. latest.json lives under FARCASTER_NETWORK_MAINNET/<shard>/, and its key_base already
# starts with FARCASTER_NETWORK_MAINNET/, so chunks are fetched from the root.
SNAPSHOT_BUCKET="https://pub-d352dd8819104a778e20d08888c5a661.r2.dev"
SNAPSHOT_URL="$SNAPSHOT_BUCKET/FARCASTER_NETWORK_MAINNET"
SHARDS="0 1 2"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# 1. Put the node's data on the biggest disk: an attached volume if there is one.
# With several volumes (e.g. a Hypersnap one on the same server): INFINICASTER_VOLUME wins, then the
# volume that already holds a snapchain folder, then the first one.
VOLUME="${INFINICASTER_VOLUME:-}"
if [ -z "$VOLUME" ]; then
  VOLUME=$(ls -d /mnt/HC_Volume_*/snapchain 2>/dev/null | head -1 | xargs -r dirname || true)
  [ -n "$VOLUME" ] || VOLUME=$(ls -d /mnt/HC_Volume_* 2>/dev/null | head -1 || true)
fi
DATA="${VOLUME:-/root}/snapchain"
mkdir -p "$DATA"
# A volume added after an earlier run: move that run's (small) folder onto the volume.
if [ "$DATA" != /root/snapchain ] && [ -d /root/snapchain ] && [ ! -L /root/snapchain ]; then
  (cd /root/snapchain && docker compose down >/dev/null 2>&1 || true)
  cp -a /root/snapchain/. "$DATA"/ && rm -rf /root/snapchain
fi
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
# Snapchain's weekly auto-upgrade picks its day from the operator's FID. Without one it stops, so skip it
# (re-run ./snapchain.sh upgrade by hand) unless INFINICASTER_OPERATOR_FID is given.
if [ -n "${INFINICASTER_OPERATOR_FID:-}" ]; then
  grep -q '^HUB_OPERATOR_FID=' .env || echo "HUB_OPERATOR_FID=$INFINICASTER_OPERATOR_FID" >> .env
else
  grep -q '^HUB_OPERATOR_FID=' .env || echo 'HUB_OPERATOR_FID=0' >> .env
  grep -q '^SKIP_CRONTAB=' .env || echo 'SKIP_CRONTAB=true' >> .env
fi

# 5. Our settings live in an override file that Snapchain's upgrades never touch.
{
  echo "# Written by Infinicaster (infra/node-setup.sh)."
  echo "services:"
  echo "  snapchain:"
  echo "    environment:"
  if [ "$BLOCKS" != all ]; then echo "      SNAPCHAIN_PRUNING__BLOCK_RETENTION: \"$BLOCKS\""; fi
  echo "      SNAPCHAIN_SNAPSHOT__LOAD_DB_FROM_SNAPSHOT: \"$([ "$SNAPSHOT" = snapchain ] && echo true || echo false)\""
  if [ "$SNAPSHOT" = replicate ]; then echo "      SNAPCHAIN_SNAPSHOT__BOOTSTRAP_METHOD: \"Replicate\""; fi
  if [ "$SNAPSHOT" = replicate ] && [ -n "${INFINICASTER_REPLICATION_PEERS:-}" ]; then
    # A list for Snapchain's config: ["http://a:3383","http://b:3383"]
    peers=$(echo "$INFINICASTER_REPLICATION_PEERS" | jq -Rc 'split(",") | map(select(length > 0))')
    echo "      SNAPCHAIN_SNAPSHOT__REPLICATION_PEERS: '$peers'"
  fi
} > docker-compose.override.yml

# 6. The starting snapshot, streamed: download -> unzip -> unpack, one copy on disk.
#    Snapchain's own loader keeps every compressed piece, then a full tar, then the database.
#    The three shards stream at the same time (each is its own .tar.gz), which is ~2-3x faster.
#    Each ~70 MB piece is downloaded whole to a temporary file first, then fed to the unpacker in order.
#    (Piping curl straight in breaks the stream when a download is cut and retried: that corrupted the
#    gzip data on our first real run.) A few pieces download ahead, so at most ~0.5 GB sits in .parts/.
fetch_piece() {
  local url=$1 out=$2
  # R2 sometimes leaves a connection open with no data: abort below 1 MB/s for 30 s, then retry.
  local try
  for try in 1 2 3 4 5 6; do
    if curl -fsS --connect-timeout 20 --speed-limit 1000000 --speed-time 30 --max-time 900 \
         --retry 5 --retry-delay 5 --retry-all-errors -o "$out.tmp" "$url"; then
      mv "$out.tmp" "$out"; return 0
    fi
    sleep $((try * 5))
  done
  touch "$out.failed"
}
stream_shard() {
  local shard=$1 meta key total n=0 parts=".parts/shard-$shard"
  [ -f ".snapshot-shard-$shard.done" ] && return 0
  meta=$(curl -fsS --retry 10 --retry-all-errors "$SNAPSHOT_URL/$shard/latest.json")
  key=$(echo "$meta" | jq -r .key_base)
  total=$(echo "$meta" | jq '.chunks | length')
  echo "shard $shard: streaming $total pieces of ~70 MB from $key"
  rm -rf ".rocks/shard-$shard" "$parts"; mkdir -p "$parts"
  mapfile -t chunks < <(echo "$meta" | jq -r '.chunks[]')
  # Downloader: up to 4 pieces at once, never more than 8 waiting on disk.
  (
    for chunk in "${chunks[@]}"; do
      while [ "$(ls "$parts" | wc -l)" -ge 8 ] || [ "$(jobs -rp | wc -l)" -ge 4 ]; do sleep 0.5; done
      fetch_piece "$SNAPSHOT_BUCKET/$key/$chunk" "$parts/$chunk" &
    done
    wait
  ) &
  # Reader: hands each finished piece to gunzip | tar, in order, then deletes it.
  for chunk in "${chunks[@]}"; do
    until [ -f "$parts/$chunk" ]; do
      [ -f "$parts/$chunk.failed" ] && { echo "shard $shard: piece $chunk failed after retries" >&2; exit 1; }
      sleep 0.2
    done
    cat "$parts/$chunk"; rm -f "$parts/$chunk"
    n=$((n + 1)); [ $((n % 100)) -eq 0 ] && echo "  shard $shard: $n/$total" >&2
  done | gunzip | tar -x -C .rocks
  rm -rf "$parts"
  touch ".snapshot-shard-$shard.done"
  echo "shard $shard: done"
}
if [ "$SNAPSHOT" = stream ]; then
  mkdir -p .rocks
  say "Streaming the snapshot (all shards at once)"
  pids=""
  for shard in $SHARDS; do stream_shard "$shard" & pids="$pids $!"; done
  failed=0
  for pid in $pids; do wait "$pid" || failed=1; done
  [ "$failed" = 0 ] || { echo "A snapshot shard failed. Re-run this script: finished shards are kept."; exit 1; }
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
