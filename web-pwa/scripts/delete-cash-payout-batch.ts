/**
 * Delete (revoke) a CashPayoutBatch and return its orders to the available pool.
 *
 * What this does (in a single atomic transaction) — the exact inverse of the
 * payout POST in app/api/admin/merchants/[id]/cash-payouts/route.ts:
 *   1. Unlinks all advance orders  (cashPayoutBatchId = null)  → they become
 *      eligible again in the "Unpaid Eligible Orders" workspace list.
 *   2. Unlinks all deducted returns (returnDeductionBatchId = null), resets
 *      their financialStatus back to "Re" AND strips the "R" suffix the payout
 *      appended to their orderId (orderIdForFinancialStatus).
 *   3. Un-settles any Return Batches settled through this payout
 *      (status SETTLED → PENDING, cashPayoutBatchId = null) so they can be
 *      selected again by the re-done payout.
 *   4. Deletes the batch record (PayoutAdjustment rows cascade-delete).
 *
 * Usage:
 *   Dry run (inspect only, no changes):
 *     npx tsx scripts/delete-cash-payout-batch.ts 8-03082026 --dry-run
 *   Execute:
 *     npx tsx scripts/delete-cash-payout-batch.ts 8-03082026
 */

import { PrismaClient } from "@prisma/client";
import { orderIdForFinancialStatus } from "../lib/order-id";

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
      settledReturnBatches: {
        select: { id: true, batchNumber: true, status: true },
      },
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
  console.log(
    `Settled return batches (${batch.settledReturnBatches.length}):`,
    batch.settledReturnBatches
      .map((b) => `${b.batchNumber} (${b.status})`)
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

    // 2. Unlink deducted returns → pending returns again (undo RTS marking).
    //    Undo per-order: financialStatus "Re" + strip the "R" orderId suffix
    //    the payout appended, mirroring orderIdForFinancialStatus in the POST.
    for (const o of batch.resolvedReturns) {
      await tx.order.update({
        where: { id: o.id },
        data: {
          returnDeductionBatchId: null,
          financialStatus: "Re",
          orderId: orderIdForFinancialStatus(o.orderId, "Re"),
        },
      });
    }

    // 3. Un-settle return batches settled through this payout so the re-done
    //    payout can claim them again.
    const settledBatches = await tx.returnBatch.updateMany({
      where: { cashPayoutBatchId: batch.id },
      data: { status: "PENDING", cashPayoutBatchId: null },
    });

    // 4. Delete the batch (PayoutAdjustment rows cascade-delete)
    await tx.cashPayoutBatch.delete({ where: { id: batch.id } });

    return {
      advanceOrders: advanceOrders.count,
      returnedOrders: batch.resolvedReturns.length,
      settledBatches: settledBatches.count,
    };
  });

  console.log("\n=== Deleted ===");
  console.log(
    `Unlinked ${result.advanceOrders} advance order(s) → cashPayoutBatchId = null (available again)`,
  );
  console.log(
    `Unlinked ${result.returnedOrders} return order(s) → returnDeductionBatchId = null, financialStatus reset to "Re", "R" orderId suffix stripped`,
  );
  console.log(
    `Un-settled ${result.settledBatches} return batch(es) → status "PENDING", cashPayoutBatchId = null`,
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
