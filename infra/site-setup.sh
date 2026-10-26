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
		header /status.json Cache-Control "no-cache"
		header /hatching.json Cache-Control "no-cache"
		@app path_regexp ^/([0-9]{1,9}|0x[0-9a-fA-F]{40}|f/[A-Za-z0-9]{1,12}|base/0x[0-9a-fA-F]{40})/?$
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
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy
echo "Serving $(readlink -f /srv/fatline-site/current) at: $(for h in $HOSTS; do printf 'https://%s/ ' "$h"; done)"
