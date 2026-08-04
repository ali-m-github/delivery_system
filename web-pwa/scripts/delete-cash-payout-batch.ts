/**
 * Delete a CashPayoutBatch and return its orders to the available pool.
 *
 * What this does (in a single atomic transaction):
 *   1. Unlinks all advance orders  (cashPayoutBatchId = null)  → they become
 *      eligible again in the "Unpaid Eligible Orders" workspace list.
 *   2. Unlinks all deducted returns (returnDeductionBatchId = null) and resets
 *      their financialStatus back to "Re" → they become pending returns again.
 *   3. Deletes the batch record (PayoutAdjustment rows cascade-delete).
 *
 * Usage:
 *   Dry run (inspect only, no changes):
 *     npx tsx scripts/delete-cash-payout-batch.ts 8-03082026 --dry-run
 *   Execute:
 *     npx tsx scripts/delete-cash-payout-batch.ts 8-03082026
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BATCH_REFERENCE = process.argv[2] || "8-03082026";
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const batch = await prisma.cashPayoutBatch.findUnique({
    where: { batchReference: BATCH_REFERENCE },
    include: {
      merchant: { select: { merchantId: true, merchantName: true } },
      orders: {
        select: { id: true, orderId: true, amountUsd: true, location: true },
      },
      resolvedReturns: {
        select: {
          id: true,
          orderId: true,
          amountUsd: true,
          financialStatus: true,
        },
      },
      adjustments: true,
    },
  });

  if (!batch) {
    console.error(`Batch "${BATCH_REFERENCE}" not found.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("=== Cash Payout Batch Found ===");
  console.log({
    id: batch.id,
    batchReference: batch.batchReference,
    merchant: `${batch.merchant.merchantName} (#${batch.merchant.merchantId})`,
    grossAdvance: batch.grossAdvance,
    deductedReturns: batch.deductedReturns,
    netPaid: batch.netPaid,
    profit: batch.profit,
    createdAt: batch.createdAt.toISOString(),
  });
  console.log(
    `\nAdvance orders (${batch.orders.length}):`,
    batch.orders.map((o) => `${o.orderId} ($${o.amountUsd})`).join(", ") ||
      "none",
  );
  console.log(
    `Resolved returns (${batch.resolvedReturns.length}):`,
    batch.resolvedReturns
      .map((o) => `${o.orderId} ($${o.amountUsd}, ${o.financialStatus})`)
      .join(", ") || "none",
  );
  console.log(
    `Adjustments (${batch.adjustments.length}):`,
    batch.adjustments
      .map((a) => `${a.description} ($${a.amountUsd})`)
      .join("; ") || "none",
  );

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No changes made.");
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Unlink advance orders → available again for a future cash payout batch
    const advanceOrders = await tx.order.updateMany({
      where: { cashPayoutBatchId: batch.id },
      data: { cashPayoutBatchId: null },
    });

    // 2. Unlink deducted returns → pending returns again (undo RTS marking)
    const returnedOrders = await tx.order.updateMany({
      where: { returnDeductionBatchId: batch.id },
      data: { returnDeductionBatchId: null, financialStatus: "Re" },
    });

    // 3. Delete the batch (PayoutAdjustment rows cascade-delete)
    await tx.cashPayoutBatch.delete({ where: { id: batch.id } });

    return {
      advanceOrders: advanceOrders.count,
      returnedOrders: returnedOrders.count,
    };
  });

  console.log("\n=== Deleted ===");
  console.log(
    `Unlinked ${result.advanceOrders} advance order(s) → cashPayoutBatchId = null (available again)`,
  );
  console.log(
    `Unlinked ${result.returnedOrders} return order(s) → returnDeductionBatchId = null, financialStatus reset to "Re"`,
  );
  console.log(
    `Batch "${BATCH_REFERENCE}" (id=${batch.id}) deleted; its PayoutAdjustments cascade-deleted.`,
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal:", err);
  await prisma.$disconnect();
  process.exit(1);
});
