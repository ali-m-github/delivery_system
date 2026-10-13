#!/usr/bin/env bash
#
# db_backup.sh - Automated PostgreSQL backup + upload to Google Drive via rclone.
#
# Pipeline:
#   1. Securely reads DATABASE_URL from .env (never printed to stdout/log).
#   2. Runs pg_dump, piping through gzip to produce a .sql.gz archive.
#   3. Uploads the archive to every configured off-site target:
#        a) Google Drive - rclone remote of type "drive" -> /database_backups
#        b) Object store - rclone remote of type "b2"/"s3" (Backblaze B2 or
#           Cloudflare R2) -> $RCLONE_CLOUD_BUCKET
#      Every target is attempted even if one fails, so a single broken
#      credential can never stop the other copy from landing. Any failure is
#      alerted via backup_alert.sh and makes this script exit non-zero.
#   4. Retention: local archives older than RETENTION_DAYS are deleted, and
#      object-store copies older than CLOUD_RETENTION_DAYS are pruned.
#
# Configuration lives in /etc/backup-alerts.conf (sourced below) or can be
# overridden per-run via the environment:
#   RCLONE_REMOTE        - force a specific Google Drive remote (skips auto-detect)
#   RCLONE_CLOUD_REMOTE  - force a specific object-storage remote (skips auto-detect)
#   RCLONE_CLOUD_BUCKET  - bucket/prefix for object storage (default: delivery-db-backups)
#   CLOUD_RETENTION_DAYS - prune object-store copies older than this (default: 30)
#   BACKUP_DIR     - local directory for backups (default: <script>/backups)
#   ENV_FILE       - path to the .env file (default: <project root>/.env)
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
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

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
# 3) Upload to every configured off-site target
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

# ── Target A: Google Drive ───────────────────────────────────────────────────
if [ -z "$RCLONE_REMOTE" ]; then
    RCLONE_REMOTE="$(detect_remote 'drive' 1)" || die "No rclone remotes configured (rclone listremotes is empty)"
fi
RCLONE_REMOTE="${RCLONE_REMOTE%:}:"
GDRIVE_DEST="${RCLONE_REMOTE}/database_backups"

# ── Target B: object storage (Backblaze B2 / Cloudflare R2) ──────────────────
# Skipped silently when no b2/s3 remote is configured, so the script keeps
# working until the bucket is created.
CLOUD_REMOTE="${RCLONE_CLOUD_REMOTE:-}"
if [ -z "$CLOUD_REMOTE" ]; then
    CLOUD_REMOTE="$(detect_remote 'b2 s3' 0)" || CLOUD_REMOTE=""
fi
if [ -n "$CLOUD_REMOTE" ]; then
    CLOUD_REMOTE="${CLOUD_REMOTE%:}:"
fi
CLOUD_BUCKET="${RCLONE_CLOUD_BUCKET:-delivery-db-backups}"
# Generous by default: object storage is effectively free (90 days of hourly
# dumps is ~140 MB, well inside Backblaze/R2's free 10 GB tier), and losing
# history is the one thing a backup system must not do.
CLOUD_RETENTION_DAYS="${CLOUD_RETENTION_DAYS:-90}"
CLOUD_DEST=""
if [ -n "$CLOUD_REMOTE" ]; then
    CLOUD_DEST="${CLOUD_REMOTE}${CLOUD_BUCKET}"
fi

# Upload to one target without aborting the run: every target gets its chance,
# so one broken credential can never cost you the other copy.
TOTAL_TARGETS=0
FAILED_COUNT=0
FAILED_TARGETS=""
try_upload() {   # $1 = rclone destination, $2 = human-readable label
    TOTAL_TARGETS=$((TOTAL_TARGETS + 1))
    log "Uploading to ${2}: $1"
    if rclone copy "$GZ_FILE" "$1"; then
        log "Upload complete: $1/$(basename "$GZ_FILE")"
    else
        FAILED_COUNT=$((FAILED_COUNT + 1))
        FAILED_TARGETS="${FAILED_TARGETS}${2} ($1) "
        log "ERROR: upload failed for ${2} ($1)"
    fi
}

try_upload "$GDRIVE_DEST" "Google Drive"
if [ -n "$CLOUD_DEST" ]; then
    try_upload "$CLOUD_DEST" "object storage"
    log "Pruning object-store copies older than ${CLOUD_RETENTION_DAYS} days"
    rclone delete "$CLOUD_DEST" --min-age "${CLOUD_RETENTION_DAYS}d" >/dev/null 2>&1 \
        || log "WARNING: object-store retention pruning failed"
fi

if [ "$FAILED_COUNT" -gt 0 ]; then
    if [ -x "$SCRIPT_DIR/backup_alert.sh" ]; then
        "$SCRIPT_DIR/backup_alert.sh" \
            "Database backup reached only $((TOTAL_TARGETS - FAILED_COUNT)) of ${TOTAL_TARGETS} off-site targets" \
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
