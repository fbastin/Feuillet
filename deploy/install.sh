#!/usr/bin/env bash
# deploy/install.sh
# Sets up or updates Feuillet on this server: web root, web server (Apache
# or nginx), nightly backups, collaboration and TeX Live servers (Docker)
# and HTTPS certificate. Safe to run again after an update. Run with sudo,
# giving the server's address the first time, and the web server if both
# are installed (they are kept in /etc/feuillet/site.env); "none" leaves the
# web server and its certificate to you (deploy/README.md, "Another web
# server"):
#   sudo deploy/install.sh feuillet.example.org
#   sudo deploy/install.sh feuillet.example.org nginx
#   sudo deploy/install.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
	echo "Run with sudo: sudo $0 $*" >&2
	exit 1
fi

# The server's address, which the web server, the certificate, the servers
# (deploy/docker-compose.yml) and deploy/publish.sh go by; and the web server.
SITE_ENV=/etc/feuillet/site.env
saved() {
	if [ -r "$SITE_ENV" ]; then sed -n "s/^$1=//p" "$SITE_ENV" | tail -n 1; fi
}
SAVED=$(saved DOMAIN)
SAVED_WEB=$(saved WEB)
DOMAIN=${1:-$SAVED}
# Installed before the address was a setting.
if [ -z "$DOMAIN" ] && [ -d /var/www/feuillet.slashbin.net ]; then
	DOMAIN=feuillet.slashbin.net
fi
if [ -z "$DOMAIN" ]; then
	echo "Give this server's address, the name its DNS record points here:" >&2
	echo "  sudo $0 feuillet.example.org" >&2
	exit 1
fi
if ! [[ $DOMAIN =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
	echo "\"$DOMAIN\" is not a server address (such as feuillet.example.org, in lowercase)." >&2
	exit 1
fi
if [ -n "$SAVED" ] && [ "$DOMAIN" != "$SAVED" ]; then
	echo "This server is set up for $SAVED ($SITE_ENV). To move it to $DOMAIN," >&2
	echo "change DOMAIN= there, then run sudo $0 again." >&2
	exit 1
fi

WEB=${2:-$SAVED_WEB}
if [ -z "$WEB" ]; then
	if [ -d "/var/www/$DOMAIN" ]; then
		# Installed before the web server was a setting: with Apache.
		WEB=apache
	elif command -v apache2ctl >/dev/null && ! command -v nginx >/dev/null; then
		WEB=apache
	elif command -v nginx >/dev/null && ! command -v apache2ctl >/dev/null; then
		WEB=nginx
	elif command -v nginx >/dev/null; then
		echo "Apache and nginx are both installed: name the one Feuillet goes through:" >&2
		echo "  sudo $0 $DOMAIN apache    (or nginx)" >&2
		exit 1
	else
		echo "Install a web server first, Apache or nginx (docs/en/hosting.md), or" >&2
		echo "set up your own (deploy/README.md, \"Another web server\"):" >&2
		echo "  sudo $0 $DOMAIN none" >&2
		exit 1
	fi
fi
case $WEB in
apache | nginx | none) ;;
*)
	echo "\"$WEB\" is not a web server Feuillet installs with: apache, nginx or none." >&2
	exit 1
	;;
esac
if [ -n "$SAVED_WEB" ] && [ "$WEB" != "$SAVED_WEB" ]; then
	echo "This server goes through $SAVED_WEB ($SITE_ENV). To move it to $WEB," >&2
	echo "change WEB= there, then run sudo $0 again." >&2
	exit 1
fi
install -d -m 755 /etc/feuillet
# A value of site.env, the file's other lines kept.
set_site() {
	if grep -q "^$1=" "$SITE_ENV"; then
		sed -i "s#^$1=.*#$1=$2#" "$SITE_ENV"
	else
		printf '%s=%s\n' "$1" "$2" >>"$SITE_ENV"
	fi
}
if [ ! -e "$SITE_ENV" ]; then
	cat >"$SITE_ENV" <<'SITE'
# Feuillet: this server's address and web server, set by deploy/install.sh
# and read by deploy/publish.sh and deploy/docker-compose.yml.
SITE
	chmod 644 "$SITE_ENV"
fi
if [ "$DOMAIN" != "$SAVED" ] || [ "$WEB" != "$SAVED_WEB" ]; then
	set_site DOMAIN "$DOMAIN"
	set_site WEB "$WEB"
	echo "Saved DOMAIN=$DOMAIN and WEB=$WEB in $SITE_ENV."
fi

