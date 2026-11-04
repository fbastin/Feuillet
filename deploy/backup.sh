#!/usr/bin/env bash
# deploy/backup.sh
# Copies the collaboration server's data, its six Docker volumes (the
# documents, files, accounts, project links, versions and assistant
# connections), into a dated folder of BACKUP_DIR, one archive per volume,
# and keeps the latest BACKUP_KEEP. The server is paused while the volumes
# are read, usually a few seconds: open connections wait, and the copy is
# what a sudden stop would have left, which the documents' database
# (LevelDB) recovers from; account files are always written whole.
#
# install.sh installs it as /usr/local/sbin/feuillet-backup, which
# /etc/cron.d/feuillet-backup runs each night, and runs it before each
# update; deploy/restore.sh puts a backup back. Run as root.
#
# Optional settings, in /etc/feuillet/backup.env:
#   BACKUP_DIR=/var/backups/feuillet   where backups go
#   BACKUP_KEEP=14                     how many to keep (0: all)
#   BACKUP_COPY_TO=user@host:feuillet/ also copy them there with rsync, off
#                                      this machine, whose disk could fail;
#                                      or to a folder of another disk, such
#                                      as /media/usb/feuillet-backups, which
#                                      must exist and keeps the latest
#                                      BACKUP_KEEP too. Each copy brings the
#                                      backups the last ones missed.
#   BACKUP_STATUS_DIR=/var/lib/feuillet/backup-status
#                                      where it tells how it went, for the
#                                      administration page (server/collab/
#                                      admin.js): backup.json, the last backup,
#                                      and backup-failed.json, a failure since
set -euo pipefail

ENV_FILE=${FEUILLET_BACKUP_ENV:-/etc/feuillet/backup.env}
if [ -r "$ENV_FILE" ]; then
	# shellcheck disable=SC1090
	. "$ENV_FILE"
fi
BACKUP_DIR=${BACKUP_DIR:-/var/backups/feuillet}
# restore.sh keeps every backup and copies none.
BACKUP_KEEP=${FEUILLET_BACKUP_KEEP:-${BACKUP_KEEP:-14}}
BACKUP_COPY_TO=${BACKUP_COPY_TO:-}
if [ -n "${FEUILLET_BACKUP_NO_COPY:-}" ]; then BACKUP_COPY_TO=; fi
BACKUP_STATUS_DIR=${BACKUP_STATUS_DIR:-/var/lib/feuillet/backup-status}
DOCKER=${FEUILLET_DOCKER:-docker}
CONTAINER=feuillet-collab
VOLUMES=(data files accounts shares history mcp)
# Volumes newer servers make (git: the projects' Git repositories), backed
# up once they exist.
OPTIONAL_VOLUMES=(git)
STAMP_PATTERN='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}$'

log() { echo "$(date -Is) $*"; }

