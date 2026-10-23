#!/usr/bin/env bash
# Fatline ranking: score each network's extract, then merge them into one ranked list.
#   ranking/run.sh <snapchain extract dir> <hypersnap extract dir> <out ranking.tsv>
#   ranking/run.sh <extract dir> - -        score one network only (writes <dir>/score.tsv), no merge
# Needs the duckdb CLI (one file: https://duckdb.org) and GNU date. Uses ranking/*.sql next to this script.
# A network already scored (score.tsv newer than its DONE) is not scored again.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SNAP_DIR=$1 HYPER_DIR=$2 OUT=$3
DB_OPTS="SET memory_limit='${DUCKDB_MEMORY:-8GB}'; SET temp_directory='${DUCKDB_TEMP:-/tmp/duckdb}'; SET threads=${DUCKDB_THREADS:-4}; SET preserve_insertion_order=false;"
for dir in "$SNAP_DIR" "$HYPER_DIR"; do
  [ "$dir" = - ] && continue
  [ -f "$dir/DONE" ] || { echo "$dir has no DONE file: the extract isn't finished"; exit 1; }
  if [ "$dir/score.tsv" -nt "$dir/DONE" ]; then echo "== $dir: already scored"; continue; fi
  # Snapshot time = when the extract started, in Farcaster seconds.
  started=$(grep -o '"startedAt": *"[^"]*"' "$dir/meta.json" | cut -d'"' -f4)
  snap=$(( $(date -u -d "$started" +%s) - 1609459200 ))
  db="$dir/score.duckdb"; rm -f "$db"
  vars="SET VARIABLE dir='$dir'; SET VARIABLE snap=$snap;"
  sql() { local file=$1; shift; { echo "$DB_OPTS $vars"; sed "s#__DIR__#$dir#g" "$HERE/$file"; } | duckdb -bail "$@" "$db"; }
  echo "== $dir: prepare"; sql score.sql
  for i in $(seq 1 50); do
    change=$(sql iterate.sql -noheader -csv | tail -1)
    echo "   trust step $i: change $change"
    awk -v c="$change" 'BEGIN { exit !(c < 0.000001) }' && break
  done
  echo "== $dir: score"; sql finish.sql
done
[ "$OUT" = - ] && exit 0
{ echo "$DB_OPTS SET VARIABLE snap_dir='$SNAP_DIR'; SET VARIABLE hyper_dir='$HYPER_DIR'; SET VARIABLE out='$OUT';"; sed "s#__OUT__#$OUT#g" "$HERE/merge.sql"; } | duckdb -bail
echo "Ranking written to $OUT"; head -5 "$OUT"
