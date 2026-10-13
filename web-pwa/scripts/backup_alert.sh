#!/usr/bin/env bash
#
# backup_alert.sh - emit a backup alert so failures are never silent.
#
# Usage: backup_alert.sh <subject> [detail lines...]
#
# Always appends to $LOG_FILE. Additionally POSTs to $ALERT_WEBHOOK when one
# is configured in /etc/backup-alerts.conf. Supported webhook flavours are
# auto-detected from the URL:
#
#   ntfy        https://ntfy.sh/<your-topic>            (push to phone, zero setup)
#   Discord     https://discord.com/api/webhooks/...
#   Telegram    https://api.telegram.org/bot<TOKEN>/sendMessage
#   generic     any other URL -> JSON {"subject":...,"message":...}
#
# A per-subject cooldown (ALERT_COOLDOWN_HOURS, default 6) prevents the same
# recurring failure from spamming you every 30 minutes.
#
set -uo pipefail

LOG_FILE="/var/log/backup-alerts.log"
CONF_FILE="/etc/backup-alerts.conf"
STATE_DIR="/var/lib/backup-alerts"

ALERT_WEBHOOK=""
ALERT_COOLDOWN_HOURS=6
[ -f "$CONF_FILE" ] && . "$CONF_FILE"

SUBJECT="${1:-Backup alert}"
shift || true
DETAILS="$*"

STAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"

# ── Always log locally (this is the durable record) ──────────────────────────
{
    printf '[%s] ALERT: %s\n' "$STAMP" "$SUBJECT"
    [ -n "$DETAILS" ] && printf '    %s\n' "$DETAILS"
} >> "$LOG_FILE" 2>/dev/null || printf '[%s] ALERT: %s\n' "$STAMP" "$SUBJECT" >&2

# ── Optional webhook, with per-subject cooldown ──────────────────────────────
[ -z "$ALERT_WEBHOOK" ] && exit 0

mkdir -p "$STATE_DIR"
KEY="$(printf '%s' "$SUBJECT" | tr -c 'a-zA-Z0-9' '_')"
STAMP_FILE="$STATE_DIR/$KEY"
NOW="$(date +%s)"
if [ -f "$STAMP_FILE" ]; then
    LAST="$(cat "$STAMP_FILE" 2>/dev/null || echo 0)"
    AGE=$(( (NOW - LAST) / 3600 ))
    if [ "$AGE" -lt "$ALERT_COOLDOWN_HOURS" ]; then
        exit 0    # already alerted about this within the cooldown window
    fi
fi

BODY="[$(hostname)] BACKUP ALERT: ${SUBJECT}"
[ -n "$DETAILS" ] && BODY="${BODY}
${DETAILS}"

case "$ALERT_WEBHOOK" in
    https://ntfy.sh/*|http://ntfy.sh/*|*ntfy.sh*)
        curl -fsS -m 20 -X POST --data-binary "$BODY" "$ALERT_WEBHOOK" >/dev/null 2>&1 ;;
    https://discord.com/api/webhooks/*|https://discordapp.com/api/webhooks/*)
        curl -fsS -m 20 -H 'Content-Type: application/json' \
             -d "$(printf '{"content":%s}' "$(printf '%s' "$BODY" | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}' | sed 's/\\n$//; s/^/"/; s/$/"/')")" \
             "$ALERT_WEBHOOK" >/dev/null 2>&1 ;;
    https://api.telegram.org/*)
        curl -fsS -m 20 -H 'Content-Type: application/json' \
             -d "$(printf '{"text":%s}' "$(printf '%s' "$BODY" | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}' | sed 's/\\n$//; s/^/"/; s/$/"/')")" \
             "$ALERT_WEBHOOK" >/dev/null 2>&1 ;;
    *)
        curl -fsS -m 20 -H 'Content-Type: application/json' \
             -d "$(printf '{"subject":"%s","message":"%s"}' "$SUBJECT" "$(printf '%s' "$BODY" | sed 's/"/\\"/g')")" \
             "$ALERT_WEBHOOK" >/dev/null 2>&1 ;;
esac

if [ $? -eq 0 ]; then
    printf '%s' "$NOW" > "$STAMP_FILE"
else
    printf '[%s] ALERT-WEBHOOK-FAILED: %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$SUBJECT" >> "$LOG_FILE"
fi

exit 0
