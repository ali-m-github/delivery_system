/**
 * revert-libanex-import-5272-23-10-2026.ts
 *
 * One-off revert: undo the Libanex import for seller "5272" that ran at
 * 2026-10-23 13:31 (UTC) from /admin/libanex.
 *
 * What that import did
 * --------------------
 *   • Created 238 brand-new Order rows. lib/libanexSync.ts:importSellerOrders
 *     never sets createdAt from Libanex's date_rcvd, so Prisma defaulted every
 *     one of them to "now" → they all show as entered 23/10/2026.
 *   • Created 238 "Imported from Libanex" OrderHistory rows (+2 later edits).
 *   • Created 431 LibanexLink rows: 238 for the new orders + 193 "adoptions"
 *     of pre-existing PWA orders (their dates were NOT touched).
 *
 * The revert removes everything that import created:
 *   Phase 1: the 238 new orders + their history + their links.
 *   Phase 2: the 193 adoption links (un-links the old orders again, so a
 *            corrected re-import will treat the whole run as if it never
 *            happened). Skipped when KEEP_ADOPTIONS=1.
 *
 * Safety
 * ------
 *   - Dry-run by default. Pass APPLY=1 to actually write.
 *   - Aborts BEFORE any write if any target order is linked to a payout,
 *     cash/pickup/return batch, waybill, or track token (verified none were,
 *     but re-checked at run time).
 *   - Targets are identified by the LibanexLink rows created inside the
 *     13:30–13:35 UTC window, so nothing else can be caught.
 *
 * Usage
 * -----
 *   DRY RUN : npx tsx scripts/revert-libanex-import-5272-23-10-2026.ts
 *   APPLY   : APPLY=1 npx tsx scripts/revert-libanex-import-5272-23-10-2026.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SELLER_ID = "5272";
const WINDOW_START = new Date("2026-10-23T13:30:00Z");
const WINDOW_END = new Date("2026-10-23T13:35:00Z");

const APPLY = process.env.APPLY === "1";
const KEEP_ADOPTIONS = process.env.KEEP_ADOPTIONS === "1";

function assert(cond: any, msg?: string): asserts cond {
  if (!cond) {
    console.error(`ERROR: ${msg}. Aborting — no writes performed.`);
    process.exit(1);
  }
}

async function main() {
  console.log(`── MODE: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"} ──\n`);

  // ── 1. Load every LibanexLink created by the 13:31 import run ────────────
  const links = await prisma.libanexLink.findMany({
    where: {
      libanexSellerId: SELLER_ID,
      createdAt: { gte: WINDOW_START, lt: WINDOW_END },
    },
    include: {
      order: {
        select: {
          id: true,
          orderId: true,
          customerName: true,
          createdAt: true,
          location: true,
          financialStatus: true,
          merchantPayoutId: true,
          driverPayoutId: true,
          cashPayoutBatchId: true,
          pickupBatchId: true,
          returnBatchId: true,
          waybillUrl: true,
          trackToken: true,
        },
      },
    },
  });
  assert(links.length > 0, `no LibanexLink rows for seller ${SELLER_ID} in the import window found`);

  const createdWindowStart = WINDOW_START; // orders created by the import have createdAt in/after the window
  const created = links.filter((l) => l.order.createdAt >= createdWindowStart);
  const adopted = links.filter((l) => l.order.createdAt < createdWindowStart);

  console.log(`Links created by the import: ${links.length}`);
  console.log(`  • New orders created at import time (to delete):  ${created.length}`);
  console.log(`  • Adopted pre-existing orders (links to remove):  ${KEEP_ADOPTIONS ? 0 : adopted.length} (kept: ${KEEP_ADOPTIONS ? adopted.length : 0})`);

  // ── 2. Pre-flight guards: nothing being deleted may be settled/attached ───
  const dirty = created.filter(
    (l) =>
      l.order.merchantPayoutId ||
      l.order.driverPayoutId ||
      l.order.cashPayoutBatchId ||
      l.order.pickupBatchId ||
      l.order.returnBatchId ||
      l.order.waybillUrl ||
      l.order.trackToken,
  );
  if (dirty.length > 0) {
    for (const l of dirty) {
      console.error(
        `  ! ${l.order.orderId}: attached to a payout/batch/waybill/token — cannot safely delete`,
      );
    }
    assert(false, `${dirty.length} created orders are entangled with payouts/batches`);
  }

  // ── 3. Sample of what will be removed ────────────────────────────────────
  console.log(`\n  Sample of orders that will be DELETED (first 15):`);
  for (const l of created.slice(0, 15)) {
    console.log(
      `    ${l.order.orderId} "${l.order.customerName}" $${l.order.location}/${l.order.financialStatus} createdAt=${l.order.createdAt.toISOString()}`,
    );
  }

  // ── 4. Apply, in one transaction ─────────────────────────────────────────
  if (!APPLY) {
    console.log(`\nDry run complete. Re-run with APPLY=1 to perform the revert.`);
    return;
  }

  const createdOrderIds = created.map((l) => l.order.id);
  const createdLinkIds = created.map((l) => l.id);
  const adoptedLinkIds = KEEP_ADOPTIONS ? [] : adopted.map((l) => l.id);

  await prisma.$transaction(async (tx) => {
    // history for the created orders (import marker + any later edits)
    const delHist = await tx.orderHistory.deleteMany({
      where: { orderId: { in: createdOrderIds } },
    });
    const delLinks = await tx.libanexLink.deleteMany({
      where: { id: { in: [...createdLinkIds, ...adoptedLinkIds] } },
    });
    const delOrders = await tx.order.deleteMany({
      where: { id: { in: createdOrderIds } },
    });
    console.log(
      `\nRemoved: ${delOrders.count} orders, ${delHist.count} history rows, ${delLinks.count} LibanexLink rows.`,
    );
  });

  console.log(`\nRevert complete for seller ${SELLER_ID}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
