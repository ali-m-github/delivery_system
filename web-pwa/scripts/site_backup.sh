#!/usr/bin/env bash
# ============================================================================
#
# site_backup.sh - Full off-site backup of the delivery system to the
#                  remote server at 83.149.106.196.
#
#   1. Creates a timestamped snapshot dir on the remote:
#         /home/user1/backups/delivery_system/<YYYYmmdd_HHMM>/
#   2. rsyncs the entire site (excluding node_modules, .next, .git and local
#      backup dirs) into that snapshot.
#   3. pg_dumps the PostgreSQL database (gzip) into the same snapshot.
#   4. Applies retention on the remote:
#         - keeps the latest KEEP_HOURLY snapshots (24h at 30-min cadence)
#         - keeps the oldest snapshot of each of the last KEEP_DAYS days
#   5. Logs to $LOG_FILE and enforces a single concurrent run via flock.
#
# Auth: SSH key at $SSH_KEY (public key pushed to remote user1's
#       authorized_keys). No passwords are stored here.
#
# Usage:  ./scripts/site_backup.sh          # one manual run
#         systemctl start site-backup       # run the service
#         systemctl status site-backup.timer
#
# ============================================================================
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
SITE_DIR="/var/www/delivery_system/web-pwa"
ENV_FILE="$SITE_DIR/.env"
PGSUPERUSER="postgres"   # local superuser (peer auth) — needed for sequences
LOG_FILE="/var/log/site-backup.log"
LOCK_FILE="/var/run/site-backup.lock"

REMOTE_USER="user1"
REMOTE_HOST="83.149.106.196"
REMOTE_PORT="21000"
SSH_KEY="/root/.ssh/id_ed25519_backup"
REMOTE_BASE="/home/user1/backups/delivery_system"

# Retention: 48 snapshots ≈ 24h at 30-min cadence + 1 per day for 7 days
KEEP_HOURLY=48
KEEP_DAYS=7

# ── Derived ──────────────────────────────────────────────────────────────────
STAMP="$(date '+%Y%m%d_%H%M%S')"
SNAP_NAME="snap_${STAMP}"
REMOTE_DIR="$REMOTE_BASE/$SNAP_NAME"

SSH_OPTS=(-i "$SSH_KEY" -p "$REMOTE_PORT" -o StrictHostKeyChecking=accept-new
          -o ConnectTimeout=15 -o BatchMode=yes)
remote() { ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "$@"; }
rsync_remote() { rsync -az --rsync-path="rsync" -e "ssh ${SSH_OPTS[*]}" "$@"; }

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG_FILE"; }

# ── Single-instance lock ─────────────────────────────────────────────────────
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    log "SKIP: another backup is already running"
    exit 0
fi

# ── DB connection string from .env ───────────────────────────────────────────
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d'"' -f2)"
if [ -z "${DATABASE_URL:-}" ]; then
    log "ERROR: DATABASE_URL not found in $ENV_FILE"
    exit 1
fi
# Strip the Prisma query string (e.g. ?schema=public) — pg_dump/libpq
# do not accept "schema" as a URI parameter.
DATABASE_URL="${DATABASE_URL%%\?*}"
DB_NAME="$(basename "${DATABASE_URL%%\?*}")"

START_EPOCH="$(date +%s)"
log "START backup $SNAP_NAME"

# ── 1) Database dump first (local, fast) ─────────────────────────────────────
# Dump as the local superuser (peer auth, no password): the app role
# delivery_user lacks SELECT on the postgres-owned sequences that
# pg_dump needs to read (last_value), which makes non-superuser dumps fail.
# Doing this before any remote work means a failed dump leaves no partial
# snapshot on the remote box.
TMP_SQLGZ="$(mktemp /tmp/sitebackup_XXXX.sql.gz)"
trap 'rm -f "$TMP_SQLGZ"' EXIT
if ! sudo -u "$PGSUPERUSER" pg_dump "$DB_NAME" --no-owner --no-privileges \
        | gzip -c > "$TMP_SQLGZ"; then
    log "ERROR: pg_dump failed for ${DB_NAME}"
    exit 1
fi
DB_SIZE="$(du -h "$TMP_SQLGZ" | cut -f1)"
log "DB dumped locally (${DB_NAME}: ${DB_SIZE})"

# ── 2) Create remote snapshot dir and rsync the site + DB dump ───────────────
remote "mkdir -p '$REMOTE_DIR'"

rsync_remote --exclude 'node_modules' \
             --exclude '.next' \
             --exclude '.git' \
             --exclude 'scripts/backups' \
             --exclude '*.log' \
             --stats "$SITE_DIR/" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/site/" \
    >> "$LOG_FILE" 2>&1 || { log "ERROR: site rsync failed"; exit 1; }

rsync_remote "$TMP_SQLGZ" \
    "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/db_${DB_NAME}_${STAMP}.sql.gz" \
    >> "$LOG_FILE" 2>&1 || { log "ERROR: db dump rsync failed"; exit 1; }

# ── 3) Verify snapshot on the remote ─────────────────────────────────────────
REMOTE_SNAP_SIZE="$(remote "du -sh '$REMOTE_DIR' | cut -f1" 2>/dev/null)"
log "Remote snapshot ${REMOTE_DIR} = ${REMOTE_SNAP_SIZE:-unknown}"

# ── 4) Retention: keep newest KEEP_HOURLY + oldest of each day (KEEP_DAYS) ──
# Single awk pass over the sorted snapshot list (newest last):
#   - mark every name within the newest KEEP_HOURLY as keep
#   - for each of the last KEEP_DAYS dates, mark the first (oldest) seen as keep
KEEP_LIST="$(remote "cd '$REMOTE_BASE' && ls -1d snap_* 2>/dev/null | sort" || true)"
if [ -n "$KEEP_LIST" ]; then
    TO_DELETE="$(
        printf '%s\n' "$KEEP_LIST" | awk -v n="$KEEP_HOURLY" -v d="$KEEP_DAYS" '
            { names[NR] = $0 }
            END {
                count = NR
                if (count == 0) exit
                # oldest day covered by each date (snap_YYYYMMDD_HHMMSS)
                for (i = 1; i <= count; i++) {
                    date[i] = substr(names[i], 6, 8)
                    if (!(date[i] in firstseen)) firstseen[date[i]] = i
                }
                # keep = newest n + oldest-per-day for the last d distinct dates
                nd = 0
                for (i = count; i >= 1; i--)
                    if (date[i] != (i > 1 ? date[i-1] : "")) {
                        if (nd >= d) break
                        keep[firstseen[date[i]]] = 1
                        nd++
                    }
                for (i = count - n + 1; i <= count; i++) if (i >= 1) keep[i] = 1
                for (i = 1; i <= count; i++) if (!(i in keep)) print names[i]
            }'
    )"
    if [ -n "$TO_DELETE" ]; then
        REMOVED="$(printf '%s\n' "$TO_DELETE" | grep -c .)"
        remote "cd '$REMOTE_BASE' && rm -rf $(printf '%q ' $TO_DELETE)" \
            >> "$LOG_FILE" 2>&1
        log "Retention: removed $REMOVED old snapshot(s)"
    fi
fi

# ── Remote disk headroom check ───────────────────────────────────────────────
REMOTE_FREE="$(remote "df -hP /home | awk 'NR==2 {print \$4\" (\" \$5 \" used)\"}'" 2>/dev/null || true)"
log "Remote disk free: ${REMOTE_FREE:-unknown}"

ELAPSED=$(( $(date +%s) - START_EPOCH ))
log "DONE $SNAP_NAME in ${ELAPSED}s"