WEBROOT=/var/www/$DOMAIN
HERE=$(cd "$(dirname "$0")" && pwd)
OWNER=${SUDO_USER:-root}
SITES=/etc/apache2/sites-available
SSL_CONF=$SITES/$DOMAIN-le-ssl.conf
# The TeX Live server has no network: the web server and the collaboration
# server reach it through this socket, in a directory of the group www-data
# only (Apache's and nginx's on Debian and Ubuntu).
TEXLIVE_SOCKET_DIR=/var/lib/feuillet/texlive-socket
TEXLIVE_SOCKET=$TEXLIVE_SOCKET_DIR/texlive.sock
COMPOSE=(docker compose --env-file "$SITE_ENV" -f "$HERE/docker-compose.yml")

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

# Sends /texlive/ to the TeX Live server's socket, in place of the address of
# an older install (127.0.0.1:7045); with a third argument, adds the route to
# a virtual host that has none.
texlive_socket_route() {
	local conf=$1 add=${2:-}
	[ -e "$conf" ] || return 0
	grep -qF "unix:$TEXLIVE_SOCKET|" "$conf" && return 0
	local present=
	grep -q "ProxyPass  *\/texlive\/ " "$conf" && present=1
	[ -n "$present" ] || [ -n "$add" ] || return 0
	local pass="    ProxyPass        /texlive/ \"unix:$TEXLIVE_SOCKET|http://localhost/\" upgrade=websocket"
	local reverse="    ProxyPassReverse /texlive/ http://localhost/"
	local backup
	backup="$conf.avant-$(date +%Y%m%d-%H%M%S)"
	cp "$conf" "$backup"
	if [ -n "$present" ]; then
		awk -v pass="$pass" -v reverse="$reverse" '
			/^[[:space:]]*ProxyPass[[:space:]]+\/texlive\// { print pass; next }
			/^[[:space:]]*ProxyPassReverse[[:space:]]+\/texlive\// { print reverse; next }
			{ print }
		' "$backup" >"$conf"
	else
		awk -v pass="$pass" -v reverse="$reverse" '
			/<\/VirtualHost>/ && !done {
				print "    # TeX Live compile server, through its socket (deploy/docker-compose.yml)."
				print pass
				print reverse
				print ""
				done = 1
			}
			{ print }
		' "$backup" >"$conf"
	fi
	echo "Sent /texlive/ to $TEXLIVE_SOCKET in $conf (previous version: $backup)"
}

echo "== Web root $WEBROOT (owned by $OWNER, filled by deploy/publish.sh)"
install -d -o "$OWNER" -g www-data -m 2775 "$WEBROOT"

# Apache: the virtual host once; certbot copies it into $SSL_CONF (HTTPS),
# to which later runs add the routes it lacks.
apache_site() {
	a2enmod -q proxy proxy_http proxy_wstunnel headers rewrite ssl
	if [ -e "$SSL_CONF" ]; then
		add_proxy_route "$SSL_CONF" /collab/ 1234 "Real-time collaboration server (deploy/docker-compose.yml)."
		# /texlive/ follows the TeX Live server once it runs, further down.
		# Where applications such as Claude look for how to sign in to the
		# collaboration server's /collab/mcp (server/collab/oauth.js).
		add_proxy_route "$SSL_CONF" /.well-known/oauth-authorization-server 1234 "Sign-in for assistants (server/collab/oauth.js)." /.well-known/oauth-authorization-server
		add_proxy_route "$SSL_CONF" /.well-known/oauth-protected-resource 1234 "Sign-in for assistants (server/collab/oauth.js)." /.well-known/oauth-protected-resource
		add_proxy_route "$SSL_CONF" /docs 1234 "« Ouvrir dans Feuillet » links and forms, as Overleaf's /docs (server/collab/docs.js)." /docs
	else
		sed "s/@DOMAIN@/$DOMAIN/g" "$HERE/apache/feuillet.conf" >"$SITES/$DOMAIN.conf"
		chmod 644 "$SITES/$DOMAIN.conf"
		a2ensite -q "$DOMAIN"
	fi
	apache2ctl configtest
	systemctl reload apache2
}

# nginx: the site once (certbot --nginx then adds HTTPS to it); its routes
# and maps at each run, so that an update reaches them.
nginx_site() {
	local site=/etc/nginx/sites-available/$DOMAIN
	install -d -m 755 /etc/nginx/snippets
	sed "s/@DOMAIN@/$DOMAIN/g" "$HERE/nginx/routes.conf" >/etc/nginx/snippets/feuillet.conf
	chmod 644 /etc/nginx/snippets/feuillet.conf
	install -m 644 "$HERE/nginx/maps.conf" /etc/nginx/conf.d/feuillet.conf
	if [ ! -e "$site" ]; then
		sed "s/@DOMAIN@/$DOMAIN/g" "$HERE/nginx/feuillet.conf" >"$site"
		chmod 644 "$site"
	fi
	ln -sfn "$site" "/etc/nginx/sites-enabled/$DOMAIN"
	nginx -t
	systemctl reload nginx
}