# A JSON string, without control characters.
json_string() {
	local value=${1//\\/\\\\}
	value=${value//\"/\\\"}
	printf '"%s"' "$(printf '%s' "$value" | tr -d '\000-\037')"
}
# How it went, for the administration page, readable by the collaboration
# server's container; never a reason for the backup to fail.
write_status() {
	local name=$1 content=$2
	mkdir -p "$BACKUP_STATUS_DIR" && chmod 755 "$BACKUP_STATUS_DIR" || return 0
	local temp=$BACKUP_STATUS_DIR/.$name.$$
	if printf '%s\n' "$content" >"$temp" && chmod 644 "$temp"; then
		mv -f "$temp" "$BACKUP_STATUS_DIR/$name" || rm -f "$temp"
	else
		rm -f "$temp"
	fi
}

fail() {
	log "backup failed: $*"
	write_status backup-failed.json "{\"time\":$(json_string "$(date -Is)"),\"error\":$(json_string "$*")}" || true
	exit 1
}

case $BACKUP_KEEP in
'' | *[!0-9]*) fail "BACKUP_KEEP must be a number" ;;
esac

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Where each volume is, and whether the backup fits.
declare -A MOUNT
TAKEN=()
needed=0
for volume in "${VOLUMES[@]}"; do
	mount=$($DOCKER volume inspect --format '{{ .Mountpoint }}' "feuillet_collab-$volume") ||
		fail "no volume feuillet_collab-$volume"
	[ -d "$mount" ] || fail "volume feuillet_collab-$volume not found at $mount"
	MOUNT[$volume]=$mount
	TAKEN+=("$volume")
done
for volume in "${OPTIONAL_VOLUMES[@]}"; do
	mount=$($DOCKER volume inspect --format '{{ .Mountpoint }}' "feuillet_collab-$volume" 2>/dev/null) || continue
	[ -d "$mount" ] || continue
	MOUNT[$volume]=$mount
	TAKEN+=("$volume")
done
for volume in "${TAKEN[@]}"; do
	size=$(du -sk "${MOUNT[$volume]}" | cut -f1) || fail "cannot read ${MOUNT[$volume]}"
	needed=$((needed + size))
done
free=$(df -Pk "$BACKUP_DIR" | awk 'NR == 2 { print $4 }')
if [ "$free" -lt $((needed + 100 * 1024)) ]; then
	fail "$((needed / 1024)) MB to copy, only $((free / 1024)) MB free in $BACKUP_DIR"
fi

stamp=$(date +%Y-%m-%dT%H%M%S)
target=$BACKUP_DIR/$stamp
partial=$target.partial
[ -e "$target" ] && fail "$target already exists"
mkdir "$partial"

paused=
resume() {
	if [ -n "$paused" ]; then
		$DOCKER unpause "$CONTAINER" >/dev/null || log "could not resume $CONTAINER"
		paused=
	fi
}
# Whatever happens, the server runs again and no half backup stays.
trap 'resume; rm -rf "$partial"' EXIT

started=$(date +%s)
if [ "$($DOCKER inspect --format '{{ .State.Running }}' "$CONTAINER" 2>/dev/null || true)" = true ]; then
	$DOCKER pause "$CONTAINER" >/dev/null
	paused=1
fi
# Read while paused, compressed after.
for volume in "${TAKEN[@]}"; do
	tar -C "${MOUNT[$volume]}" -cf "$partial/$volume.tar" . || fail "could not read $volume"
done
resume
pause_seconds=$(($(date +%s) - started))

{
	echo "Feuillet backup of $(date -Is), server paused ${pause_seconds} s"
	for volume in "${TAKEN[@]}"; do
		echo "$volume: feuillet_collab-$volume, $(du -sk "${MOUNT[$volume]}" | cut -f1) KB, $(find "${MOUNT[$volume]}" -type f | wc -l) files"
	done
} >"$partial/info.txt"
for volume in "${TAKEN[@]}"; do
	gzip "$partial/$volume.tar"
	gzip -t "$partial/$volume.tar.gz" || fail "$volume.tar.gz is damaged"
done
mv "$partial" "$target"

# The backups of a folder, oldest first: only folders this script made.
backups_in() {
	find "$1" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | grep -E "$STAMP_PATTERN" | sort || true
}
# Keeps the latest BACKUP_KEEP of a folder; says how many went.
keep_latest() {
	local dir=$1 gone=0
	if [ "$BACKUP_KEEP" -gt 0 ]; then
		mapfile -t backups < <(backups_in "$dir")
		while [ "${#backups[@]}" -gt "$BACKUP_KEEP" ]; do
			rm -rf "${dir:?}/${backups[0]}"
			backups=("${backups[@]:1}")
			gone=$((gone + 1))
		done
	fi
	echo "$gone"
}
removed=$(keep_latest "$BACKUP_DIR")

# Copies every backup kept here that is not there yet, so that a night the
# other disk or host was away is made up for; why not, when it cannot.
copy_backups() {
	local dest=$BACKUP_COPY_TO
	mapfile -t backups < <(backups_in "$BACKUP_DIR")
	local sources=("${backups[@]/#/$BACKUP_DIR/}")
	if [[ $dest != /* ]]; then
		# Another host, whose old copies are its own to remove.
		rsync -a "${sources[@]}" "$dest" || { echo "rsync failed"; return 1; }
		return 0
	fi
	dest=${dest%/}
	# A disk that is not there leaves its mount point, an empty folder of
	# the system's disk: the copies would not be on another disk.
	[ -d "$dest" ] || { echo "$dest is missing: is its disk there?"; return 1; }
	if [ -z "${FEUILLET_BACKUP_ANY_DISK:-}" ] &&
		[ "$(stat -c %d "$dest")" = "$(stat -c %d "$BACKUP_DIR")" ]; then
		echo "$dest is on the same disk as $BACKUP_DIR"
		return 1
	fi
	rsync -a "${sources[@]}" "$dest/" || { echo "rsync failed"; return 1; }
	# As many as here: the privacy page says backups keep what was erased
	# for two weeks at most.
	keep_latest "$dest" >/dev/null
}

status=0
copy=none
if [ -n "$BACKUP_COPY_TO" ]; then
	if why=$(copy_backups 2>&1); then
		log "copied $stamp to $BACKUP_COPY_TO"
		copy=done
	else
		log "could not copy $stamp to $BACKUP_COPY_TO: ${why:-rsync failed}"
		status=1
		copy=failed
	fi
fi

kb=$(du -sk "$target" | cut -f1)
kept=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | grep -cE "$STAMP_PATTERN" || true)
write_status backup.json "{\"time\":$(json_string "$(date -Is)"),\"folder\":\"$stamp\",\"kb\":$kb,\"pausedSeconds\":$pause_seconds,\"kept\":$kept,\"keep\":$BACKUP_KEEP,\"copy\":\"$copy\"}" || true
rm -f "$BACKUP_STATUS_DIR/backup-failed.json"
log "backup $target: $kb KB, server paused ${pause_seconds} s, ${removed} old backup(s) removed"
exit "$status"
