/**
 * Inspect merchant statement #19 (MerchantPayout.sequentialIndex = 19) before
 * adding a $3-per-order shipping charge, so the exact before/after figures can
 * be verified.
 *
 * Usage:
 *   npx tsx scripts/inspect-statement-19.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEQUENTIAL_INDEX = 19;

async function main() {
  const statements = await prisma.merchantPayout.findMany({
    where: { sequentialIndex: SEQUENTIAL_INDEX },
    include: {
      merchant: {
        select: {
          id: true,
          merchantName: true,
          isCashSeller: true,
          defaultSellerRate: true,
          defaultProfitRate: true,
        },
      },
      orders: {
        select: {
          id: true,
          orderId: true,
          location: true,
          financialStatus: true,
          amountUsd: true,
          amountLbp: true,
          collectedUsd: true,
          collectedLbp: true,
          zoneId: true,
          driverId: true,
        },
        orderBy: { orderId: "asc" },
      },
    },
  });

  if (statements.length === 0) {
    console.error(`No statement with sequentialIndex=${SEQUENTIAL_INDEX} found.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  for (const stmt of statements) {
    console.log("=".repeat(70));
    console.log(
      `Statement #${stmt.sequentialIndex}  id=${stmt.id}  createdAt=${stmt.createdAt.toISOString()}`,
    );
    console.log(
      `merchant: #${stmt.merchant.id} ${stmt.merchant.merchantName} ` +
        `isCashSeller=${stmt.merchant.isCashSeller} ` +
        `sellerRate=${stmt.merchant.defaultSellerRate} profitRate=${stmt.merchant.defaultProfitRate}`,
    );
    console.log(
      `money: totalUsd=${stmt.totalUsd} totalLbp=${stmt.totalLbp} ` +
        `shippingUsd=${stmt.shippingUsd} shippingLbp=${stmt.shippingLbp} ` +
        `netUsd=${stmt.netUsd} netLbp=${stmt.netLbp} profitUsd=${stmt.profitUsd}`,
    );
    console.log(
      `status=${stmt.status} paymentStatus=${stmt.paymentStatus} ` +
        `amountPaidUsd=${stmt.amountPaidUsd} amountPaidLbp=${stmt.amountPaidLbp} ` +
        `treasuryBoxId=${stmt.treasuryBoxId} treasuryTransactionId=${stmt.treasuryTransactionId} ` +
        `paidByDriverPayoutId=${stmt.paidByDriverPayoutId}`,
    );
    console.log(`orders (${stmt.orders.length}):`);
    for (const o of stmt.orders) {
      console.log(
        `  ${o.orderId} loc=${o.location} fin=${o.financialStatus} ` +
          `amtUsd=${o.amountUsd} colUsd=${o.collectedUsd} ` +
          `amtLbp=${o.amountLbp} colLbp=${o.collectedLbp} zone=${o.zoneId} driver=${o.driverId}`,
      );
    }
    console.log("=".repeat(70));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
