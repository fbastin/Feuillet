#!/usr/bin/env bash
# deploy/publish.sh
# Builds Feuillet and copies it to the web root served by Apache. Needs no
# sudo once deploy/install.sh has created the web root.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WEBROOT=${WEBROOT:-/var/www/feuillet.slashbin.net}

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
rsync -a --delete dist/ "$WEBROOT/"
echo "Published $(git rev-parse --short HEAD) to $WEBROOT"
