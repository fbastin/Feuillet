#!/usr/bin/env bash
# deploy/restore.sh
# Puts back a backup made by deploy/backup.sh: every volume of the
# collaboration server becomes as it was then. Everything changed since is
# lost from the server, but first the current data is backed up too, so a
# restore can be undone the same way. Run as root:
#   sudo deploy/restore.sh /var/backups/feuillet/2026-11-03T043000
# (installed as /usr/local/sbin/feuillet-restore). --yes skips the question.
set -euo pipefail

DOCKER=${FEUILLET_DOCKER:-docker}
CONTAINER=feuillet-collab
VOLUMES=(data files accounts shares history mcp)
# In backups made since these volumes exist; one a backup does not hold
# stays as it is (the Git repositories catch up with the projects).
OPTIONAL_VOLUMES=(git)
HERE=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
if [ -x "$HERE/feuillet-backup" ]; then
	BACKUP=$HERE/feuillet-backup
else
	BACKUP=$HERE/backup.sh
fi

source=${1:-}
answer=${2:-}
if [ -z "$source" ] || [ ! -d "$source" ]; then
	echo "Usage: $0 BACKUP_FOLDER [--yes], such as /var/backups/feuillet/2026-11-03T043000" >&2
	exit 2
fi
source=$(cd "$source" && pwd)

# All of it, readable, before touching anything.
for volume in "${VOLUMES[@]}"; do
	archive=$source/$volume.tar.gz
	[ -f "$archive" ] || {
		echo "$archive is missing: not a whole backup." >&2
		exit 1
	}
	gzip -t "$archive" || {
		echo "$archive is damaged." >&2
		exit 1
	}
done
RESTORED=("${VOLUMES[@]}")
for volume in "${OPTIONAL_VOLUMES[@]}"; do
	archive=$source/$volume.tar.gz
	[ -f "$archive" ] || continue
	gzip -t "$archive" || {
		echo "$archive is damaged." >&2
		exit 1
	}
	RESTORED+=("$volume")
done
[ -f "$source/info.txt" ] && cat "$source/info.txt"

if [ "$answer" != --yes ]; then
	read -rp "Replace all of the server's data with this backup? Type yes: " reply
	[ "$reply" = yes ] || {
		echo "Nothing changed."
		exit 1
	}
fi

echo "== The current data first"
# Without removing older backups: the one being restored may be the oldest.
FEUILLET_BACKUP_KEEP=0 FEUILLET_BACKUP_NO_COPY=1 "$BACKUP"

echo "== Restoring $source"
$DOCKER stop "$CONTAINER" >/dev/null
for volume in "${RESTORED[@]}"; do
	mount=$($DOCKER volume inspect --format '{{ .Mountpoint }}' "feuillet_collab-$volume")
	[ -d "$mount" ] || {
		echo "Volume feuillet_collab-$volume not found; $CONTAINER stays stopped." >&2
		exit 1
	}
	find "$mount" -mindepth 1 -delete
	tar -C "$mount" -xzf "$source/$volume.tar.gz" || {
		echo "Could not restore $volume; $CONTAINER stays stopped. Restore the backup just made the same way." >&2
		exit 1
	}
done
$DOCKER start "$CONTAINER" >/dev/null
echo "Restored $source; $CONTAINER started again."
