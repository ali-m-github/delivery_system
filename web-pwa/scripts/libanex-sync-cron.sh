#!/bin/sh
# Libanex → PWA incremental sync, run every 30 minutes by a systemd timer
# (libanex-sync.timer on the PWA server — crontab is not installed there).
# Calls the app's own sync endpoint so no duplicate logic lives here.
# Timer units: /etc/systemd/system/libanex-sync.{service,timer}
# Output is captured by journald: journalctl -u libanex-sync.service
set -e

APP_DIR="/var/www/delivery_system/web-pwa"
SECRET=$(grep -E '^LIBANEX_SYNC_CRON_SECRET=' "$APP_DIR/.env" | cut -d= -f2- | tr -d '"')

if [ -z "$SECRET" ]; then
  echo "LIBANEX_SYNC_CRON_SECRET missing from $APP_DIR/.env" >&2
  exit 1
fi

curl -sS -f -m 600 -X POST \
  -H "Authorization: Bearer $SECRET" \
  "http://127.0.0.1:3000/api/admin/libanex/sync" \
  | head -c 2000
echo ""
