#!/usr/bin/env bash
#
# db_backup.sh - Automated PostgreSQL backup + upload to Google Drive via rclone.
#
# Pipeline:
#   1. Securely reads DATABASE_URL from .env (never printed to stdout/log).
#   2. Runs pg_dump, piping through gzip to produce a .sql.gz archive.
#   3. Auto-detects the rclone Google Drive remote (type = "drive") and
#      uploads the archive to /database_backups on that remote via rclone copy.
#   4. Deletes local backup archives older than 3 days.
#
# Optional env overrides:
#   RCLONE_REMOTE  - force a specific rclone remote name (skips auto-detect)
#   BACKUP_DIR     - local directory for backups (default: <script>/backups)
#   ENV_FILE       - path to the .env file (default: <project root>/.env)
#
# Usage:  ./scripts/db_backup.sh
set -euo pipefail
umask 077   # all files/dirs created here are private to the owner

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
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
# 3) Auto-detect the rclone Google Drive remote and upload
# ---------------------------------------------------------------
detect_remote() {
    set +e
    local remotes rem type
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
        if [ "$type" = "drive" ]; then
            printf '%s' "$rem"
            set -e; return 0
        fi
    done
    printf '%s\n' "$remotes" | head -n1   # fallback: first configured remote
    set -e; return 0
}

if [ -z "$RCLONE_REMOTE" ]; then
    RCLONE_REMOTE="$(detect_remote)" || die "No rclone remotes configured (rclone listremotes is empty)"
fi
RCLONE_REMOTE="${RCLONE_REMOTE%:}:"
GDRIVE_DEST="${RCLONE_REMOTE}/database_backups"

log "Uploading to rclone remote: ${RCLONE_REMOTE}"
rclone copy "$GZ_FILE" "$GDRIVE_DEST" \
    || die "rclone upload failed (remote: ${RCLONE_REMOTE})"
log "Upload complete: ${GDRIVE_DEST}/$(basename "$GZ_FILE")"

# ---------------------------------------------------------------
# 4) Retention: delete local backups older than 3 days
# ---------------------------------------------------------------
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.sql.gz' -mtime +"$RETENTION_DAYS" -print -delete)"
if [ -n "$DELETED" ]; then
    log "Removed local backups older than ${RETENTION_DAYS} days:"
    printf '%s\n' "$DELETED" | sed 's/^/  /'
fi

log "Backup completed successfully"
