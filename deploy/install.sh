#!/usr/bin/env bash
# deploy/install.sh
# Sets up or updates Feuillet on this server: web root, Apache virtual host,
# collaboration and TeX Live servers (Docker) and HTTPS certificate. Safe to
# run again after an update. Run with sudo:
#   sudo deploy/install.sh
set -euo pipefail

DOMAIN=feuillet.slashbin.net
WEBROOT=/var/www/$DOMAIN
HERE=$(cd "$(dirname "$0")" && pwd)
OWNER=${SUDO_USER:-root}
SITES=/etc/apache2/sites-available
SSL_CONF=$SITES/$DOMAIN-le-ssl.conf

if [ "$(id -u)" -ne 0 ]; then
	echo "Run with sudo: sudo $0" >&2
	exit 1
fi

# certbot copies the virtual host once; later proxy routes are added to its
# copy, before </VirtualHost>.
add_proxy_route() {
	local conf=$1 route=$2 port=$3 comment=$4
	grep -q "ProxyPass  *$route " "$conf" && return 0
	local backup
	backup="$conf.avant-$(date +%Y%m%d-%H%M%S)"
	cp "$conf" "$backup"
	awk -v route="$route" -v port="$port" -v comment="$comment" '
		/<\/VirtualHost>/ && !done {
			print "    # " comment
			print "    ProxyPass        " route " http://127.0.0.1:" port "/ upgrade=websocket"
			print "    ProxyPassReverse " route " http://127.0.0.1:" port "/"
			print ""
			done = 1
		}
		{ print }
	' "$backup" >"$conf"
	echo "Added $route to $conf (previous version: $backup)"
}

echo "== Web root $WEBROOT (owned by $OWNER, filled by deploy/publish.sh)"
install -d -o "$OWNER" -g www-data -m 2775 "$WEBROOT"

echo "== Apache virtual host"
a2enmod -q proxy proxy_http proxy_wstunnel headers rewrite ssl
if [ -e "$SSL_CONF" ]; then
	add_proxy_route "$SSL_CONF" /collab/ 1234 "Real-time collaboration server (deploy/docker-compose.yml)."
	add_proxy_route "$SSL_CONF" /texlive/ 7045 "TeX Live compile server (deploy/docker-compose.yml)."
else
	install -m 644 "$HERE/apache/$DOMAIN.conf" "$SITES/$DOMAIN.conf"
	a2ensite -q "$DOMAIN"
fi
apache2ctl configtest
systemctl reload apache2

echo "== Collaboration server settings (/etc/feuillet/collab.env)"
install -d -m 755 /etc/feuillet
if [ ! -e /etc/feuillet/collab.env ]; then
	install -m 600 /dev/null /etc/feuillet/collab.env
	cat >/etc/feuillet/collab.env <<'SETTINGS'
# Feuillet collaboration server settings, kept out of the repository.
# "Sign in with GitHub": register a GitHub OAuth App (see deploy/README.md),
# fill in its client id and secret, then run deploy/install.sh again.
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
SETTINGS
	echo "Created /etc/feuillet/collab.env (GitHub sign-in stays off until it is filled in)."
fi

echo "== Collaboration and TeX Live servers (the first TeX Live build downloads about 3 GB)"
docker compose -f "$HERE/docker-compose.yml" up -d --build
for service in 1234 7045; do
	for _ in $(seq 1 60); do
		if curl -fsS "http://127.0.0.1:$service/health" >/dev/null; then break; fi
		sleep 1
	done
	curl -fsS "http://127.0.0.1:$service/health" && echo
done

echo "== HTTPS certificate"
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
	echo "Certificate already present; certbot renews it automatically."
elif getent hosts "$DOMAIN" >/dev/null; then
	certbot --apache -d "$DOMAIN" --redirect
else
	echo "$DOMAIN does not resolve yet. Create the DNS record, then run:"
	echo "  sudo certbot --apache -d $DOMAIN --redirect"
fi

echo "Done. Publish the application with: deploy/publish.sh (no sudo needed)"
