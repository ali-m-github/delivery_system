/**
 * backfill-import-order-history.ts
 *
 * One-off data fix: make ALREADY-IMPORTED orders show their import source and
 * the importing user in the order history, matching what the import routes now
 * do for new orders.
 *
 * What it fixes
 * -------------
 * A) Bulk Excel/CSV imports (app/orders/page.tsx → POST /api/orders):
 *    these orders carry the exact marker "Imported via Bulk Excel/CSV tool"
 *    in Order.notes and have a plain "Order Created" history entry.
 *      → rename that entry to "Order Created (Imported via Bulk Excel/CSV)"
 *      → clear the marker from Order.notes (it was never a merchant/user note)
 *
 * B) Google Sheets imports (merchant + admin import-sheet routes):
 *    these used createMany and wrote NO history entry at all. Orders with
 *    zero history rows are exactly those.
 *      → create "Order Created (Imported via Google Sheets)" attributed to
 *        Order.creatorId (the merchant/admin who ran the import), timestamped
 *        at Order.createdAt so it sits at the start of the timeline.
 *        Location mirrors the import route: CP for merchant importers,
 *        WAREHOUSE otherwise.
 *
 * Safety
 * ------
 *   - Dry-run by default. Pass APPLY=1 to actually write.
 *   - Orders that already have a tagged creation entry are skipped (idempotent:
 *     re-running after APPLY=0 writes nothing new).
 *
 * Usage
 * -----
 *   DRY RUN : npx tsx scripts/backfill-import-order-history.ts
 *   APPLY   : APPLY=1 npx tsx scripts/backfill-import-order-history.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY = process.env.APPLY === "1";

const BULK_NOTE = "Imported via Bulk Excel/CSV tool";
const BULK_ACTION = "Order Created (Imported via Bulk Excel/CSV)";
const SHEETS_ACTION = "Order Created (Imported via Google Sheets)";

async function main() {
  console.log(`── MODE: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"} ──\n`);

  // ── A) Bulk Excel/CSV imports: notes marker present ────────────────────────
  const bulkOrders = await prisma.order.findMany({
    where: { notes: { contains: BULK_NOTE } },
    select: { id: true, orderId: true, createdAt: true, creatorId: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`── A) Bulk Excel/CSV imports (notes marker): ${bulkOrders.length} orders`);

  let bulkRenamed = 0;
  let bulkCreated = 0;
  for (const o of bulkOrders) {
    // Prefer renaming the existing plain creation entry; fall back to
    // creating one if it is missing for any reason.
    const entry = await prisma.orderHistory.findFirst({
      where: { orderId: o.id, action: "Order Created" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (entry) {
      bulkRenamed++;
      console.log(`  • ${o.orderId}: rename history → "${BULK_ACTION}" + clear notes marker`);
      if (APPLY) {
        await prisma.$transaction([
          prisma.orderHistory.update({
            where: { id: entry.id },
            data: { action: BULK_ACTION },
          }),
          prisma.order.update({
            where: { id: o.id },
            data: { notes: null },
          }),
        ]);
      }
    } else {
      bulkCreated++;
      console.log(`  • ${o.orderId}: no "Order Created" entry found → create tagged entry`);
      if (APPLY) {
        await prisma.$transaction([
          prisma.orderHistory.create({
            data: {
              orderId: o.id,
              action: BULK_ACTION,
              location: "WAREHOUSE",
              userId: o.creatorId,
              createdAt: o.createdAt,
            },
          }),
          prisma.order.update({ where: { id: o.id }, data: { notes: null } }),
        ]);
      }
    }
  }

  // ── B) Google Sheets imports: orders with NO history at all ────────────────
  const noHistoryOrders = await prisma.order.findMany({
    where: { history: { none: {} } },
    select: { id: true, orderId: true, createdAt: true, creatorId: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n── B) Orders with no history (Google Sheets imports): ${noHistoryOrders.length} orders`);

  // Resolve creator roles to mirror the correct import route (merchant → CP,
  // staff/admin → WAREHOUSE) and to label the actor shown in the modal.
  const creatorIds = [...new Set(noHistoryOrders.map((o) => o.creatorId))];
  const creators =
    creatorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, username: true, role: true },
        })
      : [];
  const creatorMap = new Map(creators.map((u) => [u.id, u]));

  for (const o of noHistoryOrders) {
    const creator = creatorMap.get(o.creatorId);
    const location = creator?.role === "MERCHANT" ? "CP" : "WAREHOUSE";
    console.log(
      `  • ${o.orderId}: create "${SHEETS_ACTION}" by ${creator?.username ?? o.creatorId} (${creator?.role ?? "unknown"}) loc=${location}`,
    );
  }

  if (APPLY && noHistoryOrders.length > 0) {
    await prisma.orderHistory.createMany({
      data: noHistoryOrders.map((o) => ({
        orderId: o.id,
        action: SHEETS_ACTION,
        location: creatorMap.get(o.creatorId)?.role === "MERCHANT" ? "CP" : "WAREHOUSE",
        userId: o.creatorId,
        createdAt: o.createdAt,
      })),
    });
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(
    `\n── SUMMARY ${APPLY ? "(applied)" : "(dry run — nothing written)"} ──`,
  );
  console.log(`  A) Bulk CSV: renamed=${bulkRenamed}, created=${bulkCreated}, notes cleared=${bulkOrders.length}`);
  console.log(`  B) Sheets: history entries ${APPLY ? "created" : "to create"}=${noHistoryOrders.length}`);
  if (!APPLY) {
    console.log(`\nRe-run with APPLY=1 to write.`);
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
