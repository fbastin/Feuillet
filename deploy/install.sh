#!/usr/bin/env bash
# deploy/install.sh
# Sets up or updates Feuillet on this server: web root, Apache virtual host,
# nightly backups, collaboration and TeX Live servers (Docker) and HTTPS
# certificate. Safe to run again after an update. Run with sudo:
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
# copy, before </VirtualHost>. A route goes to the server's root, or with a
# fifth argument to that path (and without WebSocket).
add_proxy_route() {
	local conf=$1 route=$2 port=$3 comment=$4 target=${5:-}
	grep -q "ProxyPass  *$route " "$conf" && return 0
	local backup
	backup="$conf.avant-$(date +%Y%m%d-%H%M%S)"
	cp "$conf" "$backup"
	awk -v route="$route" -v port="$port" -v comment="$comment" -v target="$target" '
		/<\/VirtualHost>/ && !done {
			print "    # " comment
			if (target == "") {
				print "    ProxyPass        " route " http://127.0.0.1:" port "/ upgrade=websocket"
				print "    ProxyPassReverse " route " http://127.0.0.1:" port "/"
			} else {
				print "    ProxyPass        " route " http://127.0.0.1:" port target
			}
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
	# Where applications such as Claude look for how to sign in to the
	# collaboration server's /collab/mcp (server/collab/oauth.js).
	add_proxy_route "$SSL_CONF" /.well-known/oauth-authorization-server 1234 "Sign-in for assistants (server/collab/oauth.js)." /.well-known/oauth-authorization-server
	add_proxy_route "$SSL_CONF" /.well-known/oauth-protected-resource 1234 "Sign-in for assistants (server/collab/oauth.js)." /.well-known/oauth-protected-resource
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
# Emails (recovering accounts, invitations): an SMTP server and a sender (see
# deploy/README.md); empty keeps it off.
SMTP_URL=
MAIL_FROM=
SETTINGS
	echo "Created /etc/feuillet/collab.env (GitHub sign-in stays off until it is filled in)."
fi

echo "== Backups (deploy/backup.sh, each night at 4:30, in /var/backups/feuillet)"
# Root's own copies: cron runs no file that another account may change.
install -o root -g root -m 755 "$HERE/backup.sh" /usr/local/sbin/feuillet-backup
install -o root -g root -m 755 "$HERE/restore.sh" /usr/local/sbin/feuillet-restore
if [ ! -e /etc/cron.d/feuillet-backup ]; then
	cat >/etc/cron.d/feuillet-backup <<'CRON'
# Feuillet: each night, a backup of the collaboration server's data
# (deploy/backup.sh; settings in /etc/feuillet/backup.env).
30 4 * * * root /usr/local/sbin/feuillet-backup >>/var/log/feuillet-backup.log 2>&1
CRON
	echo "Created /etc/cron.d/feuillet-backup."
fi
# Before an update, as it is.
if docker inspect feuillet-collab >/dev/null 2>&1; then
	/usr/local/sbin/feuillet-backup 2>&1 | tee -a /var/log/feuillet-backup.log ||
		echo "The backup failed; the update goes on."
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
