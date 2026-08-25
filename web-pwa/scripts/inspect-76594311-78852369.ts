/**
 * Inspect orders 76594311 & 78852369: financials, statement, driver payout, cash batch.
 * Run: npx tsx scripts/inspect-76594311-78852369.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORDER_IDS = ["76594311", "78852369"];

async function main() {
  const orders = await prisma.order.findMany({
    where: { orderId: { in: ORDER_IDS } },
    include: {
      driver: { select: { id: true, driverId: true, firstName: true, lastName: true } },
      merchant: { select: { id: true, merchantId: true, merchantName: true, isCashSeller: true, defaultSellerRate: true, defaultProfitRate: true } },
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
          profitUsd: true,
          paymentStatus: true,
        },
      },
      cashPayoutBatch: {
        select: { id: true, batchReference: true, grossAdvance: true, deductedReturns: true, netPaid: true, profit: true },
      },
    },
  });

  for (const order of orders) {
    console.log(`\n========== ORDER ${order.orderId} ==========`);
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
          orders: { select: { orderId: true, amountUsd: true, amountLbp: true, collectedUsd: true, collectedLbp: true, financialStatus: true } },
          driver: { select: { driverId: true, firstName: true, lastName: true } },
        },
      });
      console.log("--- DRIVER PAYOUT (all orders) ---");
      console.log(JSON.stringify(payout, null, 2));
    }

    if (order.merchantPayout) {
      const statement = await prisma.merchantPayout.findUnique({
        where: { id: order.merchantPayout.id },
        select: {
          id: true,
          merchantId: true,
          sequentialIndex: true,
          totalUsd: true,
          totalLbp: true,
          shippingUsd: true,
          shippingLbp: true,
          netUsd: true,
          netLbp: true,
          profitUsd: true,
          paymentStatus: true,
          amountPaidUsd: true,
          amountPaidLbp: true,
          orders: { select: { orderId: true, amountUsd: true, amountLbp: true, collectedUsd: true, collectedLbp: true, financialStatus: true, zoneId: true } },
          merchant: { select: { merchantName: true, defaultSellerRate: true, defaultProfitRate: true } },
        },
      });
      console.log("--- MERCHANT STATEMENT (all orders) ---");
      console.log(JSON.stringify(statement, null, 2));
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
          orders: { select: { orderId: true, amountUsd: true, collectedUsd: true, financialStatus: true } },
        },
      });
      console.log("--- CASH PAYOUT BATCH ---");
      console.log(JSON.stringify(batch, null, 2));
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
