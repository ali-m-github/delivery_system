/**
 * fix-imported-order-date-seller-2-16-9-2026.ts
 *
 * One-off data fix: change the order date (Order.createdAt) from 2026-09-16
 * → 2026-09-14 for IMPORTED orders belonging to seller 2 (merchantId = 2).
 *
 * Background
 * ----------
 * The UI renders an order's "date" from Order.createdAt. All three bulk
 * import paths write the received date into createdAt at EXACT UTC midnight:
 *   - app/api/orders/route.ts                     (dateReceived  → T00:00:00Z)
 *   - app/api/merchant/orders/import-sheet/route.ts (receivedDate → midnight)
 *   - app/api/admin/orders/import-sheet/route.ts    (receivedDate → midnight)
 * so a createdAt sitting on the UTC midnight line is the precise signature
 * of an imported order. Manually-entered orders carry a real time-of-day and
 * are therefore excluded.
 *
 * Scope
 * -----
 *   merchant.merchantId = 2
 *   createdAt in [2026-09-16T00:00:00Z, 2026-09-17T00:00:00Z)
 *   createdAt is exactly UTC midnight  (i.e. imported)
 *
 * The write is -2 days per order (preserves time-of-day; midnight stays
 * midnight) and runs inside a single $transaction.
 *
 * Safety
 * ------
 *   - Dry-run by default. Pass APPLY=1 to actually write.
 *   - Pre-flight validation aborts BEFORE any write.
 *
 * Usage
 * -----
 *   DRY RUN : npx tsx scripts/fix-imported-order-date-seller-2-16-9-2026.ts
 *   APPLY   : APPLY=1 npx tsx scripts/fix-imported-order-date-seller-2-16-9-2026.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SELLER_MERCHANT_ID = 2; // "Seller #2" in the UI = Merchant.merchantId
const OLD_DATE = "2026-09-16"; // from
const NEW_DATE = "2026-09-14"; // to
const TWO_DAYS_MS = 2 * 86400 * 1000;

const APPLY = process.env.APPLY === "1";

const windowStart = new Date(`${OLD_DATE}T00:00:00Z`); // 2026-09-16T00:00:00Z
const windowEnd = new Date("2026-09-17T00:00:00Z"); // start of the next day

function assert(cond: any, msg?: string): asserts cond {
  if (!cond) {
    console.error(`ERROR: ${msg}. Aborting — no writes performed.`);
    process.exit(1);
  }
}

const datePartUTC = (d: Date) => d.toISOString().split("T")[0];

/** True when the Date sits exactly on the UTC midnight line (imported). */
const isUtcMidnight = (d: Date) =>
  d.getUTCHours() === 0 &&
  d.getUTCMinutes() === 0 &&
  d.getUTCSeconds() === 0 &&
  d.getUTCMilliseconds() === 0;

async function main() {
  console.log(`── MODE: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"} ──`);

  // ── 1. Resolve the seller ────────────────────────────────────────────────
  const merchant = await prisma.merchant.findUnique({
    where: { merchantId: SELLER_MERCHANT_ID },
    select: { id: true, merchantId: true, sellerNumber: true, merchantName: true },
  });
  assert(merchant, `no merchant with merchantId=${SELLER_MERCHANT_ID} found`);
  console.log(
    `Seller: #${merchant.merchantId} (sellerNumber=${merchant.sellerNumber}) "${merchant.merchantName}"`,
  );

  // ── 2. Load the seller's orders dated 2026-09-16 (UTC) ───────────────────
  const orders = await prisma.order.findMany({
    where: {
      merchantId: merchant.id,
      createdAt: { gte: windowStart, lt: windowEnd },
    },
    select: {
      id: true,
      orderId: true,
      createdAt: true,
      location: true,
      financialStatus: true,
      isArchived: true,
    },
  });

  const imported = orders.filter((o) => isUtcMidnight(o.createdAt));
  const notImported = orders.filter((o) => !isUtcMidnight(o.createdAt));

  // ── 3. Report BEFORE ─────────────────────────────────────────────────────
  console.log(`\n── BEFORE ─────────────────────────────────────────────────────`);
  console.log(`Total orders for seller 2 dated ${OLD_DATE} (UTC): ${orders.length}`);
  console.log(`  • Imported (midnight UTC, in scope): ${imported.length}`);
  console.log(`  • NOT imported (excluded):          ${notImported.length}`);

  if (notImported.length > 0) {
    console.log(`\n  Excluded (non-imported, left untouched):`);
    for (const o of notImported) {
      console.log(
        `    ${o.orderId}: createdAt=${o.createdAt.toISOString()} loc=${o.location} fin=${o.financialStatus}`,
      );
    }
  }

  console.log(`\n  To backdate (${imported.length}):`);
  for (const o of imported) {
    const after = new Date(o.createdAt.getTime() - TWO_DAYS_MS);
    console.log(
      `    ${o.orderId}: ${o.createdAt.toISOString()} → ${after.toISOString()} (loc=${o.location} fin=${o.financialStatus})`,
    );
  }

  if (imported.length === 0) {
    console.log(`\nNothing to update — no imported seller-2 orders dated ${OLD_DATE}. Aborting.`);
    return;
  }

  if (!APPLY) {
    console.log(`\nDRY RUN complete — no writes performed. Re-run with APPLY=1 to apply.`);
    return;
  }

  // ── 4. Validate every target is still on OLD_DATE before writing ─────────
  for (const o of imported) {
    assert(
      datePartUTC(o.createdAt) === OLD_DATE,
      `${o.orderId}: createdAt is ${o.createdAt.toISOString()}, expected date ${OLD_DATE}`,
    );
  }

  // ── 5. Write: single transaction, -2 days per order (preserves time-of-day)
  await prisma.$transaction(
    imported.map((o) =>
      prisma.order.update({
        where: { id: o.id },
        data: { createdAt: new Date(o.createdAt.getTime() - TWO_DAYS_MS) },
      }),
    ),
  );

  // ── 6. AFTER report + post-fix verification ──────────────────────────────
  const after = await prisma.order.findMany({
    where: { id: { in: imported.map((o) => o.id) } },
    select: { orderId: true, createdAt: true },
  });

  console.log(`\n── AFTER ──────────────────────────────────────────────────────`);
  for (const o of after) {
    console.log(`${o.orderId}: createdAt=${o.createdAt.toISOString()}`);
  }

  for (const o of after) {
    assert(
      datePartUTC(o.createdAt) === NEW_DATE,
      `${o.orderId}: post-fix createdAt is ${o.createdAt.toISOString()}, expected date ${NEW_DATE}`,
    );
  }
  console.log(`\n✓ ${after.length}/${imported.length} imported seller-2 orders now dated ${NEW_DATE}.`);
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
