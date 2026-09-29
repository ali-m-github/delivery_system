/**
 * delete-merchant-15-orders-28-9-2026.ts
 *
 * One-off data cleanup: remove ALL orders entered (created) on 28/9/2026
 * for merchant with numeric merchantId = 15.
 *
 * "Date Received" is stored in Order.createdAt (see
 * scripts/fix-date-received-24-8-2026.ts). Day range is UTC:
 *   [2026-09-28T00:00:00.000Z, 2026-09-29T00:00:00.000Z)
 *
 * Safety:
 *   - Resolves merchant 15 by its numeric merchantId.
 *   - Pre-flight inspection prints every matching order and its payout/batch
 *     linkage BEFORE any write.
 *   - ABORTS without deleting if ANY matching order is linked to a
 *     DriverPayout, MerchantPayout, CashPayoutBatch (advance or return
 *     deduction), because deleting those would silently corrupt financial
 *     totals. If that happens, report back and handle the linkage first.
 *   - OrderHistory rows cascade on order delete (schema onDelete: Cascade).
 *
 * Run:
 *   npx tsx scripts/delete-merchant-15-orders-28-9-2026.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MERCHANT_NUMERIC_ID = 15;
const DAY_START = new Date("2026-09-28T00:00:00.000Z");
const DAY_END = new Date("2026-09-29T00:00:00.000Z");

async function main() {
  // ── 1. Resolve merchant 15 (numeric merchantId → cuid) ────────────────
  const merchant = await prisma.merchant.findUnique({
    where: { merchantId: MERCHANT_NUMERIC_ID },
    select: { id: true, merchantId: true, merchantName: true },
  });

  if (!merchant) {
    console.error(`ERROR: Merchant with merchantId=${MERCHANT_NUMERIC_ID} not found.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("=".repeat(70));
  console.log(`Merchant: ${merchant.merchantName} (numericId=${merchant.merchantId}, cuid=${merchant.id})`);
  console.log(`Day range: ${DAY_START.toISOString()} → ${DAY_END.toISOString()}`);
  console.log("=".repeat(70));

  // ── 2. Find all orders created on that day for this merchant ──────────
  const orders = await prisma.order.findMany({
    where: {
      merchantId: merchant.id,
      createdAt: { gte: DAY_START, lt: DAY_END },
    },
    select: {
      id: true,
      orderId: true,
      createdAt: true,
      amountUsd: true,
      amountLbp: true,
      location: true,
      financialStatus: true,
      driverPayoutId: true,
      merchantPayoutId: true,
      cashPayoutBatchId: true,
      returnDeductionBatchId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (orders.length === 0) {
    console.log("No orders found for merchant 15 on 28/9/2026. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nFound ${orders.length} order(s):\n`);
  for (const o of orders) {
    const links = [
      o.driverPayoutId ? `driverPayout=${o.driverPayoutId}` : null,
      o.merchantPayoutId ? `merchantPayout=${o.merchantPayoutId}` : null,
      o.cashPayoutBatchId ? `cashBatch=${o.cashPayoutBatchId}` : null,
      o.returnDeductionBatchId ? `returnDeductionBatch=${o.returnDeductionBatchId}` : null,
    ].filter(Boolean);
    console.log(
      `  ${o.orderId.padEnd(14)} created=${o.createdAt.toISOString()}  ` +
        `loc=${o.location.padEnd(12)} fin=${o.financialStatus.padEnd(6)} ` +
        `$${o.amountUsd} / LBP ${o.amountLbp}  ${links.length ? `LINKED: ${links.join(", ")}` : ""}`,
    );
  }

  // ── 3. Safety check: abort if any order is linked to financial records ─
  const linked = orders.filter(
    (o) =>
      o.driverPayoutId ||
      o.merchantPayoutId ||
      o.cashPayoutBatchId ||
      o.returnDeductionBatchId,
  );

  if (linked.length > 0) {
    console.error(
      `\nABORTING: ${linked.length} order(s) are linked to payouts/batches. ` +
        `Deleting them would corrupt financial totals. Resolve linkage first.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  const totalUsd = orders.reduce((s, o) => s + o.amountUsd, 0);
  const totalLbp = orders.reduce((s, o) => s + o.amountLbp, 0);

  console.log("\n" + "=".repeat(70));
  console.log(`All ${orders.length} orders are unlinked — safe to delete.`);
  console.log(`Aggregate: $${totalUsd.toFixed(2)} / LBP ${totalLbp.toFixed(2)}`);
  console.log("=".repeat(70));

  // ── 4. Delete in a single transaction (OrderHistory cascades) ─────────
  await prisma.$transaction(async (tx) => {
    const res = await tx.order.deleteMany({
      where: { id: { in: orders.map((o) => o.id) } },
    });
    console.log(`\n✓ Deleted ${res.count} order(s) for merchant 15 (28/9/2026).`);
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
