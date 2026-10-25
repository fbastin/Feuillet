#!/usr/bin/env bash
# deploy/install.sh
# One-time setup of Feuillet on this server: web root, Apache virtual host,
# collaboration server (Docker) and HTTPS certificate. Run with sudo:
#   sudo deploy/install.sh
set -euo pipefail

DOMAIN=feuillet.slashbin.net
WEBROOT=/var/www/$DOMAIN
HERE=$(cd "$(dirname "$0")" && pwd)
OWNER=${SUDO_USER:-root}

if [ "$(id -u)" -ne 0 ]; then
	echo "Run with sudo: sudo $0" >&2
	exit 1
fi

echo "== Web root $WEBROOT (owned by $OWNER, filled by deploy/publish.sh)"
install -d -o "$OWNER" -g www-data -m 2775 "$WEBROOT"

echo "== Apache virtual host"
a2enmod -q proxy proxy_http proxy_wstunnel headers rewrite ssl
if [ -e "/etc/apache2/sites-available/$DOMAIN-le-ssl.conf" ]; then
	echo "HTTPS host already set up by certbot; leaving the Apache files as they are."
else
	install -m 644 "$HERE/apache/$DOMAIN.conf" "/etc/apache2/sites-available/$DOMAIN.conf"
	a2ensite -q "$DOMAIN"
fi
apache2ctl configtest
systemctl reload apache2

echo "== Collaboration server"
docker compose -f "$HERE/docker-compose.yml" up -d --build
for _ in $(seq 1 30); do
	if curl -fsS http://127.0.0.1:1234/health >/dev/null; then break; fi
	sleep 1
done
curl -fsS http://127.0.0.1:1234/health && echo

echo "== HTTPS certificate"
if getent hosts "$DOMAIN" >/dev/null; then
	certbot --apache -d "$DOMAIN" --redirect
else
	echo "$DOMAIN does not resolve yet. Create the DNS record, then run:"
	echo "  sudo certbot --apache -d $DOMAIN --redirect"
fi

echo "Done. Publish the application with: deploy/publish.sh (no sudo needed)"
