/**
 * diag-payout-d1-004.ts — read-only diagnostic for the 557 vs 29 discrepancy
 * on DriverPayout D1-004 (cmsbtrcp4000ulqagvlflynn2).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PAYOUT_ID = "cmsbtrcp4000ulqagvlflynn2";

async function main() {
  const payout = await prisma.driverPayout.findUnique({ where: { id: PAYOUT_ID } });
  if (!payout) {
    console.error("payout not found");
    process.exit(1);
  }
  console.log("── payout ──");
  console.table({
    id: payout.id,
    driverId: payout.driverId,
    status: payout.status,
    payoutReference: payout.payoutReference,
    sequentialIndex: payout.sequentialIndex,
    totalUsd: payout.totalUsd,
    totalCollected: payout.totalCollected,
    commissionUsd: payout.commissionUsd,
    netUsd: payout.netUsd,
    amountPaidUsd: payout.amountPaidUsd,
    remainingUsd: payout.remainingUsd,
    previousDebtUsd: payout.previousDebtUsd,
    statementsDeductedUsd: payout.statementsDeductedUsd,
    treasuryBoxId: payout.treasuryBoxId,
    createdById: payout.createdById,
    createdAt: payout.createdAt,
    clearedAt: payout.clearedAt,
  });

  const orders = await prisma.order.findMany({
    where: { driverPayoutId: PAYOUT_ID },
    select: {
      id: true,
      orderId: true,
      amountUsd: true,
      collectedUsd: true,
      financialStatus: true,
      location: true,
      driverId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n── orders linked to payout: ${orders.length} ──`);
  for (const o of orders) console.log(" ", o);
  const sumAmt = orders.reduce((s, o) => s + (o.amountUsd ?? 0), 0);
  const sumCol = orders.reduce((s, o) => s + (o.collectedUsd ?? 0), 0);
  console.log(`  sum amountUsd = ${sumAmt}, sum collectedUsd = ${sumCol}`);

  const driverPayouts = await prisma.driverPayout.findMany({
    where: { driverId: payout.driverId },
    select: {
      id: true,
      payoutReference: true,
      sequentialIndex: true,
      status: true,
      totalUsd: true,
      commissionUsd: true,
      netUsd: true,
      amountPaidUsd: true,
      createdAt: true,
      clearedAt: true,
      _count: { select: { orders: true } },
    },
    orderBy: { sequentialIndex: "asc" },
  });
  console.log(`\n── all payouts for driver ${payout.driverId} (${driverPayouts.length}) ──`);
  for (const p of driverPayouts) console.log(" ", p);

  const hist = await prisma.orderHistory.findMany({
    where: { orderId: { in: orders.map((o) => o.id) } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n── order history for linked orders (${hist.length}) ──`);
  for (const h of hist) console.log(" ", h.createdAt, "|", h.action, "|", h.location, "| user", h.userId);
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
