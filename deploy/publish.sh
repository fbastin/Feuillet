#!/usr/bin/env bash
# deploy/publish.sh
# Publishes Feuillet's application to the web root, for the server's address
# that deploy/install.sh kept in /etc/feuillet/site.env. Needs no sudo once
# deploy/install.sh has created the web root.
#   deploy/publish.sh             builds it here with Node.js 22 or newer if
#                                 there is one, otherwise downloads it
#   deploy/publish.sh --build     builds it here
#   deploy/publish.sh --download  takes the archive GitHub built for this
#                                 commit (.github/workflows/app-archive.yml):
#                                 no Node.js, nor 3 GB and minutes of build
# Downloads come from the pre-release "app-builds" of the repository this
# copy was cloned from (or FEUILLET_RELEASES, such as
# https://github.com/owner/repo/releases/download/app-builds), and are
# checked against the SHA-256 sums of their manifest. The compilers that run
# in the browser (core/, 600 MB) are kept in ~/.cache/feuillet and
# downloaded again only when they change.
set -euo pipefail

MODE=auto
case ${1:-} in
'') ;;
--build) MODE=build ;;
--download) MODE=download ;;
*)
	echo "Usage: $0 [--build | --download]" >&2
	exit 1
	;;
esac

ROOT=$(cd "$(dirname "$0")/.." && pwd)
# core/, when it comes from the cache rather than with the rest.
CORE=
SITE_ENV=/etc/feuillet/site.env
saved_domain() {
	if [ -r "$SITE_ENV" ]; then sed -n 's/^DOMAIN=//p' "$SITE_ENV" | tail -n 1; fi
}
DOMAIN=${DOMAIN:-$(saved_domain)}
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