case $WEB in
nginx)
	echo "== nginx site"
	nginx_site
	;;
apache)
	echo "== Apache virtual host"
	apache_site
	;;
none)
	echo "== Web server: yours, with the routes of deploy/README.md (\"Another web server\")"
	;;
esac

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
# "Sign in with Google": create a Google OAuth client (see deploy/README.md),
# fill in its client id and secret, then run deploy/install.sh again.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# "Sign in with ORCID": register a client of ORCID's public API (see
# deploy/README.md), fill in its client id and secret, then run
# deploy/install.sh again.
ORCID_CLIENT_ID=
ORCID_CLIENT_SECRET=
# Emails (recovering accounts, invitations): an SMTP server and a sender (see
# deploy/README.md); empty keeps it off.
SMTP_URL=
MAIL_FROM=
# The accounts that see the administration page, by name, comma-separated.
ADMIN_ACCOUNTS=
# Who may create an account: open (anyone) or invitation (an invitation to a
# project, or a link from the administration page); with invitation,
# SIGN_UP_DOMAINS lets the addresses of these domains (comma-separated) ask
# for a link, mailed to them (see deploy/README.md).
SIGN_UP=open
SIGN_UP_DOMAINS=
SETTINGS
	echo "Created /etc/feuillet/collab.env (GitHub sign-in stays off until it is filled in)."
else
	if ! grep -q '^ADMIN_ACCOUNTS=' /etc/feuillet/collab.env; then
		printf '\n# The accounts that see the administration page, by name, comma-separated.\nADMIN_ACCOUNTS=\n' >>/etc/feuillet/collab.env
		echo "Added ADMIN_ACCOUNTS= to /etc/feuillet/collab.env: name there the accounts that administer Feuillet, then run deploy/install.sh again."
	fi
	if ! grep -q '^GOOGLE_CLIENT_ID=' /etc/feuillet/collab.env; then
		printf '\n# "Sign in with Google": create a Google OAuth client (see deploy/README.md),\n# fill in its client id and secret, then run deploy/install.sh again.\nGOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=\n' >>/etc/feuillet/collab.env
		echo "Added GOOGLE_CLIENT_ID= and GOOGLE_CLIENT_SECRET= to /etc/feuillet/collab.env: see deploy/README.md to sign in with Google."
	fi
	if ! grep -q '^SIGN_UP=' /etc/feuillet/collab.env; then
		printf '\n# Who may create an account: open (anyone) or invitation (an invitation to a\n# project, or a link from the administration page); with invitation,\n# SIGN_UP_DOMAINS lets the addresses of these domains (comma-separated) ask\n# for a link, mailed to them (see deploy/README.md).\nSIGN_UP=open\nSIGN_UP_DOMAINS=\n' >>/etc/feuillet/collab.env
		echo "Added SIGN_UP=open to /etc/feuillet/collab.env: SIGN_UP=invitation keeps new accounts to invitations (deploy/README.md)."
	fi
	if ! grep -q '^ORCID_CLIENT_ID=' /etc/feuillet/collab.env; then
		printf '\n# "Sign in with ORCID": register a client of ORCID'"'"'s public API (see\n# deploy/README.md), fill in its client id and secret, then run\n# deploy/install.sh again.\nORCID_CLIENT_ID=\nORCID_CLIENT_SECRET=\n' >>/etc/feuillet/collab.env
		echo "Added ORCID_CLIENT_ID= and ORCID_CLIENT_SECRET= to /etc/feuillet/collab.env: see deploy/README.md to sign in with ORCID."
	fi
fi

echo "== Compile tickets (server/collab/compileTickets.js)"
# The TeX Live servers compile only for the tickets that the collaboration
# server signs with this key, for accounts and the projects they own; they
# check them with its public key alone, in site.env.
if ! grep -q '^COMPILE_TICKET_KEY=.' /etc/feuillet/collab.env; then
	key=$(openssl genpkey -algorithm ed25519 -outform DER | base64 -w0)
	sed -i '/^COMPILE_TICKET_KEY=/d' /etc/feuillet/collab.env
	printf '\n# Signs the tickets to compile on the TeX Live servers, made by\n# deploy/install.sh: keep it secret. Without this line, it makes another.\nCOMPILE_TICKET_KEY=%s\n' "$key" >>/etc/feuillet/collab.env
	echo "Made the key of compile tickets, in /etc/feuillet/collab.env."
