#!/bin/sh
# Writes this server's live numbers to /var/lib/fatline-stats/stats.json (cron, every 5 minutes).
# A read-only web server (busybox httpd, port 8099) serves only that folder, so fatline.ink can show
# what the Fatline's body is running on. No secrets, nothing about users.
#   install: infra/server-stats.sh install "<name>=<mount> ..." "<node container> ..."
#   e.g.     infra/server-stats.sh install "snapchain=/mnt/HC_Volume_107233477 hypersnap=/mnt/HC_Volume_107234161 local=/" \
#              "snapchain-snapchain-1 hypersnap-hypersnap-1"
set -eu
DIR=/var/lib/fatline-stats
if [ "${1:-}" = install ]; then
  mkdir -p $DIR
  cp "$0" /usr/local/bin/fatline-server-stats; chmod 755 /usr/local/bin/fatline-server-stats
  echo "*/5 * * * * root /usr/local/bin/fatline-server-stats \"$2\" \"$3\"" > /etc/cron.d/fatline-server-stats
  docker rm -f fatline-stats >/dev/null 2>&1 || true
  docker run -d --name fatline-stats --restart always -p 8099:80 -v $DIR:/www:ro busybox:1.36 httpd -f -h /www >/dev/null
  /usr/local/bin/fatline-server-stats "$2" "$3"
  exit 0
fi
DISKS=$1; NODES=$2
cpu() { awk '/^cpu /{print $2+$3+$4+$6+$7+$8, $5}' /proc/stat; }
a=$(cpu); sleep 2; b=$(cpu)
busy=$(echo "$a $b" | awk '{bu=$3-$1; id=$4-$2; t=bu+id; if (t>0) printf "%.1f", 100*bu/t; else printf "0"}')
mem() { awk -v k="$1" '$1==k":"{print int($2/1024)}' /proc/meminfo; }
disks=""
for d in $DISKS; do
  name=${d%%=*}; mnt=${d#*=}
  set -- $(df -BM --output=size,used,avail "$mnt" | tail -1 | tr -d M)
  dev=$(findmnt -n -o SOURCE "$mnt")
  gb=$(( $(lsblk -bdno SIZE "$dev" 2>/dev/null || echo 0) / 1073741824 ))
  disks="$disks${disks:+,}{\"name\":\"$name\",\"mount\":\"$mnt\",\"deviceGb\":$gb,\"sizeMb\":$1,\"usedMb\":$2,\"freeMb\":$3}"
done
nodes=""
for n in $NODES; do
  s=$(docker inspect -f '{{.State.Status}} {{.State.StartedAt}}' "$n" 2>/dev/null || echo "missing -")
  nodes="$nodes${nodes:+,}{\"container\":\"$n\",\"state\":\"${s%% *}\",\"startedAt\":\"${s#* }\"}"
done
cat > $DIR/stats.json.tmp <<JSON
{
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "cpu": { "cores": $(nproc), "model": "$(lscpu | awk -F: '/^Model name/{gsub(/^ +/,"",$2); print $2; exit}')", "busyPct": $busy, "load": [$(cut -d' ' -f1-3 /proc/loadavg | tr ' ' ',')] },
  "memory": { "totalMb": $(mem MemTotal), "availableMb": $(mem MemAvailable) },
  "disks": [$disks],
  "uptimeSec": $(cut -d. -f1 /proc/uptime),
  "nodes": [$nodes]
}
JSON
mv $DIR/stats.json.tmp $DIR/stats.json