node_major() {
	"$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}
# Node.js 22 or newer: with nvm, the newest one installed when the default
# is older (nvm's default stays as it is).
find_node() {
	if [ "$(node_major node)" -lt 22 ]; then
		while IFS= read -r bin; do
			if [ "$(node_major "$bin/node")" -ge 22 ]; then
				PATH=$bin:$PATH
				echo "Building with Node.js $(node --version), from nvm ($bin)."
				break
			fi
		done < <(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/v*/bin 2>/dev/null | sort -V -r)
	fi
	[ "$(node_major node)" -ge 22 ]
}

if [ "$MODE" = auto ]; then
	if find_node; then MODE=build; else MODE=download; fi
elif [ "$MODE" = build ] && ! find_node; then
	echo "Node.js 22 or newer is required (found $(node --version 2>/dev/null || echo none))." >&2
	echo "With nvm: nvm install 22 (docs/en/hosting.md); or, without a build: $0 --download" >&2
	exit 1
fi

cd "$ROOT"
COMMIT=$(git rev-parse HEAD)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

build() {
	[ -d node_modules ] || npm ci
	npm run build
	OUT=$ROOT/dist
	HOW="built here"
}

# The releases of the repository this copy comes from, on GitHub.
releases() {
	if [ -n "${FEUILLET_RELEASES:-}" ]; then
		echo "${FEUILLET_RELEASES%/}"
		return
	fi
	local origin
	origin=$(git remote get-url origin 2>/dev/null || true)
	if [[ $origin =~ github\.com[:/]([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$ ]]; then
		echo "https://github.com/${BASH_REMATCH[1]}/${BASH_REMATCH[2]%.git}/releases/download/app-builds"
	fi
}

# A file of the releases, checked against its SHA-256 sum.
fetch() {
	local name=$1 sum=$2 target=$3
	echo "Downloading $name..."
	curl -fL --retry 3 --progress-bar -o "$target" "$BASE/$name"
	if [ "$(sha256sum "$target" | cut -d' ' -f1)" != "$sum" ]; then
		echo "$name does not match its manifest's SHA-256 sum; nothing was published." >&2
		exit 1
	fi
}

download() {
	for tool in curl tar sha256sum rsync; do
		command -v "$tool" >/dev/null || {
			echo "$tool is missing: sudo apt install $tool" >&2
			exit 1
		}
	done
	# What GitHub built is the commit as it is there.
	if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
		echo "This copy has local changes, which no archive holds: publish them with a build ($0 --build)." >&2
		exit 1
	fi
	BASE=$(releases)
	if [ -z "$BASE" ]; then
		echo "This copy does not come from GitHub: set FEUILLET_RELEASES to the address of its archives, or build ($0 --build)." >&2
		exit 1
	fi
	local manifest=$WORK/manifest.txt
	if ! curl -fsSL --retry 3 -o "$manifest" "$BASE/feuillet-app-$COMMIT.txt"; then
		echo "No archive of $(git rev-parse --short HEAD) at $BASE." >&2
		echo "GitHub builds one some ten minutes after each push to main (Actions, \"App archive\"), and keeps those of the 15 latest commits:" >&2
		echo "try again later, update this copy (git pull), or build ($0 --build)." >&2
		exit 1
	fi
	value() { sed -n "s/^$1=//p" "$manifest" | head -n 1; }
	local app_sum core core_sum
	app_sum=$(value app_sha256)
	core=$(value core)
	core_sum=$(value core_sha256)
	if [ "$(value commit)" != "$COMMIT" ] || ! [[ $app_sum =~ ^[0-9a-f]{64}$ && $core =~ ^[0-9a-f]{16}$ && $core_sum =~ ^[0-9a-f]{64}$ ]]; then
		echo "The manifest of $COMMIT is not as expected; nothing was published." >&2
		exit 1
	fi

	OUT=$WORK/dist
	mkdir -p "$OUT"
	fetch "feuillet-app-$COMMIT.tar.gz" "$app_sum" "$WORK/app.tar.gz"
	# The files take today's date, which the web server's ETags go by.
	tar -xzmf "$WORK/app.tar.gz" -C "$OUT"
	rm "$WORK/app.tar.gz"

	# core/, kept from one publication to the next while it stays the same.
	local cache=${XDG_CACHE_HOME:-$HOME/.cache}/feuillet
	mkdir -p "$cache"
	if [ ! -e "$cache/core-$core/.complete" ]; then
		fetch "feuillet-core-$core.tar.gz" "$core_sum" "$cache/core-$core.tar.gz"
		rm -rf "$cache/core-$core"
		mkdir -p "$cache/core-$core"
		tar -xzmf "$cache/core-$core.tar.gz" -C "$cache/core-$core"
		rm "$cache/core-$core.tar.gz"
		touch "$cache/core-$core/.complete"
		# Only this one is kept.
		find "$cache" -mindepth 1 -maxdepth 1 -name 'core-*' ! -name "core-$core" -exec rm -rf {} +
	fi
	CORE=$cache/core-$core
	HOW="downloaded from $BASE"
}

if [ "$MODE" = build ]; then build; else download; fi

# The collaboration and TeX Live servers the app goes to by default: this
# server's own (texlyre.config.ts names feuillet.slashbin.net's).
# (The .local ones, for development, name localhost's.)
sed -i "s#wss://feuillet\.slashbin\.net/#wss://$DOMAIN/#g" "$OUT/userdata.json" "$OUT/userdata.mobile.json"
for file in "$OUT/userdata.json" "$OUT/userdata.mobile.json"; do
	if ! grep -qF "\"wss://$DOMAIN/collab\"" "$file" ||
		! grep -qF "\"wss://$DOMAIN/texlive/\"" "$file"; then
		echo "$file does not name the servers of $DOMAIN; nothing was published." >&2
		exit 1
	fi
done
# Files whose content is the same are left as they are, with their date,
# which the web server's ETags go by; the others take today's.
copy() { rsync -a --no-times --checksum --delete "$@"; }
if [ -n "$CORE" ]; then
	copy --exclude=.complete "$CORE/" "$WEBROOT/core/"
	copy --exclude=/core "$OUT/" "$WEBROOT/"
else
	copy "$OUT/" "$WEBROOT/"
fi
echo "Published $(git rev-parse --short HEAD) to $WEBROOT, for https://$DOMAIN ($HOW)"