fi
if ! public=$(sed -n 's/^COMPILE_TICKET_KEY=//p' /etc/feuillet/collab.env | tail -n 1 |
	base64 -d 2>/dev/null | openssl pkey -inform DER -pubout -outform DER 2>/dev/null | base64 -w0) ||
	[ -z "$public" ]; then
	echo "COMPILE_TICKET_KEY in /etc/feuillet/collab.env is not a key: remove its line, then run sudo $0 again." >&2
	exit 1
fi
set_site COMPILE_TICKET_PUBLIC_KEY "$public"

echo "== Backups (deploy/backup.sh, each night at 4:30, in /var/backups/feuillet)"
# Root's own copies: cron runs no file that another account may change.
install -o root -g root -m 755 "$HERE/backup.sh" /usr/local/sbin/feuillet-backup
install -o root -g root -m 755 "$HERE/restore.sh" /usr/local/sbin/feuillet-restore
# How the last one went, which the collaboration server reads.
install -d -m 755 /var/lib/feuillet /var/lib/feuillet/backup-status
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

echo "== Collaboration, TeX Live and LanguageTool servers (the first builds download about 3 GB for each year of TeX Live, and 250 MB)"
install -d -o root -g www-data -m 0750 "$TEXLIVE_SOCKET_DIR"
"${COMPOSE[@]}" up -d --build
for _ in $(seq 1 60); do
	if curl -fsS http://127.0.0.1:1234/health >/dev/null; then break; fi
	sleep 1
done
curl -fsS http://127.0.0.1:1234/health && echo
for _ in $(seq 1 60); do
	if curl -fsS --unix-socket "$TEXLIVE_SOCKET" http://localhost/health >/dev/null; then break; fi
	sleep 1
done
curl -fsS --unix-socket "$TEXLIVE_SOCKET" http://localhost/health && echo
# The other years of TeX Live that projects may choose (OTHER_YEARS in
# docker-compose.yml), each on its own socket.
for socket in "$TEXLIVE_SOCKET_DIR"/texlive-[0-9][0-9][0-9][0-9].sock; do
	[ -S "$socket" ] || continue
	for _ in $(seq 1 60); do
		if curl -fsS --unix-socket "$socket" http://localhost/health >/dev/null; then break; fi
		sleep 1
	done
	echo "$(basename "$socket" .sock): $(curl -fsS --unix-socket "$socket" http://localhost/health || echo 'not answering')"
done
# When the latest TeX Live moves to a new year, the projects that chose the
# previous one compile with the new one until a server offers it.
year=$(curl -fsS --unix-socket "$TEXLIVE_SOCKET" http://localhost/health | sed -n 's/.*"year":\([0-9]\{4\}\).*/\1/p')
if [ -n "$year" ]; then
	previous=$(cat /var/lib/feuillet/texlive-year 2>/dev/null || true)
	if [ -n "$previous" ] && [ "$previous" != "$year" ]; then
		echo "TeX Live is now $year (it was $previous). Projects that chose TeX Live $previous compile with $year until a server offers it: see \"Years of TeX Live\" in deploy/README.md."
	fi
	echo "$year" >/var/lib/feuillet/texlive-year
fi
# LanguageTool has no way in from here (its network is internal): its
# container says how it is.
for _ in $(seq 1 90); do
	if [ "$(docker inspect --format '{{.State.Health.Status}}' feuillet-languagetool 2>/dev/null)" = healthy ]; then break; fi
	sleep 2
done
echo "LanguageTool: $(docker inspect --format '{{.State.Health.Status}}' feuillet-languagetool 2>/dev/null || echo missing)"

if [ "$WEB" = apache ]; then
	echo "== Apache: /texlive/ through the TeX Live server's socket"
	texlive_socket_route "$SSL_CONF" add
	texlive_socket_route "$SITES/$DOMAIN.conf"
	apache2ctl configtest
	systemctl reload apache2
fi

echo "== HTTPS certificate"
if [ "$WEB" = none ]; then
	echo "Left to your web server, for $DOMAIN."
elif [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
	echo "Certificate already present; certbot renews it automatically."
elif getent hosts "$DOMAIN" >/dev/null; then
	certbot "--$WEB" -d "$DOMAIN" --redirect
else
	echo "$DOMAIN does not resolve yet. Create the DNS record, then run:"
	echo "  sudo certbot --$WEB -d $DOMAIN --redirect"
fi

echo "Done. Publish the application with: deploy/publish.sh (no sudo needed)"
