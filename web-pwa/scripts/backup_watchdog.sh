#!/usr/bin/env bash
#
# backup_watchdog.sh - prove the backups are actually fresh, don't trust that
#                      a service "succeeded".
#
# A service can succeed while producing nothing useful, and a timer can simply
# stop firing (disabled unit, bad OnCalendar, a reboot that never came back).
# This script checks the *age of the newest artefact* for every backup path and
# alerts through backup_alert.sh when anything goes stale. It is itself driven
# by backup-watchdog.timer, so it runs even when the things it watches are dead.
#
# Thresholds (hours). Override in /etc/backup-alerts.conf if you change cadence.
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backups}"
SITE_LOG="/var/log/site-backup.log"
CONF_FILE="/etc/backup-alerts.conf"

MAX_LOCAL_AGE_H=3      # hourly job -> 3h is generous
MAX_DRIVE_AGE_H=3      # same dump, off-site copy
MAX_CLOUD_AGE_H=3      # object-storage copy of the same dump
MAX_SITE_AGE_H=2       # 30-minute cadence -> 2h is generous

ALERT_WEBHOOK=""
ALERT_COOLDOWN_HOURS=6
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

NOW="$(date +%s)"
alert() { "$SCRIPT_DIR/backup_alert.sh" "$@"; }

age_hours() {  # epoch -> whole hours
    echo $(( (NOW - $1) / 3600 ))
}

# ── 1) Are the timers actually installed and running? ─────────────────────────
for unit in backup-db.timer site-backup.timer; do
    if ! systemctl is-active --quiet "$unit"; then
        alert "systemd timer $unit is not active" \
              "The scheduled backup cannot run. Check: systemctl status $unit"
    fi
done

# ── 2) Newest local dump age ─────────────────────────────────────────────────
NEWEST_LOCAL="$(ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -n1 || true)"
if [ -z "$NEWEST_LOCAL" ]; then
    alert "No local database backup exists" "Nothing found in $BACKUP_DIR"
else
    AGE="$(age_hours "$(stat -c %Y "$NEWEST_LOCAL")")"
    if [ "$AGE" -ge "$MAX_LOCAL_AGE_H" ]; then
        alert "Local DB backup is stale (${AGE}h old)" \
              "Newest: $(basename "$NEWEST_LOCAL")  (threshold ${MAX_LOCAL_AGE_H}h)
Last run: $(journalctl -u backup-db.service -n 5 --no-pager 2>/dev/null | tail -n 3)"
    fi
fi

# ── 3) Off-site rclone targets: newest copy age for each ─────────────────────
# Newest timestamp in an `rclone lsl` listing (columns: size, date, time, path).
newest_remote_epoch() {   # $1 = remote:bucket
    local ts
    ts="$(rclone lsl "$1" 2>/dev/null | sort -k2,2 -k3,3 -r | head -n1 | awk '{print $2" "$3}')"
    [ -z "$ts" ] && return 1
    date -d "$ts" +%s 2>/dev/null || return 1
}

# Report one rclone target's freshness. $1=dest $2=label $3=threshold_hours
check_remote() {
    local dest="$1" label="$2" maxh="$3" ep age
    if ! ep="$(newest_remote_epoch "$dest")"; then
        alert "Cannot list ${label} backups" \
              "rclone could not list ${dest} - the token/credentials may be expired. For Google Drive: rclone config reconnect <remote>:"
        return
    fi
    [ "$ep" -eq 0 ] && return
    age="$(age_hours "$ep")"
    if [ "$age" -ge "$maxh" ]; then
        alert "${label} DB backup is stale (${age}h old)" \
              "Local dumps may be fine but the off-site copy is not landing at ${dest}. Threshold ${maxh}h."
    fi
}

if command -v rclone >/dev/null 2>&1; then
    # Google Drive remote (type=drive), auto-detected the same way db_backup.sh does.
    GDRIVE_REMOTE="$(rclone listremotes --long 2>/dev/null | awk '$2=="drive"{print $1; exit}')"
    if [ -n "$GDRIVE_REMOTE" ]; then
        check_remote "${GDRIVE_REMOTE}database_backups" "Google Drive" "$MAX_DRIVE_AGE_H"
    else
        alert "No Google Drive rclone remote configured" "Expected a remote of type drive; none found."
    fi

    # Object storage remote (Backblaze B2 / S3-compatible, e.g. Cloudflare R2).
    CLOUD_REMOTE="$(rclone listremotes --long 2>/dev/null | awk '$2=="b2"||$2=="s3"{print $1; exit}')"
    if [ -n "$CLOUD_REMOTE" ]; then
        CLOUD_BUCKET="${RCLONE_CLOUD_BUCKET:-delivery-db-backups}"
        check_remote "${CLOUD_REMOTE}${CLOUD_BUCKET}" "Object storage" "$MAX_CLOUD_AGE_H"
    fi
fi

# ── 4) Off-site server snapshot age (site_backup.sh) ─────────────────────────
if [ -f "$SITE_LOG" ]; then
    LAST_DONE="$(grep -E '^\[.*\] DONE ' "$SITE_LOG" | tail -n1 | sed -E 's/^\[([^]]+)\].*/\1/')"
    if [ -z "$LAST_DONE" ]; then
        alert "Off-site backup has never completed" "No DONE entry in $SITE_LOG"
    else
        LAST_EPOCH="$(date -d "$LAST_DONE" +%s 2>/dev/null || echo 0)"
        if [ "$LAST_EPOCH" -gt 0 ]; then
            AGE="$(age_hours "$LAST_EPOCH")"
            if [ "$AGE" -ge "$MAX_SITE_AGE_H" ]; then
                alert "Off-site backup to 83.149.106.196 is stale (${AGE}h old)" \
                      "Last success: $LAST_DONE
Last errors: $(grep -E 'ERROR' "$SITE_LOG" | tail -n 2)"
            fi
        fi
    fi
else
    alert "Off-site backup log is missing" "$SITE_LOG not found"
fi

exit 0
