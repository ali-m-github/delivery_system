# Libanex → PWA one-way order sync

## Goal
Import orders from the partner Libanex system (selected by seller from an admin
page) into this PWA, then keep their status, financial status and history
updated automatically every 30 minutes.

## Decisions (confirmed with owner)
- One-way sync only: Libanex → PWA. The PWA never writes back.
- Orders already present in the PWA are **adopted** (linked), never duplicated.
- Imported orders get driver **D999 "Libanex"**. If an operator reassigns the
  order to another driver, the sync never touches the driver field again
  (status/amount updates continue).
- Zones: match PWA zone by name (zone names are identical on both systems);
  fall back to zone **"99"** when the Libanex zone is unknown.
- History events are attributed to the system user **"libanex"**; the original
  Libanex username is stored as text in `OrderHistory.meta.enteredBy`.
- Returned orders on Libanex (`Re`, `Ba` = out-for-return, `Rc`) → PWA
  `location=RETURN`, `financialStatus=RWD` (owner's explicit rule).
- Unknown Libanex status codes: keep the last valid PWA value, store the raw
  code on the link row, and surface a warning in the admin UI / cron log.

## Status mapping
| Libanex Location | PWA location | | Libanex Fin | PWA fin |
|---|---|---|---|---|
| W, WH, W9, OP | WAREHOUSE | | UD/WD/WO/PS | same |
| CP, CP1 | CP | | Re | RWD |
| Dr, DrD, DrR | ASSIGNED | | (others) | keep last + warn |
| Tr | ASSIGNED_TR | | | |
| De | DELIVERED | | | |
| Re, Ba, Rc | RETURN (+RWD) | | | |

## Data model
- New `LibanexLink` table: `libanexOrderId` (unique, = our `Order.orderId`),
  `libanexSellerId`, `orderId` (unique FK → Order, cascade), `lastHistoryStamp`
  (incremental cursor), `rawLocation`/`rawFinStatus` (audit), `lastSyncedAt`.
- Created directly in SQL (kept `ZoneMapping_backup_20261006` untouched;
  `prisma db push` would have dropped it). Schema file updated to match.

## Components
- `lib/libanexSync.ts` — mapping tables, Libanex API client, `importSellerOrders()`
  (bulk import/adopt) and `runSyncForLinkedSellers()` (history replay via
  `order_history.php?seller_id&since`, then per-touched-order status refresh).
- `app/api/admin/libanex/sellers/route.ts` — seller search proxy + linked counts.
- `app/api/admin/libanex/import/route.ts` — POST {sellerId} bulk import.
- `app/api/admin/libanex/sync/route.ts` — POST sync; admin session OR
  `Authorization: Bearer $LIBANEX_SYNC_CRON_SECRET` (for cron).
- `app/api/admin/libanex/orders/route.ts` — GET preview of a seller's Libanex
  orders annotated with alreadyLinked/existsInPwa for the order picker.
- `app/admin/libanex/page.tsx` — seller search (name/phone or exact Seller
  ID), per-order checkbox picker (select which orders to import), "Sync now",
  result/warning panels.
- `scripts/create-libanex-user.js` — creates the "libanex" system user.
- `scripts/libanex-sync-cron.sh` → curl localhost sync, driven by systemd
  timer `libanex-sync.timer` (`OnCalendar=*:0/30`, Persistent=true). The PWA
  server has no crontab binary, so a systemd timer is used instead.

## Libanex API (server 83.149.106.196, /libanexbackup/api/internal/v1/)
- `orders.php` — order master data (filters: seller_id, order_id, …).
- `order_history.php` — per-order event log (filters: seller_id, since, …).
- `sellers.php` — seller directory (filter: q).
- Auth: `?apikey=` — dedicated key stored in `.env` as `LIBANEX_API_KEY`.

## Env vars added
- `LIBANEX_API_URL`, `LIBANEX_API_KEY`, `LIBANEX_SYNC_CRON_SECRET`.

## Safety
- Import is idempotent (link table + orderId unique).
- Sync caps: 500-row pages, ≤20k history rows and ≤400 status fetches per
  seller per run; warnings reported instead of failing the whole run.
- No writes to Libanex; PWA-only additive changes.

## Status: DEPLOYED & VERIFIED (2026-10-15)
- E2E test with seller 1176 (8 orders): import created 8 orders + 8 links +
  history; re-import skipped all 8 (idempotent); sync replicated 24 history
  rows and updated 7 orders; second sync = 0 new rows (cursors work).
- RETURN→RWD mapping confirmed live (1176-980654, raw "Re").
- Selective import verified: seller search by exact Seller ID works; preview
  lists orders with flags; importing 2 of 8 orders created exactly those 2.
- systemd timer `libanex-sync.timer` enabled, manual trigger succeeded
  (output in `journalctl -u libanex-sync.service`).
- Note: the PWA server has no crontab binary — scheduling uses systemd timers.
- Unmapped Libanex codes (fin: RD/RM/DP/RS/RDr/RW/ZZ/WC/DC…; loc: PK/Dr3/
  XX/QQ) keep the last valid PWA value, store raw on the link row, and warn.
- LIBANEX_API_KEY currently reuses the shared admin API key; a dedicated
  read-only key is recommended later.
