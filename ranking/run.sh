#!/usr/bin/env bash
# Fatline ranking: score each network's extract, then merge them into one ranked list.
#   ranking/run.sh <snapchain extract dir> <hypersnap extract dir> <out ranking.tsv>
# Needs the duckdb CLI (one file: https://duckdb.org). Uses ranking/*.sql next to this script.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SNAP_DIR=$1 HYPER_DIR=$2 OUT=$3
DB_OPTS="SET memory_limit='${DUCKDB_MEMORY:-8GB}'; SET temp_directory='${DUCKDB_TEMP:-/tmp/duckdb}';"
for dir in "$SNAP_DIR" "$HYPER_DIR"; do
  [ -f "$dir/DONE" ] || { echo "$dir has no DONE file: the extract isn't finished"; exit 1; }
  # Snapshot time = when the extract started, in Farcaster seconds.
  snap=$(( $(node -e "console.log(Math.floor(Date.parse(require(process.argv[1]).startedAt)/1000))" "$dir/meta.json") - 1609459200 ))
  db="$dir/score.duckdb"; rm -f "$db"
  vars="SET VARIABLE dir='$dir'; SET VARIABLE snap=$snap;"
  sql() { local file=$1; shift; { echo "$DB_OPTS $vars"; sed "s#__DIR__#$dir#g" "$HERE/$file"; } | duckdb "$@" "$db"; }
  echo "== $dir: prepare"; sql score.sql
  for i in $(seq 1 50); do
    change=$(sql iterate.sql -noheader -csv | tail -1)
    echo "   trust step $i: change $change"
    awk -v c="$change" 'BEGIN { exit !(c < 0.000001) }' && break
  done
  echo "== $dir: score"; sql finish.sql
done
{ echo "$DB_OPTS SET VARIABLE snap_dir='$SNAP_DIR'; SET VARIABLE hyper_dir='$HYPER_DIR'; SET VARIABLE out='$OUT';"; sed "s#__OUT__#$OUT#g" "$HERE/merge.sql"; } | duckdb
echo "Ranking written to $OUT"; head -5 "$OUT"
