#!/usr/bin/env bash
#
# db_backup.sh - Automated PostgreSQL backup + upload to off-site and on-network targets.
#
# Pipeline:
#   1. Securely reads DATABASE_URL from .env (never printed to stdout/log).
#   2. Runs pg_dump, piping through gzip to produce a .sql.gz archive.
#   3. Uploads the archive to every configured target:
#        a) Google Drive  - rclone remote of type "drive" (user OAuth, auto-refreshing)
#        b) Dropbox       - rclone remote of type "dropbox" (refresh token auto-refreshes)
#        c) Mega          - rclone remote of type "mega" (user/password)
#        d) On-network third copy - rsync over SSH to a second server (fast-restore copy)
#      Every target is attempted even if one fails, so a single broken credential can
#      never stop the other copies from landing. Any failure is alerted via backup_alert.sh
#      and makes this script exit non-zero.
#   4. Retention: local archives older than RETENTION_DAYS are deleted; the Dropbox
#      remote is pruned after DROPBOX_RETENTION_DAYS days; the on-network copy is pruned
#      after NET_RETENTION_DAYS days. Google Drive copies are NOT pruned automatically
#      (full history preserved).
#
# Configuration lives in /etc/backup-alerts.conf (sourced below) or can be overridden
# per-run via the environment:
#   RCLONE_REMOTE          - force a specific Google Drive remote (skips auto-detect)
#   RCLONE_DROPBOX_REMOTE  - force a specific Dropbox remote (skips auto-detect)
#   DROPBOX_RETENTION_DAYS - prune Dropbox copies older than this (default: 30)
#   BACKUP_DIR             - local directory for backups (default: <script>/backups)
#   ENV_FILE               - path to the .env file (default: <project root>/.env)
#   NET_SSH_HOST           - on-network third-copy SSH target, e.g. user1@83.149.106.196
#   NET_SSH_PORT           - SSH port on the third-copy host (default: 22)
#   NET_SSH_KEY            - path to the SSH private key (default: /root/.ssh/id_ed25519_backup)
#   NET_SSH_DIR            - remote directory on the third-copy host (default: ~/backups/delivery_system)
#   NET_RETENTION_DAYS     - prune on-network copies older than this (default: 30)
#
# Usage:  ./scripts/db_backup.sh
set -euo pipefail
umask 077   # all files/dirs created here are private to the owner

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Shared backup configuration (off-site targets, alert webhook).
[ -f /etc/backup-alerts.conf ] && . /etc/backup-alerts.conf
ENV_FILE="${ENV_FILE:-$PROJECT_ROOT/.env}"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backups}"
RETENTION_DAYS=3
KEEP_LAST=5
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
RCLONE_DROPBOX_REMOTE="${RCLONE_DROPBOX_REMOTE:-}"
RCLONE_MEGA_REMOTE="${RCLONE_MEGA_REMOTE:-}"
DROPBOX_RETENTION_DAYS="${DROPBOX_RETENTION_DAYS:-30}"

# On-network third-copy (optional). Skipped silently when NET_SSH_HOST is empty.
NET_SSH_HOST="${NET_SSH_HOST:-}"
NET_SSH_PORT="${NET_SSH_PORT:-22}"
NET_SSH_KEY="${NET_SSH_KEY:-/root/.ssh/id_ed25519_backup}"
NET_SSH_DIR="${NET_SSH_DIR:-~/backups/delivery_system}"
NET_RETENTION_DAYS="${NET_RETENTION_DAYS:-30}"

# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------
log()  { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*"; }
die()  { log "ERROR: $*" >&2; exit 1; }

command -v rclone >/dev/null 2>&1 || die "rclone is not installed or not on PATH"
command -v pg_dump >/dev/null 2>&1 || die "pg_dump is not installed or not on PATH"

# ---------------------------------------------------------------
# 1) Extract DATABASE_URL securely from .env
# ---------------------------------------------------------------
[ -f "$ENV_FILE" ] || die "Environment file not found: $ENV_FILE"

DB_URL="$(grep -E '^[[:space:]]*DATABASE_URL[[:space:]]*=' "$ENV_FILE" \
          | head -n1 \
          | sed -E 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//' \
          | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//' \
          | sed -e 's/^"//' -e 's/"$//' -e 's/^'"'"'//' -e 's/'"'"'$//')"
[ -n "$DB_URL" ] || die "DATABASE_URL is not set in $ENV_FILE"

# Parse postgres:// or postgresql:// URI into components (password stays in memory only).
DB_URL_CLEAN="${DB_URL#postgresql://}"
DB_URL_CLEAN="${DB_URL_CLEAN#postgres://}"
[ "$DB_URL_CLEAN" != "$DB_URL" ] || die "DATABASE_URL must start with postgres:// or postgresql://"

DB_HOSTPORT="${DB_URL_CLEAN#*@}"
[ "$DB_HOSTPORT" != "$DB_URL_CLEAN" ] || die "DATABASE_URL is missing the host portion"
DB_USERPASS="${DB_URL_CLEAN%%@*}"
DB_USER="${DB_USERPASS%%:*}"
DB_PASS="${DB_USERPASS#*:}"
[ "$DB_PASS" != "$DB_USERPASS" ] || DB_PASS=""
DB_HOSTPORT="${DB_HOSTPORT%%\?*}"          # drop Prisma query string (?schema=...)
DB_NAME="${DB_HOSTPORT##*/}"
DB_HOSTPORT="${DB_HOSTPORT%%/*}"
DB_HOST="${DB_HOSTPORT%%:*}"
DB_PORT="${DB_HOSTPORT#*:}"
[ "$DB_PORT" != "$DB_HOSTPORT" ] || DB_PORT="5432"
[ -n "$DB_USER" ] || die "DATABASE_URL is missing the user"
[ -n "$DB_NAME" ] || die "DATABASE_URL is missing the database name"

# ---------------------------------------------------------------
# 2) Backup: pg_dump -> gzip
# ---------------------------------------------------------------
mkdir -p "$BACKUP_DIR"
STAMP="$(date '+%Y%m%d_%H%M%S')"
GZ_FILE="$BACKUP_DIR/${DB_NAME}_${STAMP}.sql.gz"

log "Starting database backup for '${DB_NAME}'"
if ! PGPASSWORD="$DB_PASS" pg_dump \
        --no-owner --no-privileges \
        -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" \
        | gzip -c > "$GZ_FILE"; then
    rm -f "$GZ_FILE"
    die "pg_dump failed for database '$DB_NAME'"
fi
log "Local backup created: $GZ_FILE ($(du -h "$GZ_FILE" | cut -f1))"

# ---------------------------------------------------------------
# 3) Upload to every configured target
# ---------------------------------------------------------------
# Print the first configured rclone remote whose type matches any type listed
# in $1. With $2 = 1, fall back to the first configured remote if none match.
detect_remote() {
    set +e
    local want="$1" allow_fallback="${2:-0}"
    local remotes rem type t
    remotes="$(rclone listremotes 2>/dev/null | sed 's/:$//' | sed '/^$/d')"
    if [ -z "$remotes" ]; then
        set -e; return 1
    fi
    for rem in $remotes; do
        type="$(rclone config show 2>/dev/null | awk -v r="$rem" '
            $0 == "[" r "]" { in_sec = 1; next }
            in_sec && /^\[/ { in_sec = 0 }
            in_sec && /^type[[:space:]]*=/ {
                sub(/^type[[:space:]]*=[[:space:]]*/, "")
                print; exit
            }
        ')"
        for t in $want; do
            if [ "$type" = "$t" ]; then
                printf '%s' "$rem"
                set -e; return 0
            fi
        done
    done
    if [ "$allow_fallback" = "1" ]; then
        printf '%s\n' "$remotes" | head -n1   # fallback: first configured remote
        set -e; return 0
    fi
    set -e; return 1
}

# ── Target A: Google Drive ────────────────────────────────────────────────────
# Use a service-account remote (`type = drive` with `service_account_file`) to
# avoid the 1-2 month OAuth token expiry. The remote must be shared with the
# service-account email or live in a shared Drive the service account is a member of.
if [ -z "$RCLONE_REMOTE" ]; then
    RCLONE_REMOTE="$(detect_remote 'drive' 1)" || die "No rclone remotes configured (rclone listremotes is empty)"
fi
RCLONE_REMOTE="${RCLONE_REMOTE%:}:"
GDRIVE_DEST="${RCLONE_REMOTE}/database_backups"

# ── Target B: Dropbox ─────────────────────────────────────────────────────────
# Skipped silently when no dropbox remote is configured, so the script keeps
# working until the remote is created.
DROPBOX_REMOTE="${RCLONE_DROPBOX_REMOTE:-}"
if [ -z "$DROPBOX_REMOTE" ]; then
    DROPBOX_REMOTE="$(detect_remote 'dropbox' 0)" || DROPBOX_REMOTE=""
fi
if [ -n "$DROPBOX_REMOTE" ]; then
    DROPBOX_REMOTE="${DROPBOX_REMOTE%:}:"
fi
DROPBOX_DEST=""
if [ -n "$DROPBOX_REMOTE" ]; then
    DROPBOX_DEST="${DROPBOX_REMOTE}database_backups"
fi

# ── Target C: Mega ─────────────────────────────────────────────────────────────
# Skipped silently when no mega remote is configured.
MEGA_REMOTE="${RCLONE_MEGA_REMOTE:-}"
if [ -z "$MEGA_REMOTE" ]; then
    MEGA_REMOTE="$(detect_remote 'mega' 0)" || MEGA_REMOTE=""
fi
if [ -n "$MEGA_REMOTE" ]; then
    MEGA_REMOTE="${MEGA_REMOTE%:}:"
fi
MEGA_DEST=""
if [ -n "$MEGA_REMOTE" ]; then
    MEGA_DEST="${MEGA_REMOTE}/database_backups"
fi

# ── Target D: on-network third copy (rsync over SSH) ──────────────────────────
# Skipped silently when NET_SSH_HOST is empty. This is a fast-restore copy,
# not an off-site backup — it shares the network and provider with this host.
NET_SSH_AVAILABLE=0
if [ -n "$NET_SSH_HOST" ]; then
    if command -v rsync >/dev/null 2>&1; then
        NET_SSH_AVAILABLE=1
    else
        log "WARNING: rsync not installed; on-network third copy skipped"
    fi
fi

# Upload to one target without aborting the run: every target gets its chance,
# so one broken credential can never cost you the other copies.
TOTAL_TARGETS=0
FAILED_COUNT=0
FAILED_TARGETS=""
try_upload() {   # $1 = destination label, $2 = human-readable label, $3 = command (bash -c)
    TOTAL_TARGETS=$((TOTAL_TARGETS + 1))
    log "Uploading to ${2}: $1"
    if bash -c "$3"; then
        log "Upload complete: $1/$(basename "$GZ_FILE")"
    else
        FAILED_COUNT=$((FAILED_COUNT + 1))
        FAILED_TARGETS="${FAILED_TARGETS}${2} ($1) "
        log "ERROR: upload failed for ${2} ($1)"
    fi
}

try_upload "$GDRIVE_DEST" "Google Drive" \
    "rclone copy '$GZ_FILE' '$GDRIVE_DEST'"

# Keep only the last KEEP_LAST copies in Google Drive.
log "Pruning Google Drive copies to last ${KEEP_LAST}"
rclone lsf "$GDRIVE_DEST" 2>/dev/null | grep -E '^delivery_system_.*\.sql\.gz$' | sort | head -n -${KEEP_LAST} | while read -r old; do
    rclone delete "$GDRIVE_DEST/$old" >/dev/null 2>&1 || log "WARNING: could not delete $old from Google Drive"
done

if [ -n "$DROPBOX_DEST" ]; then
    try_upload "$DROPBOX_DEST" "Dropbox" \
        "rclone copy '$GZ_FILE' '$DROPBOX_DEST'"
    log "Pruning Dropbox copies to last ${KEEP_LAST}"
    rclone lsf "$DROPBOX_DEST" 2>/dev/null | grep -E '^delivery_system_.*\.sql\.gz$' | sort | head -n -${KEEP_LAST} | while read -r old; do
        rclone delete "$DROPBOX_DEST/$old" >/dev/null 2>&1 || log "WARNING: could not delete $old from Dropbox"
    done
fi

if [ -n "$MEGA_DEST" ]; then
    try_upload "$MEGA_DEST" "Mega" \
        "rclone copy '$GZ_FILE' '$MEGA_DEST'"
    log "Pruning Mega copies to last ${KEEP_LAST}"
    rclone lsf "$MEGA_DEST" 2>/dev/null | grep -E '^delivery_system_.*\.sql\.gz$' | sort | head -n -${KEEP_LAST} | while read -r old; do
        rclone delete "$MEGA_DEST/$old" >/dev/null 2>&1 || log "WARNING: could not delete $old from Mega"
    done
fi

if [ "$NET_SSH_AVAILABLE" -eq 1 ]; then
    # Resolve the remote path and ensure it exists on the remote host.
    ssh_cmd() {
        ssh -i "$NET_SSH_KEY" -p "$NET_SSH_PORT" -o BatchMode=yes -o ConnectTimeout=30 \
            "$NET_SSH_HOST" "$@"
    }
    ssh_cmd "mkdir -p '$NET_SSH_DIR'" >/dev/null 2>&1 \
        || log "WARNING: could not ensure remote directory $NET_SSH_DIR"
    rsync_cmd="rsync -az -e 'ssh -i $NET_SSH_KEY -p $NET_SSH_PORT -o BatchMode=yes -o StrictHostKeyChecking=accept-new' '$GZ_FILE' '$NET_SSH_HOST:$NET_SSH_DIR/'"
    try_upload "$NET_SSH_HOST:$NET_SSH_DIR" "on-network third copy" "$rsync_cmd"
    # Prune remote copies to last KEEP_LAST
    log "Pruning on-network copies to last ${KEEP_LAST}"
    ssh_cmd "find \$HOME/backups/delivery_system -maxdepth 1 -name '*.sql.gz' -printf '%T@ %p\n' | sort -rn | tail -n +$((KEEP_LAST + 1)) | cut -d' ' -f2- | xargs -r rm -f" >/dev/null 2>&1 \
        || log "WARNING: on-network retention pruning failed"
fi

if [ "$FAILED_COUNT" -gt 0 ]; then
    if [ -x "$SCRIPT_DIR/backup_alert.sh" ]; then
        "$SCRIPT_DIR/backup_alert.sh" \
            "Database backup reached only $((TOTAL_TARGETS - FAILED_COUNT)) of ${TOTAL_TARGETS} targets" \
            "Failed targets: ${FAILED_TARGETS}" || true
    fi
    die "Upload failed for: ${FAILED_TARGETS}"
fi

# ---------------------------------------------------------------
# 4) Retention: delete local backups older than 3 days
# ---------------------------------------------------------------
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.sql.gz' -mtime +"$RETENTION_DAYS" -print -delete)"
if [ -n "$DELETED" ]; then
    log "Removed local backups older than ${RETENTION_DAYS} days:"
    printf '%s\n' "$DELETED" | sed 's/^/  /'
fi

log "Backup completed successfully"
