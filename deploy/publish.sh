#!/usr/bin/env bash
# deploy/publish.sh
# Builds Feuillet and copies it to the web root served by Apache, for the
# server's address that deploy/install.sh kept in /etc/feuillet/site.env.
# Needs no sudo once deploy/install.sh has created the web root.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SITE_ENV=/etc/feuillet/site.env
saved_domain() {
	if [ -r "$SITE_ENV" ]; then sed -n 's/^DOMAIN=//p' "$SITE_ENV" | tail -n 1; fi
}
DOMAIN=${DOMAIN:-$(saved_domain)}
# Installed before the address was a setting.
if [ -z "$DOMAIN" ] && [ -d /var/www/feuillet.slashbin.net ]; then
	DOMAIN=feuillet.slashbin.net
fi
if [ -z "$DOMAIN" ]; then
	echo "No server address in $SITE_ENV: run sudo deploy/install.sh <address> first." >&2
	exit 1
fi
if ! [[ $DOMAIN =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
	echo "\"$DOMAIN\" is not a server address (such as feuillet.example.org, in lowercase)." >&2
	exit 1
fi
WEBROOT=${WEBROOT:-/var/www/$DOMAIN}

if [ ! -w "$WEBROOT" ]; then
	echo "$WEBROOT is missing or not writable; run sudo deploy/install.sh first." >&2
	exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
	echo "Node.js 22 or newer is required (found $(node --version))." >&2
	exit 1
fi

cd "$ROOT"
[ -d node_modules ] || npm ci
npm run build
# The collaboration and TeX Live servers the app goes to by default: this
# server's own (texlyre.config.ts names feuillet.slashbin.net's).
# (The .local ones, for development, name localhost's.)
sed -i "s#wss://feuillet\.slashbin\.net/#wss://$DOMAIN/#g" dist/userdata.json dist/userdata.mobile.json
for file in dist/userdata.json dist/userdata.mobile.json; do
	if ! grep -qF "\"wss://$DOMAIN/collab\"" "$file" ||
		! grep -qF "\"wss://$DOMAIN/texlive/\"" "$file"; then
		echo "$file does not name the servers of $DOMAIN; nothing was published." >&2
		exit 1
	fi
done
rsync -a --delete dist/ "$WEBROOT/"
echo "Published $(git rev-parse --short HEAD) to $WEBROOT, for https://$DOMAIN"
