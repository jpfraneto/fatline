#!/usr/bin/env bash
# Turns a Linux server into a full Hypersnap read node, unattended. It can share the server with a
# Snapchain node (infra/node-setup.sh): it uses its own folder, its own disk and ports 4381-4383.
# Run as root on the server.
#
#   INFINICASTER_HYPERSNAP_DATA=/mnt/HC_Volume_123   where the node's data goes. Default: the attached
#                        volume with the most free space that is not already holding Snapchain.
#   INFINICASTER_SNAPSHOT=stream     stream the starting snapshot straight to disk, one copy (~600 GB). Default.
#                        hypersnap  use Hypersnap's own download (keeps ~3 copies at its peak)
#                        replicate  copy only the current state from other nodes. Refused for now: it cannot
#                                   finish on mainnet. Hypersnap's replicator (same code as Snapchain's, checked at
#                                   2e8733d) refuses KeyAdd/KeyRemove messages, so every copy dies at the first
#                                   account that has one. Set INFINICASTER_FORCE=1 to try anyway.
#   INFINICASTER_REPLICATION_PEERS=http://IP:3383[,...]   with replicate: which nodes to copy from
#   INFINICASTER_BLOCKS=all          block history to keep. Hypersnap exists to keep everything, so "all"
#                        is the default; "1day" etc. sets pruning.block_retention.
#   INFINICASTER_HYPER_APIS=off      Hypersnap's extra APIs (social graph, channels, metrics, search, feeds,
#                        conversations) build their own indexes and use more RAM and disk. "on" enables them.
#                        Default: off when Snapchain runs on the same server, on otherwise.
#   INFINICASTER_HYPERSNAP_MEM=7g    memory cap for the container, so Hypersnap can never starve Snapchain.
#                        Default: 45% of RAM when Snapchain runs here, no cap otherwise.
#
# Safe to re-run: finished steps are skipped, and an interrupted snapshot shard starts over.
#
# The starting snapshot: Hypersnap's own loader reads the public Snapchain bucket by default (same
# latest.json layout), so this streams from there, exactly like node-setup.sh. That snapshot is
# Snapchain's state, already pruned: a new Hypersnap node keeps everything from the day it starts, not
# the messages Snapchain pruned before then.
set -euo pipefail

IMAGE="farcasterorg/hypersnap:0.13.5"   # = "latest" on 2026-10-22 (sha256:6b5e3a23...)
UPSTREAM_COMMIT="2e8733d044141ad3ba0e0592a4d5873c1dc6ce9c"   # farcasterorg/hypersnap main, 2026-10-17
SNAPSHOT="${INFINICASTER_SNAPSHOT:-stream}"
if [ "$SNAPSHOT" = replicate ] && [ "${INFINICASTER_FORCE:-}" != 1 ]; then
  echo "Replicate can't finish on mainnet today: Hypersnap's replicator refuses KeyAdd/KeyRemove messages"
  echo "(src/network/replication/replicator.rs), so the copy dies at the first account that has one."
  echo "Use the default (stream), or set INFINICASTER_FORCE=1 to try anyway."
  exit 1
fi
BLOCKS="${INFINICASTER_BLOCKS:-all}"
SNAPSHOT_BUCKET="https://pub-d352dd8819104a778e20d08888c5a661.r2.dev"
SNAPSHOT_URL="$SNAPSHOT_BUCKET/FARCASTER_NETWORK_MAINNET"
SHARDS="0 1 2"
HTTP_PORT=4381; GOSSIP_PORT=4382; RPC_PORT=4383   # Snapchain keeps 3381-3383
MIN_FREE_GB=640   # ~600 GB snapshot (est.) + a little room; unpruned history only grows, so watch it

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# 0. Is a Snapchain node already here? Then share politely.
SHARED=no
if [ -e /root/snapchain ] || (command -v docker >/dev/null && docker ps --format '{{.Image}}' | grep -q snapchain); then
  SHARED=yes
fi

# 1. Pick the disk. Never the one Snapchain is on: two growing databases on one volume end badly.
SNAPCHAIN_DISK=""
[ -e /root/snapchain ] && SNAPCHAIN_DISK=$(df --output=target "$(readlink -f /root/snapchain)" | tail -1)
if [ -n "${INFINICASTER_HYPERSNAP_DATA:-}" ]; then
  BASE="$INFINICASTER_HYPERSNAP_DATA"
