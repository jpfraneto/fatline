#!/bin/sh
# Writes this server's live numbers to /var/lib/fatline-stats/stats.json (cron, every 5 minutes).
# A read-only web server (busybox httpd, port 8099) serves only that folder, so fatline.ink can show
# what the node's body is running on. No secrets, nothing about users.
#   install: infra/server-stats.sh install <volume mount> <node container>
set -eu
DIR=/var/lib/fatline-stats
if [ "${1:-}" = install ]; then
  mkdir -p $DIR
  cp "$0" /usr/local/bin/fatline-server-stats; chmod 755 /usr/local/bin/fatline-server-stats
  echo "*/5 * * * * root /usr/local/bin/fatline-server-stats $2 $3" > /etc/cron.d/fatline-server-stats
  docker rm -f fatline-stats >/dev/null 2>&1 || true
  docker run -d --name fatline-stats --restart always -p 8099:80 -v $DIR:/www:ro busybox:1.36 httpd -f -h /www >/dev/null
  /usr/local/bin/fatline-server-stats "$2" "$3"
  exit 0
fi
VOL=$1; NODE=$2
cpu() { awk '/^cpu /{print $2+$3+$4+$6+$7+$8, $5}' /proc/stat; }
a=$(cpu); sleep 2; b=$(cpu)
busy=$(echo "$a $b" | awk '{bu=$3-$1; id=$4-$2; t=bu+id; if (t>0) printf "%.1f", 100*bu/t; else printf "0"}')
mem() { awk -v k="$1" '$1==k":"{print int($2/1024)}' /proc/meminfo; }
disk() { df -BM --output=size,used,avail "$1" | tail -1 | tr -d M | awk '{printf "{\"sizeMb\":%d,\"usedMb\":%d,\"freeMb\":%d}", $1,$2,$3}'; }
state=$(docker inspect -f '{{.State.Status}} {{.State.StartedAt}}' "$NODE" 2>/dev/null || echo "missing -")
cat > $DIR/stats.json.tmp <<JSON
{
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "cpu": { "cores": $(nproc), "model": "$(lscpu | awk -F: '/^Model name/{gsub(/^ +/,"",$2); print $2; exit}')", "busyPct": $busy, "load": [$(cut -d' ' -f1-3 /proc/loadavg | tr ' ' ',')] },
  "memory": { "totalMb": $(mem MemTotal), "availableMb": $(mem MemAvailable), "swapTotalMb": $(mem SwapTotal), "swapFreeMb": $(mem SwapFree) },
  "disk": { "volume": $(disk "$VOL"), "volumeDeviceGb": $(( $(lsblk -bdno SIZE "$(findmnt -n -o SOURCE "$VOL")") / 1073741824 )), "root": $(disk /) },
  "uptimeSec": $(cut -d. -f1 /proc/uptime),
  "node": { "container": "$NODE", "state": "${state%% *}", "startedAt": "${state#* }" }
}
JSON
mv $DIR/stats.json.tmp $DIR/stats.json
