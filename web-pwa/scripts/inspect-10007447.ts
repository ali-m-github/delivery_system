/**
 * Inspect order 10007447: which payouts it belongs to, driver, financials.
 * Run: npx tsx scripts/inspect-10007447.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const order = await prisma.order.findUnique({
    where: { orderId: "10007447" },
    include: {
      driver: {
        select: { id: true, driverId: true, firstName: true, lastName: true },
      },
      merchant: {
        select: { id: true, merchantId: true, merchantName: true, isCashSeller: true, defaultSellerRate: true, defaultProfitRate: true },
      },
      zone: { select: { id: true, name: true } },
      driverPayout: {
        select: {
          id: true,
          status: true,
          sequentialIndex: true,
          payoutReference: true,
          totalUsd: true,
          totalLbp: true,
          commissionUsd: true,
          netUsd: true,
          totalCollected: true,
          amountPaidUsd: true,
          amountPaidLbp: true,
          remainingUsd: true,
          remainingLbp: true,
          clearedAt: true,
        },
      },
      merchantPayout: {
        select: {
          id: true,
          sequentialIndex: true,
          status: true,
          totalUsd: true,
          totalLbp: true,
          shippingUsd: true,
          shippingLbp: true,
          netUsd: true,
          netLbp: true,
          paymentStatus: true,
        },
      },
      cashPayoutBatch: {
        select: { id: true, batchReference: true, grossAdvance: true, deductedReturns: true, netPaid: true, profit: true },
      },
    },
  });

  if (!order) {
    console.error("Order 10007447 not found!");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("=== ORDER 10007447 ===");
  console.log(JSON.stringify(order, null, 2));

  if (order.driverPayout) {
    const payout = await prisma.driverPayout.findUnique({
      where: { id: order.driverPayout.id },
      select: {
        id: true,
        driverId: true,
        status: true,
        totalUsd: true,
        totalLbp: true,
        commissionUsd: true,
        netUsd: true,
        totalCollected: true,
        orders: {
          select: { orderId: true, amountUsd: true, amountLbp: true, collectedUsd: true, collectedLbp: true, zoneId: true, merchantId: true, financialStatus: true },
        },
        driver: { select: { driverId: true, firstName: true, lastName: true } },
      },
    });
    console.log("\n=== DRIVER PAYOUT (full) ===");
    console.log(JSON.stringify(payout, null, 2));
  }

  if (order.cashPayoutBatch) {
    const batch = await prisma.cashPayoutBatch.findUnique({
      where: { id: order.cashPayoutBatch.id },
      select: {
        id: true,
        batchReference: true,
        grossAdvance: true,
        deductedReturns: true,
        netPaid: true,
        profit: true,
        merchant: { select: { merchantName: true, defaultSellerRate: true, defaultProfitRate: true } },
        orders: { select: { orderId: true, amountUsd: true, collectedUsd: true, driverId: true } },
        resolvedReturns: { select: { orderId: true, amountUsd: true, collectedUsd: true } },
        adjustments: { select: { description: true, amountUsd: true } },
      },
    });
    console.log("\n=== CASH PAYOUT BATCH (full) ===");
    console.log(JSON.stringify(batch, null, 2));
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
