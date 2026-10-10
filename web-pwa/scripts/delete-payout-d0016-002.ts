/**
 * Delete DriverPayout D0016-002 and return its order(s) to be assigned to D999.
 *
 * What this does (in a single atomic transaction):
 *   1. Unlinks every order from the payout (driverPayoutId = null) and
 *      reassigns it to driver D999 (location stays DELIVERED, financialStatus
 *      stays WD = delivered, money owed to the office via D999).
 *   2. Records an OrderHistory entry for each reassigned order.
 *   3. Deletes the DriverPayout row.
 *
 * Safety guards (abort BEFORE any write):
 *   - Payout must be PENDING with clearedAt = null (Phase 2 approval never
 *     happened, so no treasury money has moved).
 *   - No TreasuryTransaction may reference the payout.
 *   - No MerchantPayout may have been paid via this payout.
 *
 * Usage:
 *   Dry run (inspect only, no changes):
 *     npx tsx scripts/delete-payout-d0016-002.ts --dry-run
 *   Execute:
 *     npx tsx scripts/delete-payout-d0016-002.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PAYOUT_REFERENCE = "D0016-002";
const NEW_DRIVER_ID = "D999";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  // ── 1. Load the payout ──────────────────────────────────────────────────
  const payout = await prisma.driverPayout.findUnique({
    where: { payoutReference: PAYOUT_REFERENCE },
    include: {
      driver: { select: { id: true, driverId: true, firstName: true, lastName: true } },
      orders: {
        select: {
          id: true,
          orderId: true,
          location: true,
          financialStatus: true,
          amountUsd: true,
          collectedUsd: true,
        },
      },
      paidStatements: { select: { id: true, paymentStatus: true } },
    },
  });

  if (!payout) {
    console.error(`ERROR: Payout ${PAYOUT_REFERENCE} not found.`);
    process.exit(1);
  }

  console.log("── PAYOUT ───────────────────────────────────────────────");
  console.log(
    `id=${payout.id} ref=${payout.payoutReference} seq=${payout.sequentialIndex} status=${payout.status} clearedAt=${payout.clearedAt}`,
  );
  console.log(
    `driver: ${payout.driver.driverId} (${payout.driver.firstName} ${payout.driver.lastName})`,
  );
  console.log(
    `totalUsd=${payout.totalUsd} commissionUsd=${payout.commissionUsd} netUsd=${payout.netUsd} amountPaidUsd=${payout.amountPaidUsd}`,
  );
  console.log(`orders (${payout.orders.length}):`);
  for (const o of payout.orders) {
    console.log(
      `  ${o.orderId}: location=${o.location} financialStatus=${o.financialStatus} amountUsd=${o.amountUsd} collectedUsd=${o.collectedUsd}`,
    );
  }

  // ── 2. Safety guards ────────────────────────────────────────────────────
  if (payout.status !== "PENDING" || payout.clearedAt !== null) {
    console.error(
      `ERROR: Payout status=${payout.status} clearedAt=${payout.clearedAt}. Expected PENDING with clearedAt=null — settlement/approval already happened. Aborting.`,
    );
    process.exit(1);
  }
  if (payout.paidStatements.length > 0) {
    console.error(
      `ERROR: ${payout.paidStatements.length} statement(s) were paid via this payout. Aborting.`,
    );
    process.exit(1);
  }
  const treasuryTx = await prisma.treasuryTransaction.findFirst({
    where: { referenceId: payout.id },
    select: { id: true, reference: true, status: true },
  });
  if (treasuryTx) {
    console.error(
      `ERROR: TreasuryTransaction ${treasuryTx.reference ?? treasuryTx.id} (${treasuryTx.status}) references this payout. Aborting.`,
    );
    process.exit(1);
  }

  // ── 3. Resolve target driver + admin user for history ───────────────────
  const newDriver = await prisma.driverProfile.findFirst({
    where: { driverId: { equals: NEW_DRIVER_ID, mode: "insensitive" } },
  });
  if (!newDriver) {
    console.error(`ERROR: Driver ${NEW_DRIVER_ID} not found.`);
    process.exit(1);
  }
  console.log(
    `\nTarget driver: ${newDriver.firstName} ${newDriver.lastName} (${newDriver.driverId}) id=${newDriver.id}`,
  );

  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
  });
  if (!adminUser) {
    console.error("ERROR: No ADMIN user found to record the history entries.");
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("\n[dry-run] No changes written. Re-run without --dry-run to execute.");
    return;
  }

  // ── 4. Execute in a single transaction ──────────────────────────────────
  await prisma.$transaction(async (tx) => {
    for (const o of payout.orders) {
      await tx.order.update({
        where: { id: o.id },
        data: {
          driverPayoutId: null,
          driverId: newDriver.id,
          history: {
            create: {
              action: `Payout ${PAYOUT_REFERENCE} deleted; reassigned to ${newDriver.driverId}`,
              location: o.location,
              driverId: newDriver.id,
              userId: adminUser.id,
            },
          },
        },
      });
    }

    await tx.driverPayout.delete({ where: { id: payout.id } });
  });

  console.log("\n✓ Transaction committed.");

  // ── 5. AFTER report ─────────────────────────────────────────────────────
  const afterPayout = await prisma.driverPayout.findUnique({ where: { id: payout.id } });
  console.log(`Payout ${PAYOUT_REFERENCE} exists after delete: ${afterPayout !== null}`);

  for (const o of payout.orders) {
    const afterOrder = await prisma.order.findUnique({
      where: { id: o.id },
      include: {
        driver: { select: { driverId: true, firstName: true, lastName: true } },
        history: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    console.log(
      `Order ${afterOrder?.orderId}: location=${afterOrder?.location} financialStatus=${afterOrder?.financialStatus} driver=${afterOrder?.driver?.driverId} driverPayoutId=${afterOrder?.driverPayoutId}`,
    );
    for (const h of afterOrder?.history ?? []) {
      console.log(`  history: ${h.action} @ ${h.createdAt}`);
    }
  }
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
