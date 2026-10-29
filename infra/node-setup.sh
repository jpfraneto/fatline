#!/usr/bin/env bash
# Turns a fresh Linux server into a Farcaster read node (Snapchain), unattended.
# Run as root on the server. fatline compute --node does this for you.
#
#   FATLINE_BLOCKS=1day     keep this much block history (Snapchain pruning.block_retention); "all" keeps everything
#   FATLINE_SNAPSHOT=stream    stream the starting snapshot straight to disk (needs ~1 copy of space, ~600 GB)
#                        replicate copy only the current state from other nodes, no old blocks (experimental; does NOT
#                                  finish on mainnet today: Snapchain's replication refuses KeyAdd/KeyRemove messages,
#                                  so the copy fails at the first account that has one. Tested 2026-10-22. A full
#                                  replica would also be ~300-400 GB and take ~11-15 h from a synced source.
#                                  Refused unless FATLINE_FORCE=1.)
#                        snapchain use Snapchain's own download (keeps ~3 copies at its peak)
#   FATLINE_REPLICATION_PEERS=http://IP:3383[,http://IP2:3383]
#                        with replicate: which nodes to copy state from. Snapchain's default is rho.farcaster.xyz,
#                        which answers "Unimplemented" (it sits behind a proxy), so point it at a node that serves it.
#
# Safe to re-run: finished steps are skipped, and an interrupted snapshot shard starts over.
set -euo pipefail

BLOCKS="${FATLINE_BLOCKS:-1day}"
SNAPSHOT="${FATLINE_SNAPSHOT:-stream}"
if [ "$SNAPSHOT" = replicate ] && [ "${FATLINE_FORCE:-}" != 1 ]; then
  echo "Replicate can't finish on mainnet today: Snapchain's replicator refuses KeyAdd/KeyRemove messages"
  echo "(src/network/replication/replicator.rs), so the copy dies at the first account that has one (tested 2026-10-22)."
  echo "Use the default (stream), or set FATLINE_FORCE=1 to try anyway."
  exit 1
fi
# The bucket root. latest.json lives under FARCASTER_NETWORK_MAINNET/<shard>/, and its key_base already
# starts with FARCASTER_NETWORK_MAINNET/, so chunks are fetched from the root.
SNAPSHOT_BUCKET="https://pub-d352dd8819104a778e20d08888c5a661.r2.dev"
SNAPSHOT_URL="$SNAPSHOT_BUCKET/FARCASTER_NETWORK_MAINNET"
SHARDS="0 1 2"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# 1. Put the node's data on the biggest disk: an attached volume if there is one.
# With several volumes (e.g. a Hypersnap one on the same server): FATLINE_VOLUME wins, then the
# volume that already holds a snapchain folder, then the first one.
VOLUME="${FATLINE_VOLUME:-}"
# A node needs ~650 GB. If no volume is mounted yet and the server's own disk is too small, the seller may
# still be attaching the disk that was just bought: wait up to 15 minutes for it rather than filling / for hours.
NEED_GB="${FATLINE_NEED_GB:-650}"
root_free_gb() { df -BG --output=avail / | tail -1 | tr -dc 0-9; }
if [ -z "$VOLUME" ] && ! ls -d /mnt/HC_Volume_* >/dev/null 2>&1 && [ "$(root_free_gb)" -lt "$NEED_GB" ]; then
  say "Waiting for the data disk to be mounted (/ has only $(root_free_gb) GB free; a node needs ~$NEED_GB GB)"
  for _ in $(seq 1 90); do ls -d /mnt/HC_Volume_* >/dev/null 2>&1 && break; sleep 10; done
  if ! ls -d /mnt/HC_Volume_* >/dev/null 2>&1; then
    echo "FATLINE_ERROR: no data disk. / has $(root_free_gb) GB free and no volume is mounted under /mnt; a node needs ~$NEED_GB GB."
    echo "Attach a disk of ~700 GB (fatline compute disk --disk 700), then run fatline node again."
    exit 1
  fi
fi
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

