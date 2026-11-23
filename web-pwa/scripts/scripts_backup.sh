#!/usr/bin/env bash
#
# scripts_backup.sh - Copy the backup scripts to Google Drive, Dropbox and Mega
#                     so they survive a full reinstall.
#
# Each script is uploaded as <name>_<timestamp>.sh into a scripts_backups/ folder
# on each cloud remote. Keeps the last KEEP_LAST copies per script per target.
#
# Usage:  ./scripts/scripts_backup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
[ -f /etc/backup-alerts.conf ] && . /etc/backup-alerts.conf

KEEP_LAST=5
DEST_BASE="scripts_backups"
STAMP="$(date '+%Y%m%d_%H%M%S')"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*"; }

command -v rclone >/dev/null 2>&1 || { log "ERROR: rclone not on PATH"; exit 1; }

# Sources: the git-push backup script (FHS location) and the DB backup script.
declare -a SOURCES=(
    "/usr/local/bin/backup_delivery.sh"
    "$PROJECT_ROOT/scripts/db_backup.sh"
)

# Remotes: force via /etc/backup-alerts.conf or auto-detect by type.
detect_remote() {
    local want="$1"
    rclone listremotes 2>/dev/null | sed 's/:$//' | while read -r rem; do
        local type
        type="$(rclone config show 2>/dev/null | awk -v r="$rem" '
            $0 == "[" r "]" { in_sec = 1; next }
            in_sec && /^\[/ { in_sec = 0 }
            in_sec && /^type[[:space:]]*=/ {
                sub(/^type[[:space:]]*=[[:space:]]*/, "")
                print; exit
            }
        ')"
        if [ "$type" = "$want" ]; then
            printf '%s' "$rem"
            return 0
        fi
    done
}

GDRIVE_REMOTE="${RCLONE_REMOTE:-$(detect_remote drive)}"
DROPBOX_REMOTE="${RCLONE_DROPBOX_REMOTE:-$(detect_remote dropbox)}"
MEGA_REMOTE="${RCLONE_MEGA_REMOTE:-$(detect_remote mega)}"

upload_to() {
    local label="$1" remote="$2"
    [ -z "$remote" ] && { log "Skipping ${label}: no remote configured"; return 0; }
    local dest="${remote}:${DEST_BASE}"
    local src
    for src in "${SOURCES[@]}"; do
        [ -f "$src" ] || { log "WARNING: source missing: $src"; continue; }
        local name base
        base="$(basename "$src")"
        name="${base%.sh}_${STAMP}.sh"
        local tmp
        tmp="$(mktemp /tmp/scriptbackup_XXXX.sh)"
        cp "$src" "$tmp"
        log "Uploading ${name} to ${label}: ${dest}"
        if rclone copyto "$tmp" "${dest}/${name}"; then
            log "Pruning ${name} history to last ${KEEP_LAST}"
            rclone lsf "$dest" 2>/dev/null | grep -E "^${base%.sh}_.*\.sh$" | sort | head -n -${KEEP_LAST} | while read -r old; do
                rclone delete "${dest}/${old}" >/dev/null 2>&1 || log "WARNING: could not delete ${old} from ${label}"
            done
        else
            log "ERROR: upload of ${name} to ${label} failed"
        fi
        rm -f "$tmp"
    done
}

upload_to "Google Drive" "$GDRIVE_REMOTE"
upload_to "Dropbox" "$DROPBOX_REMOTE"
upload_to "Mega" "$MEGA_REMOTE"

log "Script backup completed"
