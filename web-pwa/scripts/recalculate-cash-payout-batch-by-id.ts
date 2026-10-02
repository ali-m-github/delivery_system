/**
 * Recalculate a CashPayoutBatch by numeric id using current order data.
 *
 * Mirrors the canonical formula in
 *   POST /api/admin/merchants/[id]/cash-payouts
 *
 * Usage:
 *   npx tsx scripts/recalculate-cash-payout-batch-by-id.ts <id> [--dry-run]
 *
 * Example:
 *   npx tsx scripts/recalculate-cash-payout-batch-by-id.ts 96
 *   npx tsx scripts/recalculate-cash-payout-batch-by-id.ts 96 --dry-run
 *
 * Formula:
 *   sellerRate   = merchant.defaultSellerRate ?? 4.0
 *   profitRate   = merchant.defaultProfitRate ?? 0
 *   fee          = sellerRate + profitRate
 *   grossAdvance = SUM( amountUsd - fee )   for each advance order (skip -Exchange)
 *   deductedReturns = SUM( amountUsd - fee ) for each return order (skip -Exchange)
 *   totalAdjustments = SUM( amountUsd )      for each PayoutAdjustment
 *   netPaid = grossAdvance - deductedReturns + totalAdjustments
 *   profit  = SUM( computeOrderProfit(merchant, driverException) ) for advance orders
 */

import { PrismaClient } from "@prisma/client";
import { computeOrderProfit, resolveDriverSellerException } from "@/lib/profit";

const prisma = new PrismaClient();

async function main() {
  const id = parseInt(process.argv[2], 10);
  const dryRun = process.argv.includes("--dry-run");

  if (isNaN(id)) {
    console.error(
      "Usage: npx tsx scripts/recalculate-cash-payout-batch-by-id.ts <id> [--dry-run]",
    );
    process.exit(1);
  }

  // 1. Load the batch
  const batch = await prisma.cashPayoutBatch.findUnique({
    where: { id },
    include: {
      merchant: {
        select: {
          id: true,
          merchantId: true,
          sellerNumber: true,
          merchantName: true,
          defaultSellerRate: true,
          defaultProfitRate: true,
        },
      },
      orders: {
        select: {
          id: true,
          orderId: true,
          amountUsd: true,
          driverId: true,
        },
        orderBy: { createdAt: "asc" },
      },
      resolvedReturns: {
        select: {
          id: true,
          orderId: true,
          amountUsd: true,
          driverId: true,
        },
        orderBy: { createdAt: "asc" },
      },
      adjustments: { select: { id: true, description: true, amountUsd: true } },
    },
  });

  if (!batch) {
    console.error(`CashPayoutBatch id=${id} not found.`);
    process.exit(1);
  }

  const merchantId = batch.merchant.id;
  const sellerRate = batch.merchant.defaultSellerRate ?? 4.0;
  const profitRate = batch.merchant.defaultProfitRate ?? 0;
  const fee = sellerRate + profitRate;

  console.log("=".repeat(70));
  console.log(`Recalculating CashPayoutBatch id=${batch.id} (${batch.batchReference})`);
  console.log(
    `Merchant: ${batch.merchant.merchantName} (ID ${batch.merchant.merchantId}, Seller #${batch.merchant.sellerNumber})`,
  );
  console.log(`Rates: sellerRate=${sellerRate}, profitRate=${profitRate}, fee=${fee}`);
  console.log("=".repeat(70));

  // 2. Advance orders -> grossAdvance + profit
  let grossAdvance = 0;
  let profit = 0;

  console.log("\n--- Advance Orders ---");
  for (const o of batch.orders) {
    // "-Exchange" proof orders carry no price and must never be advanced.
    if (o.orderId.endsWith("-Exchange")) {
      console.log(`  ${o.orderId}: SKIPPED (-Exchange)`);
      continue;
    }
    const contribution = (o.amountUsd ?? 0) - fee;
    grossAdvance += contribution;

    const driverException = await resolveDriverSellerException(
      o.driverId,
      merchantId,
    );
    const orderProfit = computeOrderProfit(
      { defaultSellerRate: sellerRate, defaultProfitRate: profitRate },
      driverException,
    );
    profit += orderProfit;

    console.log(
      `  ${o.orderId}: amountUsd=${o.amountUsd} -> contribution=${contribution.toFixed(2)}, profit=${orderProfit.toFixed(2)}`,
    );
  }

  // 3. Return orders -> deductedReturns
  let deductedReturns = 0;
  console.log("\n--- Return Orders (deductions) ---");
  for (const o of batch.resolvedReturns) {
    if (o.orderId.endsWith("-Exchange")) {
      console.log(`  ${o.orderId}: SKIPPED (-Exchange)`);
      continue;
    }
    const contribution = (o.amountUsd ?? 0) - fee;
    deductedReturns += contribution;
    console.log(
      `  ${o.orderId}: amountUsd=${o.amountUsd} -> deduction=${contribution.toFixed(2)}`,
    );
  }

  // 4. Adjustments
  const totalAdjustments = batch.adjustments.reduce(
    (sum, adj) => sum + (adj.amountUsd ?? 0),
    0,
  );
  console.log(`\n--- Adjustments (${batch.adjustments.length}) ---`);
  for (const adj of batch.adjustments) {
    console.log(`  ${adj.description}: ${adj.amountUsd.toFixed(2)}`);
  }
  console.log(`  => totalAdjustments = ${totalAdjustments.toFixed(2)}`);

  // 5. Net paid
  const netPaid = grossAdvance - deductedReturns + totalAdjustments;

  console.log("\n" + "=".repeat(70));
  console.log("OLD:");
  console.log(`  grossAdvance:    ${batch.grossAdvance.toFixed(2)}`);
  console.log(`  deductedReturns: ${batch.deductedReturns.toFixed(2)}`);
  console.log(`  netPaid:         ${batch.netPaid.toFixed(2)}`);
  console.log(`  profit:          ${batch.profit.toFixed(2)}`);
  console.log("NEW:");
  console.log(`  grossAdvance:    ${grossAdvance.toFixed(2)}`);
  console.log(`  deductedReturns: ${deductedReturns.toFixed(2)}`);
  console.log(`  netPaid:         ${netPaid.toFixed(2)}`);
  console.log(`  profit:          ${profit.toFixed(2)}`);
  console.log("=".repeat(70));

  const hasChanges =
    Math.abs(batch.grossAdvance - grossAdvance) > 0.005 ||
    Math.abs(batch.deductedReturns - deductedReturns) > 0.005 ||
    Math.abs(batch.netPaid - netPaid) > 0.005 ||
    Math.abs(batch.profit - profit) > 0.005;

  if (!hasChanges) {
    console.log("\nNo changes detected. Batch totals are already correct.");
    await prisma.$disconnect();
    return;
  }

  if (dryRun) {
    console.log("\n[dry-run] No changes written.");
    await prisma.$disconnect();
    return;
  }

  const updated = await prisma.cashPayoutBatch.update({
    where: { id: batch.id },
    data: { grossAdvance, deductedReturns, netPaid, profit },
  });

  console.log(`\nBatch ${updated.batchReference} recalculated successfully.`);
  console.log(`  grossAdvance:    ${updated.grossAdvance.toFixed(2)}`);
  console.log(`  deductedReturns: ${updated.deductedReturns.toFixed(2)}`);
  console.log(`  netPaid:         ${updated.netPaid.toFixed(2)}`);
  console.log(`  profit:          ${updated.profit.toFixed(2)}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  prisma.$disconnect();
  process.exit(1);
});