else
  BASE=""; best=0
  for v in /mnt/HC_Volume_* /mnt/*; do
    [ -d "$v" ] && mountpoint -q "$v" || continue
    mnt=$(df --output=target "$v" | tail -1)
    [ "$mnt" = "$SNAPCHAIN_DISK" ] && continue
    free=$(df -BG --output=avail "$v" | tail -1 | tr -dc 0-9)
    [ "$free" -gt "$best" ] && { best=$free; BASE=$v; }
  done
  # No separate volume: the server's own disk, unless Snapchain is on it.
  if [ -z "$BASE" ]; then
    [ "$(df --output=target /root | tail -1)" = "$SNAPCHAIN_DISK" ] \
      && { echo "Snapchain already uses every disk here. Attach a volume of 1.5 TB or more for Hypersnap, then re-run."; exit 1; }
    BASE=/root
  fi
fi
DATA="$BASE/hypersnap"
mkdir -p "$DATA"
# ext4 keeps 5% for root by default (~34 GB of a 685 GB volume). A data-only volume doesn't need it.
if [ "$BASE" != /root ]; then
  dev=$(df --output=source "$DATA" | tail -1)
  [ "$(df --output=target "$DATA" | tail -1)" != / ] && command -v tune2fs >/dev/null && tune2fs -m 0 "$dev" >/dev/null 2>&1 || true
fi
[ "$DATA" != /root/hypersnap ] && [ ! -e /root/hypersnap ] && ln -s "$DATA" /root/hypersnap
cd "$DATA"
FREE_GB=$(df -BG --output=avail "$DATA" | tail -1 | tr -dc 0-9)
# On a re-run, shards already on disk are part of what the node needs (finished ones are kept, unfinished
# ones are deleted and fetched again), so count their space as available.
for d in .rocks/shard-*; do
  if [ -d "$d" ]; then FREE_GB=$((FREE_GB + $(du -s -BG "$d" | cut -f1 | tr -dc 0-9))); fi
done
if [ ! -f .snapshot-done ] && [ "$FREE_GB" -lt "$MIN_FREE_GB" ] && [ "${INFINICASTER_FORCE:-}" != 1 ]; then
  echo "Only ${FREE_GB} GB free in $DATA. A full Hypersnap node needs ${MIN_FREE_GB} GB+ to start and keeps growing."
  echo "Attach a bigger volume, or set INFINICASTER_FORCE=1 to try anyway."
  exit 1
fi
say "Hypersnap data lives in $DATA (${FREE_GB} GB free). Sharing the server with Snapchain: $SHARED"

# 2. Memory. Snapchain asks for 16 GB by itself, so cap Hypersnap when they share.
RAM_GB=$(awk '/MemTotal/ {print int($2/1024/1024)}' /proc/meminfo)
MEM="${INFINICASTER_HYPERSNAP_MEM:-}"
[ -z "$MEM" ] && [ "$SHARED" = yes ] && MEM="$((RAM_GB * 45 / 100))g"
APIS="${INFINICASTER_HYPER_APIS:-$([ "$SHARED" = yes ] && echo off || echo on)}"
if [ "$RAM_GB" -lt 15 ] && [ "$SHARED" = no ] && ! swapon --show | grep -q .; then
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

# 4. Config: upstream's mainnet settings (docker-compose.mainnet.yml at $UPSTREAM_COMMIT), our ports,
#    plus the validator list from the same commit.
curl -fsSL "https://raw.githubusercontent.com/farcasterorg/hypersnap/$UPSTREAM_COMMIT/validators.toml" -o validators.toml
api() { echo "[api.$1]"; echo "enabled = $([ "$APIS" = on ] && echo true || echo false)"; [ -n "${2:-}" ] && [ "$APIS" = on ] && echo "backfill_on_startup = true"; echo; }
{
  echo "# Written by Infinicaster (infra/hypersnap-setup.sh). Re-running the script rewrites it."
  echo "rpc_address=\"0.0.0.0:$RPC_PORT\""
  echo "http_address=\"0.0.0.0:$HTTP_PORT\""
  echo 'rocksdb_dir=".rocks"'
  echo 'fc_network="Mainnet"'
  echo 'read_node = true'
  echo
  echo '[statsd]'; echo 'prefix="hypersnap"'; echo 'addr="statsd:8125"'; echo 'use_tags=true'; echo
  echo '[gossip]'
  echo "address=\"/ip4/0.0.0.0/udp/$GOSSIP_PORT/quic-v1\""
  echo 'bootstrap_peers = "/ip4/54.236.164.51/udp/3382/quic-v1, /ip4/54.87.204.167/udp/3382/quic-v1, /ip4/44.197.255.20/udp/3382/quic-v1, /ip4/54.157.62.17/udp/3382/quic-v1, /ip4/34.195.157.114/udp/3382/quic-v1, /ip4/107.20.169.236/udp/3382/quic-v1, /ip4/34.4.32.36/udp/3382/quic-v1, /ip4/35.157.151.56/udp/3382/quic-v1, /ip4/108.132.114.186/udp/3382/quic-v1"'
  echo
  echo '[consensus]'; echo 'shard_ids = [1,2]'; echo 'num_shards = 2'; echo
  echo '[hyper]'; echo 'enabled = true'; echo
  echo '[api]'; echo 'enabled = true'; echo
  api social_graph backfill; api channels backfill; api metrics backfill
  api feeds; api search backfill; api conversations
  if [ "$BLOCKS" != all ]; then echo '[pruning]'; echo "block_retention = \"$BLOCKS\""; echo; fi
  echo '[snapshot]'
  echo "load_db_from_snapshot = $([ "$SNAPSHOT" = hypersnap ] && echo true || echo false)"
  if [ "$SNAPSHOT" = replicate ]; then
    echo 'bootstrap_method = "Replicate"'
    if [ -n "${INFINICASTER_REPLICATION_PEERS:-}" ]; then
      echo "replication_peers = $(echo "$INFINICASTER_REPLICATION_PEERS" | jq -Rc 'split(",") | map(select(length > 0))')"
    fi
  fi
  echo
  cat validators.toml
} > config.toml

# 5. Compose: Hypersnap plus its own statsd, which publishes no host ports (Snapchain's statsd owns 8125/8126).
{
  echo "# Written by Infinicaster (infra/hypersnap-setup.sh). Re-running the script rewrites it."
  echo "name: hypersnap"
  echo "services:"
  echo "  hypersnap:"
  echo "    image: $IMAGE"
  echo "    init: true"
  echo "    restart: always"
  echo "    command: [\"--config-path\", \"config.toml\"]"
  echo "    environment: { RUST_BACKTRACE: \"full\" }"
  [ -n "$MEM" ] && echo "    mem_limit: $MEM"
  echo "    depends_on: [statsd]"
  echo "    ports: [\"$HTTP_PORT:$HTTP_PORT/tcp\", \"$GOSSIP_PORT:$GOSSIP_PORT/udp\", \"$RPC_PORT:$RPC_PORT/tcp\"]"
  echo "    volumes:"
  echo "      - ./config.toml:/app/config.toml:ro"
  echo "      - ./.rocks:/app/.rocks"
  echo "      - ./.rocks.snapshot:/app/.rocks.snapshot"
  echo "    ulimits: { nofile: { soft: 65535, hard: 65535 } }"
  echo "  statsd:"
  echo "    image: graphiteapp/graphite-statsd:1.1.10-5"
  echo "    restart: unless-stopped"
} > docker-compose.yml

# 6. The starting snapshot, streamed: download -> unzip -> unpack, one copy on disk.
#    Same method as node-setup.sh (see the notes there on why each piece is downloaded whole first).
#    In sync with node-setup.sh at 1dae4f1 (fetch_piece and fetch_ranges unchanged). TODO: share this code.
fetch_piece() {
  local url=$1 out=$2 try
  # Pieces Cloudflare hasn't cached come slowly (we measured 0.1-4 MB/s per connection), so first try a
  # few times on one connection, resuming a cut download (-C -) and dropping it below 100 KB/s for 60 s.
  for try in 1 2 3; do
    if curl -fsS -C - --connect-timeout 20 --speed-limit 100000 --speed-time 60 --max-time 1800 \
         -o "$out.tmp" "$url" 2>>"$out.log"; then
      mv "$out.tmp" "$out"; rm -f "$out.log"; return 0
    fi
    sleep $((try * 5))
  done
  # Still slow: some byte regions of a piece are slow on any one connection (on 2026-10-22 one piece got
  # 17 of 89 MB in 44 min). Fetch the rest in 8 byte ranges at once. Each range keeps resuming while it
  # makes progress and gives up only after 20 tries in a row add no bytes.
  fetch_ranges "$url" "$out" 8 && return 0
  touch "$out.failed"
}
fetch_ranges() {
  local url=$1 out=$2 n=$3 size have step i
  local head etag
  head=$(curl -fsSI --connect-timeout 20 "$url" | tr -d '\r')
  size=$(awk 'tolower($1)=="content-length:" {print $2}' <<<"$head")
  # R2's ETag for these pieces is their MD5 (checked against pieces on disk), so the joined ranges can be checked.
  etag=$(awk 'tolower($1)=="etag:" {gsub(/"/, "", $2); print $2}' <<<"$head")
  [ -n "$size" ] || return 1
  have=$(stat -c %s "$out.tmp" 2>/dev/null || echo 0)
  step=$(( (size - have + n - 1) / n ))
  for i in $(seq 0 $((n - 1))); do
    ( local a=$((have + i * step)) b f=$out.r$i stuck=0 got before
      b=$((a + step - 1)); [ "$b" -ge "$size" ] && b=$((size - 1))
      : >"$f"; [ "$a" -gt "$b" ] && exit 0
      while got=$(stat -c %s "$f"); [ "$got" -lt $((b - a + 1)) ]; do
        [ "$stuck" -ge 20 ] && exit 1
        before=$got
        curl -fsS --connect-timeout 20 --speed-limit 20000 --speed-time 30 -r $((a + got))-$b "$url" >>"$f" 2>>"$out.log" || sleep 3
        if [ "$(stat -c %s "$f")" -gt "$before" ]; then stuck=0; else stuck=$((stuck + 1)); fi
      done ) &
  done
  wait  # bash's wait without ids returns 0; check each range's size below instead
  for i in $(seq 0 $((n - 1))); do cat "$out.r$i" >>"$out.tmp"; done
  rm -f "$out".r*
  if [ "$(stat -c %s "$out.tmp")" -eq "$size" ] \
     && { ! [[ $etag =~ ^[0-9a-f]{32}$ ]] || [ "$(md5sum <"$out.tmp" | cut -d' ' -f1)" = "$etag" ]; }; then mv "$out.tmp" "$out"; rm -f "$out.log"; return 0; fi
  rm -f "$out.tmp"; return 1
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
  # Downloader: up to 12 pieces at once, never more than 24 waiting on disk (~1.7 GB per shard).
  (
    for chunk in "${chunks[@]}"; do
      while [ "$(ls "$parts" | grep -vc '\.log$')" -ge 24 ] || [ "$(jobs -rp | wc -l)" -ge 12 ]; do sleep 0.5; done
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
    n=$((n + 1))
    # An if, not `[ … ] && echo`: as the loop's last command, a false test would fail the whole pipeline.
    if [ $((n % 100)) -eq 0 ] || [ "$n" -eq "$total" ]; then echo "  shard $shard: $n/$total" >&2; fi
  done | gunzip | tar -x -C .rocks
  rm -rf "$parts"
  touch ".snapshot-shard-$shard.done"
  echo "shard $shard: done"
}
if [ "$SNAPSHOT" = stream ] && [ ! -f .snapshot-done ]; then
  mkdir -p .rocks
  say "Streaming the snapshot (all shards at once)"
  pids=""
  for shard in $SHARDS; do stream_shard "$shard" & pids="$pids $!"; done
  failed=0
  for pid in $pids; do wait "$pid" || failed=1; done
  [ "$failed" = 0 ] || { echo "A snapshot shard failed. Re-run this script: finished shards are kept."; exit 1; }
  touch .snapshot-done
  say "Snapshot unpacked: $(du -sh .rocks | cut -f1)"
fi
mkdir -p .rocks .rocks.snapshot

# 7. Start it and wait for the API.
say "Starting Hypersnap ($IMAGE, memory cap: ${MEM:-none}, extra APIs: $APIS)"
docker compose pull -q
docker compose up -d
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$HTTP_PORT/v1/info" >/dev/null 2>&1 && break
  sleep 10
done
curl -fsS "http://127.0.0.1:$HTTP_PORT/v1/info" >/dev/null 2>&1 \
  && say "Hypersnap is answering on 127.0.0.1:$HTTP_PORT. It now catches up with the blocks since the snapshot." \
  || { echo "Hypersnap did not answer in 10 minutes. See: cd $DATA && docker compose logs hypersnap"; exit 1; }

echo "Disk used by the node: $(du -sh .rocks | cut -f1). Check sync with: curl -s localhost:$HTTP_PORT/v1/info | jq '.shardInfos[] | {shardId, blockDelay}'"