# Sellers that put the server behind their own firewall (AgentMetal: only SSH open at boot) would hide the node
# from everyone, peers included. If the server can manage its own firewall (AgentMetal's /v1/self), open the node's ports.
open_seller_firewall() {
  local self id
  self=$(curl -fsS -m 10 https://api.agentmetal.dev/v1/self 2>/dev/null) || return 0
  id=$(echo "$self" | jq -r '.server_id // empty'); [ -n "$id" ] || return 0
  [ "$(echo "$self" | jq -r '.firewall.managed // false')" = true ] || return 0
  for rule in "$@"; do
    set -- $rule
    if echo "$self" | jq -e --arg p "$1" --arg port "$2" '.firewall.rules[]? | select(.protocol == $p and .port == $port)' >/dev/null; then continue; fi
    curl -fsS -m 15 -X POST "https://api.agentmetal.dev/v1/servers/$id/firewall/rules" -H 'content-type: application/json' \
      -d "{\"protocol\":\"$1\",\"port\":\"$2\",\"description\":\"Fatline node\"}" >/dev/null \
      && echo "Opened $1/$2 in the seller's firewall" || echo "FATLINE_WARNING: could not open $1/$2 in the seller's firewall; the node is unreachable from outside until it is open"
  done
}

# 3. Tools.
command -v jq >/dev/null || { apt-get update -qq && apt-get install -y -qq jq >/dev/null; }
open_seller_firewall "tcp 3381" "udp 3382" "tcp 3383"
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
# Snapchain's own weekly auto-upgrade needs an operator FID, and weekly is too slow anyway: v0.15.0 shipped
# on 2026-10-23 with a protocol change active the same day, and our own node stuck on 0.14.3 until upgraded
# by hand. So Fatline skips Snapchain's crontab and adds its own: ./snapchain.sh upgrade once a day, at a
# random time (so nodes don't all restart together), through the upgrader written in step 7. It only restarts the
# node when there is a new version or its config.toml changed.
# FATLINE_NO_AUTOUPGRADE=1 turns it off.
grep -q '^HUB_OPERATOR_FID=' .env || echo "HUB_OPERATOR_FID=${FATLINE_OPERATOR_FID:-0}" >> .env
grep -q '^SKIP_CRONTAB=' .env || echo 'SKIP_CRONTAB=true' >> .env
if [ "${FATLINE_NO_AUTOUPGRADE:-}" != 1 ] && command -v crontab >/dev/null; then
  line="$((RANDOM % 60)) $((RANDOM % 24)) * * * ${FATLINE_SNAP_UPGRADER:-/usr/local/sbin/fatline-snapchain-upgrade} $PWD >> $PWD/autoupgrade.log 2>&1 # fatline-autoupgrade"
  { crontab -l 2>/dev/null | grep -v 'fatline-autoupgrade'; echo "$line"; } | crontab -
  say "Auto-upgrade on: Snapchain checks for a new version once a day (crontab: fatline-autoupgrade)"
fi

# A replicated copy that didn't finish can't be resumed: Snapchain keeps it in .rocks/.snapshot, and it only
# copies when .rocks is empty. Started again, it would skip the copy and run on the partial data. So start over.
if [ "$SNAPSHOT" = replicate ] && [ ! -f .replicate-done ] && [ -n "$(ls -A .rocks 2>/dev/null)" ]; then
  say "An earlier copy didn't finish; deleting it and starting the copy over"
  docker compose stop snapchain >/dev/null 2>&1 || true
  rm -rf .rocks && mkdir -p .rocks
fi

# 5. Our settings live in an override file that Snapchain's upgrades never touch.
{
  echo "# Written by Fatline (infra/node-setup.sh)."
  echo "services:"
  echo "  snapchain:"
  # While copying, a failed copy must stop the node: restarted, Snapchain would run on the partial data.
  if [ "$SNAPSHOT" = replicate ] && [ ! -f .replicate-done ]; then echo '    restart: "no"'; fi
  echo "    environment:"
  if [ "$BLOCKS" != all ]; then echo "      SNAPCHAIN_PRUNING__BLOCK_RETENTION: \"$BLOCKS\""; fi
  echo "      SNAPCHAIN_SNAPSHOT__LOAD_DB_FROM_SNAPSHOT: \"$([ "$SNAPSHOT" = snapchain ] && echo true || echo false)\""
  if [ "$SNAPSHOT" = replicate ]; then echo "      SNAPCHAIN_SNAPSHOT__BOOTSTRAP_METHOD: \"Replicate\""; fi
  if [ "$SNAPSHOT" = replicate ] && [ -n "${FATLINE_REPLICATION_PEERS:-}" ]; then
    # A list for Snapchain's config: ["http://a:3383","http://b:3383"]
    peers=$(echo "$FATLINE_REPLICATION_PEERS" | jq -Rc 'split(",") | map(select(length > 0))')
    echo "      SNAPCHAIN_SNAPSHOT__REPLICATION_PEERS: '$peers'"
  fi
} > docker-compose.override.yml

# 6. The starting snapshot, streamed: download -> unzip -> unpack, one copy on disk.
#    Snapchain's own loader keeps every compressed piece, then a full tar, then the database.
#    The three shards stream at the same time (each is its own .tar.gz), which is ~2-3x faster.
#    Each ~70 MB piece is downloaded whole to a temporary file first, then fed to the unpacker in order.
#    (Piping curl straight in breaks the stream when a download is cut and retried: that corrupted the
#    gzip data on our first real run.) Pieces download ahead, so at most ~1.7 GB per shard sits in .parts/.
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

# 7. Start it. Snapchain's script installs the compose file and Grafana; then the upgrader writes config.toml on the
#    host and starts the node without a shell (the image has none since 0.16.0). Same file as infra/autoupgrade.sh's.
SNAP_UPGRADER="${FATLINE_SNAP_UPGRADER:-/usr/local/sbin/fatline-snapchain-upgrade}"
write_snap_upgrader() {
  cat > "$SNAP_UPGRADER" <<'EOF'
#!/usr/bin/env bash
# Written by Fatline (infra/autoupgrade.sh, infra/node-setup.sh). Upgrades Snapchain with its own script, then starts
# it without a shell. Since 0.16.0 (2026-10-28) the image has no /bin/bash, but upstream's compose still writes
# config.toml from a bash entrypoint: the node crash-looped (exit 127) until this. So we write that same config.toml
# here, from the compose file's own text plus validators.toml, and run /app/snapchain directly.
#   fatline-snapchain-upgrade <dir> [--no-upgrade]
set -uo pipefail
d="${1:-.}"; cd "$d" || exit 1
log() { echo "$(date -u +%FT%TZ) $*"; }
[ "${2:-}" = --no-upgrade ] || ./snapchain.sh upgrade
[ -f docker-compose.yml ] && [ -f validators.toml ] || { log "no docker-compose.yml or validators.toml in $d"; exit 1; }
# Upstream's file alone (-f): once our override sets the entrypoint, the merged config no longer has the script.
docker compose -f docker-compose.yml config --format json | jq -r '.services.snapchain.entrypoint[2] // empty' \
  | awk '/^cat > config.toml <<EOF$/{f=1;next} /^EOF$/{f=0} f' > config.toml.new
if ! grep -q '^http_address' config.toml.new; then
  rm -f config.toml.new
  log "upstream's compose no longer writes config.toml the way it did; config.toml left as it is: check by hand"
  exit 1
fi
cat validators.toml >> config.toml.new
changed=0
[ -d config.toml ] && rmdir config.toml  # docker makes a directory when a mounted file is missing
if cmp -s config.toml.new config.toml; then rm -f config.toml.new; else mv config.toml.new config.toml; changed=1; log "config.toml written"; fi
if ! grep -qE 'fatline-noshell|/app/snapchain"' docker-compose.override.yml 2>/dev/null; then
  [ -s docker-compose.override.yml ] || printf 'services:\n  snapchain:\n' > docker-compose.override.yml
  cat >> docker-compose.override.yml <<'YML'
    # fatline-noshell: the image has no shell since 0.16.0; config.toml is written on the host.
    entrypoint: ["/app/snapchain"]
    command: ["--config-path", "/app/config.toml"]
    volumes:
      - ./config.toml:/app/config.toml:ro
YML
  changed=1
fi
state=$(docker inspect -f '{{.State.Status}}' "$(docker compose ps -aq snapchain 2>/dev/null | head -1)" 2>/dev/null || true)
if [ "$changed" = 1 ] || [ "$state" != running ]; then
  docker compose up -d snapchain && log "snapchain started (was: ${state:-none})"
fi
EOF
  chmod 755 "$SNAP_UPGRADER"
}
write_snap_upgrader
say "Starting Snapchain"
setsid nohup "$SNAP_UPGRADER" "$PWD" < /dev/null > upgrade.log 2>&1 &
if [ "$SNAPSHOT" = replicate ] && [ ! -f .replicate-done ]; then
  # The copy takes hours (we measured ~17k messages/s on 4 cores, ~15 h for mainnet). Follow Snapchain's log.
  # Its source node must keep its copy point for that long: points older than 24 h are dropped mid-copy.
  say "Copying the current state from ${FATLINE_REPLICATION_PEERS:-the default peers}"
  sleep 60
  while true; do
    logs=$(docker compose logs --no-color --since 70s snapchain 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
    if grep -q "Bootstrap using replication was successful" <<<"$logs"; then
      touch .replicate-done
      sed -i '/restart: "no"/d' docker-compose.override.yml
      docker update --restart unless-stopped "$(docker compose ps -q snapchain)" >/dev/null
      say "Copy finished"; break
    fi
    if grep -qE "Replication bootstrap failed|Replication bootstrap stopped" <<<"$logs" \
       || [ -z "$(docker compose ps -q --status running snapchain)" ]; then
      grep -A3 -E "ERROR" <<<"$logs" | tail -8
      echo "The copy failed. Snapchain was stopped so it doesn't run on partial data. Re-run this script to start the copy over."
      exit 1
    fi
    grep "merged" <<<"$logs" | tail -2 | sed 's/.*service: /  /'
    sleep 60
  done
fi
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:3381/v1/info >/dev/null 2>&1 && break
  sleep 10
done
curl -fsS http://127.0.0.1:3381/v1/info >/dev/null 2>&1 \
  && say "Snapchain is answering on 127.0.0.1:3381. It now catches up with the blocks since the snapshot." \
  || { echo "Snapchain did not answer in 10 minutes. See /root/snapchain/upgrade.log and: docker compose logs snapchain"; exit 1; }

echo "Disk used by the node: $(du -sh .rocks | cut -f1). Check sync with: curl -s localhost:3381/v1/info | jq '.shardInfos[] | {shardId, blockDelay}'"
