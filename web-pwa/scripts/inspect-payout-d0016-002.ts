/**
 * Inspect DriverPayout D0016-002 and its orders, plus any driver whose
 * driverId looks like "dr", to plan a safe deletion + reassignment.
 *
 * Usage:
 *   npx tsx scripts/inspect-payout-d0016-002.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REFERENCE = "D0016-002";

async function main() {
  const payout = await prisma.driverPayout.findUnique({
    where: { payoutReference: REFERENCE },
    include: {
      driver: { select: { id: true, driverId: true, firstName: true, lastName: true } },
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
          merchantId: true,
          zoneId: true,
          cashPayoutBatchId: true,
          merchantPayoutId: true,
        },
      },
      paidStatements: { select: { id: true, sequentialIndex: true, paymentStatus: true } },
    },
  });

  if (!payout) {
    console.error(`Payout ${REFERENCE} not found.`);
  } else {
    console.log("── PAYOUT ───────────────────────────────────────────────");
    console.log(
      `id=${payout.id} ref=${payout.payoutReference} seq=${payout.sequentialIndex} status=${payout.status} clearedAt=${payout.clearedAt}`,
    );
    console.log(
      `driver: ${payout.driver.driverId} (${payout.driver.firstName} ${payout.driver.lastName}) id=${payout.driver.id}`,
    );
    console.log(
      `totalUsd=${payout.totalUsd} totalLbp=${payout.totalLbp} commissionUsd=${payout.commissionUsd} netUsd=${payout.netUsd} totalCollected=${payout.totalCollected}`,
    );
    console.log(
      `previousDebtUsd=${payout.previousDebtUsd} amountPaidUsd=${payout.amountPaidUsd} amountPaidLbp=${payout.amountPaidLbp} remainingUsd=${payout.remainingUsd} remainingLbp=${payout.remainingLbp}`,
    );
    console.log(
      `statementsDeductedUsd=${payout.statementsDeductedUsd} treasuryBoxId=${payout.treasuryBoxId}`,
    );
    console.log(`paidStatements: ${JSON.stringify(payout.paidStatements)}`);
    console.log(`orders (${payout.orders.length}):`);
    for (const o of payout.orders) {
      console.log(`  ${JSON.stringify(o)}`);
    }

    const txs = await prisma.treasuryTransaction.findMany({
      where: { referenceId: payout.id },
      select: { id: true, reference: true, type: true, amountUsd: true, status: true, boxId: true },
    });
    console.log(`treasuryTransactions referencing payout: ${JSON.stringify(txs)}`);
  }

  // Drivers whose driverId contains "dr" (case-insensitive) — to resolve "driver-dr".
  const drivers = await prisma.driverProfile.findMany({
    where: { driverId: { contains: "dr", mode: "insensitive" } },
    select: { id: true, driverId: true, firstName: true, lastName: true, isAvailable: true },
    orderBy: { driverId: "asc" },
  });
  console.log("\n── DRIVERS matching 'dr' ────────────────────────────────");
  for (const d of drivers) {
    console.log(`  ${d.driverId} — ${d.firstName} ${d.lastName} id=${d.id} available=${d.isAvailable}`);
  }
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
