/**
 * Recalculate a CashPayoutBatch totals based on current order data.
 *
 * Usage:
 *   npx tsx scripts/recalculate-cash-payout-batch.ts <batchReference>
 *
 * Example:
 *   npx tsx scripts/recalculate-cash-payout-batch.ts 8-09082026-2
 *
 * Formula (per the POST /api/admin/merchants/[id]/cash-payouts route):
 *   fee        = defaultSellerRate + defaultProfitRate
 *   grossAdvance  = SUM( (amountUsd - fee) ) for each advance order
 *   deductedReturns = SUM( (amountUsd - fee) ) for each return order
 *   totalAdjustments = SUM( amountUsd ) for each PayoutAdjustment
 *   netPaid = grossAdvance - deductedReturns + totalAdjustments
 *   profit  = SUM( computeOrderProfit(...) ) for each advance order
 */

import { PrismaClient } from "@prisma/client";
import { computeOrderProfit, resolveDriverSellerException } from "@/lib/profit";

const prisma = new PrismaClient();

async function main() {
  const batchReference = process.argv[2];
  if (!batchReference) {
    console.error(
      "Usage: npx tsx scripts/recalculate-cash-payout-batch.ts <batchReference>",
    );
    console.error(
      "Example: npx tsx scripts/recalculate-cash-payout-batch.ts 8-09082026-2",
    );
    process.exit(1);
  }

  // 1. Find the batch
  const batch = await prisma.cashPayoutBatch.findUnique({
    where: { batchReference },
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
          collectedUsd: true,
          driverId: true,
        },
      },
      resolvedReturns: {
        select: {
          id: true,
          orderId: true,
          amountUsd: true,
          collectedUsd: true,
          driverId: true,
        },
      },
      adjustments: {
        select: {
          id: true,
          description: true,
          amountUsd: true,
        },
      },
    },
  });

  if (!batch) {
    console.error(`Batch "${batchReference}" not found.`);
    process.exit(1);
  }

  console.log("=".repeat(70));
  console.log(`Recalculating batch: ${batch.batchReference}`);
  console.log(
    `Merchant: ${batch.merchant.merchantName} (ID: ${batch.merchant.merchantId}, Seller #: ${batch.merchant.sellerNumber})`,
  );
  console.log("=".repeat(70));

  const merchantId = batch.merchant.id;
  const sellerRate = batch.merchant.defaultSellerRate ?? 4.0;
  const profitRate = batch.merchant.defaultProfitRate ?? 0;
  const fee = sellerRate + profitRate;

  console.log(
    `\nRates: sellerRate=${sellerRate}, profitRate=${profitRate}, fee=${fee}`,
  );

  // 2. Recalculate grossAdvance from advance orders
  let grossAdvance = 0;
  let profit = 0;

  console.log("\n--- Advance Orders ---");
  for (const o of batch.orders) {
    const orderAmount = o.amountUsd ?? 0;
    const contribution = orderAmount - fee;
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
      `  Order ${o.orderId}: amountUsd=${orderAmount}, contribution=${contribution.toFixed(2)}, profit=${orderProfit.toFixed(2)}`,
    );
  }
  console.log(`  => grossAdvance = ${grossAdvance.toFixed(2)}`);
  console.log(`  => profit = ${profit.toFixed(2)}`);

  // 3. Recalculate deductedReturns from return orders
  let deductedReturns = 0;

  console.log("\n--- Return Orders (deductions) ---");
  for (const o of batch.resolvedReturns) {
    const orderAmount = o.amountUsd ?? 0;
    const contribution = orderAmount - fee;
    deductedReturns += contribution;
    console.log(
      `  Order ${o.orderId}: amountUsd=${orderAmount}, deduction=${contribution.toFixed(2)}`,
    );
  }
  console.log(`  => deductedReturns = ${deductedReturns.toFixed(2)}`);

  // 4. Sum adjustments
  const totalAdjustments = batch.adjustments.reduce(
    (sum, adj) => sum + (adj.amountUsd ?? 0),
    0,
  );

  console.log("\n--- Adjustments ---");
  for (const adj of batch.adjustments) {
    console.log(`  ${adj.description}: ${adj.amountUsd.toFixed(2)}`);
  }
  console.log(`  => totalAdjustments = ${totalAdjustments.toFixed(2)}`);

  // 5. Calculate netPaid
  const netPaid = grossAdvance - deductedReturns + totalAdjustments;

  console.log("\n" + "=".repeat(70));
  console.log("OLD VALUES:");
  console.log(`  grossAdvance:    ${batch.grossAdvance.toFixed(2)}`);
  console.log(`  deductedReturns: ${batch.deductedReturns.toFixed(2)}`);
  console.log(`  netPaid:         ${batch.netPaid.toFixed(2)}`);
  console.log(`  profit:          ${batch.profit.toFixed(2)}`);
  console.log("\nNEW VALUES:");
  console.log(`  grossAdvance:    ${grossAdvance.toFixed(2)}`);
  console.log(`  deductedReturns: ${deductedReturns.toFixed(2)}`);
  console.log(`  netPaid:         ${netPaid.toFixed(2)}`);
  console.log(`  profit:          ${profit.toFixed(2)}`);
  console.log("=".repeat(70));

  // 6. Check if anything changed
  const hasChanges =
    Math.abs(batch.grossAdvance - grossAdvance) > 0.005 ||
    Math.abs(batch.deductedReturns - deductedReturns) > 0.005 ||
    Math.abs(batch.netPaid - netPaid) > 0.005 ||
    Math.abs(batch.profit - profit) > 0.005;

  if (!hasChanges) {
    console.log("\nNo changes detected. Batch totals are already correct.");
    await prisma.$disconnect();
    process.exit(0);
  }

  // 7. Update the batch
  console.log("\nUpdating batch...");
  const updated = await prisma.cashPayoutBatch.update({
    where: { id: batch.id },
    data: {
      grossAdvance,
      deductedReturns,
      netPaid,
      profit,
    },
  });

  console.log(`Batch ${updated.batchReference} recalculated successfully.`);
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
