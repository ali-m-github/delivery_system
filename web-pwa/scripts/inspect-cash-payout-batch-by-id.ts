/**
 * Inspect a CashPayoutBatch by numeric id and show its current totals,
 * orders, returns and adjustments (NO writes).
 *
 * Usage:
 *   npx tsx scripts/inspect-cash-payout-batch-by-id.ts 96
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const id = parseInt(process.argv[2], 10);
  if (isNaN(id)) {
    console.error("Usage: npx tsx scripts/inspect-cash-payout-batch-by-id.ts <id>");
    process.exit(1);
  }

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
          amountLbp: true,
          collectedUsd: true,
          collectedLbp: true,
          driverId: true,
          financialStatus: true,
          location: true,
        },
        orderBy: { createdAt: "asc" },
      },
      resolvedReturns: {
        select: {
          id: true,
          orderId: true,
          amountUsd: true,
          amountLbp: true,
          collectedUsd: true,
          collectedLbp: true,
          driverId: true,
          financialStatus: true,
          location: true,
        },
        orderBy: { createdAt: "asc" },
      },
      adjustments: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!batch) {
    console.error(`CashPayoutBatch id=${id} not found.`);
    process.exit(1);
  }

  console.log("=".repeat(70));
  console.log(`Batch id: ${batch.id}`);
  console.log(`Reference: ${batch.batchReference}`);
  console.log(`Merchant: ${batch.merchant.merchantName} (ID ${batch.merchant.merchantId}, Seller #${batch.merchant.sellerNumber})`);
  console.log(`Rates: seller=${batch.merchant.defaultSellerRate}, profit=${batch.merchant.defaultProfitRate}`);
  console.log(`Created: ${batch.createdAt.toISOString()}`);
  console.log(`Updated: ${batch.updatedAt.toISOString()}`);
  console.log("CURRENT TOTALS:");
  console.log(`  grossAdvance:    ${batch.grossAdvance}`);
  console.log(`  deductedReturns: ${batch.deductedReturns}`);
  console.log(`  netPaid:         ${batch.netPaid}`);
  console.log(`  profit:          ${batch.profit}`);
  console.log("=".repeat(70));

  console.log(`\n--- Advance Orders (${batch.orders.length}) ---`);
  batch.orders.forEach((o) => {
    console.log(
      `  ${o.orderId}: amountUsd=${o.amountUsd} amountLbp=${o.amountLbp} collectedUsd=${o.collectedUsd} collectedLbp=${o.collectedLbp} driverId=${o.driverId} fin=${o.financialStatus} loc=${o.location}`,
    );
  });

  console.log(`\n--- Return Orders (${batch.resolvedReturns.length}) ---`);
  batch.resolvedReturns.forEach((o) => {
    console.log(
      `  ${o.orderId}: amountUsd=${o.amountUsd} amountLbp=${o.amountLbp} collectedUsd=${o.collectedUsd} collectedLbp=${o.collectedLbp} driverId=${o.driverId} fin=${o.financialStatus} loc=${o.location}`,
    );
  });

  console.log(`\n--- Adjustments (${batch.adjustments.length}) ---`);
  batch.adjustments.forEach((a) => {
    console.log(`  #${a.id} ${a.description}: usd=${a.amountUsd} lbp=${a.amountLbp}`);
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  prisma.$disconnect();
  process.exit(1);
});
