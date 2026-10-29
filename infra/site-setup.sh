#!/usr/bin/env bash
# Makes the master serve fatline.ink itself (run as root on the master; safe to re-run):
#   1. its own copy of Fatline for the site, /root/fatline-site (the hatchery's /root/fatline is not touched);
#   2. a timer that builds the site every hour (infra/site-build.sh) from this server's nodes and hatchery;
#   3. Caddy serving /srv/fatline-site/current over https, with the hatchery at /eggs/* and /world on the same name.
# Names: SITE_HOSTS (default 46-225-208-199.sslip.io, which works with no DNS record). Once fatline.ink's DNS
# points here (A record → this server's IP), run again with SITE_HOSTS="fatline.ink 46-225-208-199.sslip.io".
set -euo pipefail
# fatline update runs this again on the master: it keeps the names it was last given (/etc/fatline-site.hosts).
HOSTS="${SITE_HOSTS:-$(cat /etc/fatline-site.hosts 2>/dev/null || echo 46-225-208-199.sslip.io)}"
echo "$HOSTS" > /etc/fatline-site.hosts
REPO=/root/fatline-site

command -v caddy >/dev/null || { echo "Caddy is missing (apt: https://caddyserver.com/docs/install#debian-ubuntu-raspbian)"; exit 1; }
command -v node >/dev/null || { echo "Node.js 22 is missing"; exit 1; }
[ -d "$REPO/.git" ] || git clone -q https://github.com/jpfraneto/fatline "$REPO"
git -C "$REPO" fetch -q origin main && git -C "$REPO" reset -q --hard origin/main

cat > /etc/systemd/system/fatline-site.service <<EOF
[Unit]
Description=Build fatline.ink from this server's nodes (infra/site-build.sh)
After=network-online.target
[Service]
Type=oneshot
ExecStart=/bin/bash $REPO/infra/site-build.sh
EOF
cat > /etc/systemd/system/fatline-site.timer <<EOF
[Unit]
Description=Build fatline.ink every hour
[Timer]
OnBootSec=1min
OnUnitActiveSec=1h
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl start fatline-site.service   # the first build, now
systemctl enable -q --now fatline-site.timer

# Pages GitHub Pages served from 404.html (it reads the path in the browser): here they answer 200.
# With the names router (infra/names-setup.sh) holding ports 80 and 443, Caddy listens on 127.0.0.1:8080 and :8443.
GLOBAL=""
[ -f /etc/systemd/system/fatline-names.service ] && GLOBAL=$(printf '{\n\thttp_port 8080\n\thttps_port 8443\n\tdefault_bind 127.0.0.1\n}\n')
# This server's own client at <its surname>.fatline.ink (infra/serve-client.sh, run by fatline update), if it has one.
CLIENT=""
[ -f /etc/caddy/fatline-client.caddy ] && CLIENT="import /etc/caddy/fatline-client.caddy"
# With a client here, fatline.ink's home is the landing (the launchpad and its nodes), and the genesis client answers its
# API (the landing reads /api/networks and /api/names), its mini app card and manifest. /about is the landing too.
APP=""
if [ -n "$CLIENT" ]; then
  APP=$(printf '\t@app_client path /api/* /assets/* /miniapp/* /manifest.webmanifest /icon.svg /.well-known/farcaster.json\n\thandle @app_client {\n\t\treverse_proxy 127.0.0.1:8787\n\t}\n\trewrite /about /index.html\n')
fi
# Standing in for a place whose server is off (the names router sends its name here when it does not answer): its asleep
# page, from this server's client (indexer/src/asleep.mjs). A certificate per name, on demand, only for names the client
# says are places (never any name). A catch-all (https://), not *.fatline.ink: Caddy 2.10+ lets a wildcard site cover
# fatline.fatline.ink and www.fatline.ink and then loads no certificate of their own (their TLS fails). The named sites
# above and in fatline-client.caddy win over the catch-all.
STANDIN=""
if [ -n "$CLIENT" ] && [ -n "$GLOBAL" ]; then
  GLOBAL=$(printf '{\n\thttp_port 8080\n\thttps_port 8443\n\tdefault_bind 127.0.0.1\n\ton_demand_tls {\n\t\task http://127.0.0.1:8787/api/standin/ask\n\t}\n}\n')
  STANDIN=$(printf 'https:// {\n\ttls {\n\t\ton_demand\n\t}\n\tencode gzip\n\treverse_proxy 127.0.0.1:8787 {\n\t\theader_up X-Fatline-Standin 1\n\t}\n}\n')
fi
cat > /etc/caddy/Caddyfile <<EOF
$GLOBAL
# Written by Fatline (infra/site-setup.sh): this server is fatline.ink.
(fatline) {
	encode gzip
	# The genesis hatchery, on the site's own name (the home page reads each egg's warm checks here).
	handle /eggs/* {
		reverse_proxy localhost:8791
	}
	# The world: the hatchery's own copy of the Fatliners contract (indexer/src/world.mjs), read once an hour.
	@world path /world /world/*
	handle @world {
		reverse_proxy localhost:8791
	}
	# One cast, read from this server's own node (indexer/src/cast-page.mjs): fatline.ink/c/<who>/<hash> asks here.
	handle /cast/* {
		reverse_proxy localhost:8791
	}
$APP
	handle {
		root * /srv/fatline-site/current
		@md path *.md
		header @md Content-Type "text/markdown; charset=utf-8"
		@sh path *.sh
		header @sh Content-Type "text/plain; charset=utf-8"
		@meta path_regexp ^/fatliners/[0-9]+$
		header @meta Content-Type "application/json"
		header @meta Access-Control-Allow-Origin "*"
		header /.well-known/* Access-Control-Allow-Origin "*"
		# Every place's client reads the art list (the Fatline tab, apps/opinions/src/directory.js).
		header /fatliners-art.json Access-Control-Allow-Origin "*"
		header /status.json Cache-Control "no-cache"
		header /hatching.json Cache-Control "no-cache"
		@app path_regexp ^/([0-9]{1,9}|0x[0-9a-fA-F]{40}|f/[A-Za-z0-9]{1,12}|base/0x[0-9a-fA-F]{40}|c/[^/]{1,41}/0x[0-9a-fA-F]{8,40})/?$
		rewrite @app /404.html
		try_files {path} {path}/index.html {path}.html
		file_server
	}
	handle_errors 404 {
		root * /srv/fatline-site/current
		rewrite * /404.html
		file_server
	}
}
$(for h in $HOSTS; do printf '%s {\n\timport fatline\n}\n' "$h"; done)
$CLIENT
$STANDIN
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy
echo "Serving $(readlink -f /srv/fatline-site/current) at: $(for h in $HOSTS; do printf 'https://%s/ ' "$h"; done)"
