/**
 * fix-10007447-payout.ts
 *
 * One-off data fix for order 10007447:
 *   1. Remove the order from its DriverPayout (D0114-003).
 *   2. Recalculate the payout totals from the remaining orders, using the
 *      same 2-tier commission logic the app uses for payout totals
 *      (app/api/driver-payouts/route.ts + app/api/drivers/payouts/items/[orderId]/route.ts):
 *        Tier 1: seller exception (DriverSellerRate ∪ DriverCashSellerRate by the
 *                driver's userId; cash-seller entries override)
 *        Tier 2: DriverZoneRate by zoneId
 *        Fallback: $0
 *   3. Reassign the order to driver D999 (location stays DELIVERED,
 *      financialStatus WO → WD = delivered, owed to office via D999).
 *
 * The payout is PENDING_APPROVAL with clearedAt = null, i.e. Phase 2 approval
 * has NOT happened and no TreasuryTransaction exists yet, so it is safe to
 * modify amountPaidUsd. The payout was settled as an EXACT payment
 * (amountPaidUsd == netUsd, no statements deducted), so the paid amount is
 * brought down to the new net — otherwise approval would post $20 to the
 * treasury that actually belongs to D999 now.
 *
 * Pre-flight validation aborts BEFORE any write if the DB state does not
 * match expectations. All writes happen in a single $transaction.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGET_ORDER_ID = "10007447";
const NEW_DRIVER_ID = "D999";

const round2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  // ── 1. Load current state ──────────────────────────────────────────────
  const order = await prisma.order.findUnique({
    where: { orderId: TARGET_ORDER_ID },
    include: {
      driver: { select: { id: true, driverId: true, firstName: true, lastName: true } },
    },
  });

  if (!order) {
    console.error(`ERROR: Order ${TARGET_ORDER_ID} not found.`);
    process.exit(1);
  }

  console.log("── BEFORE ───────────────────────────────────────────────");
  console.log(
    `Order ${order.orderId}: location=${order.location} financialStatus=${order.financialStatus}`,
  );
  console.log(
    `  driver: ${order.driver?.driverId} (${order.driver?.firstName} ${order.driver?.lastName}) id=${order.driverId}`,
  );
  console.log(
    `  amountUsd=${order.amountUsd} collectedUsd=${order.collectedUsd} | amountLbp=${order.amountLbp} collectedLbp=${order.collectedLbp}`,
  );
  console.log(`  zoneId=${order.zoneId} merchantId=${order.merchantId}`);
  console.log(
    `  driverPayoutId=${order.driverPayoutId} cashPayoutBatchId=${order.cashPayoutBatchId} merchantPayoutId=${order.merchantPayoutId}`,
  );

  if (!order.driverPayoutId) {
    console.error("ERROR: Order is not linked to a driver payout — nothing to remove from.");
    process.exit(1);
  }
  if (order.location !== "DELIVERED") {
    console.error(`ERROR: Order location is ${order.location}, expected DELIVERED. Aborting.`);
    process.exit(1);
  }
  if (order.financialStatus !== "WO") {
    console.error(
      `ERROR: Order financialStatus is ${order.financialStatus}, expected WO. Aborting.`,
    );
    process.exit(1);
  }

  const payoutId = order.driverPayoutId;
  const oldDriverProfileId = order.driverId;
  if (!oldDriverProfileId) {
    console.error("ERROR: Order has no driver assigned. Aborting.");
    process.exit(1);
  }

  const payout = await prisma.driverPayout.findUnique({
    where: { id: payoutId },
    include: { orders: true },
  });
  if (!payout) {
    console.error(`ERROR: Payout ${payoutId} not found.`);
    process.exit(1);
  }

  console.log(
    `\nPayout ${payout.payoutReference ?? payout.id} (seq ${payout.sequentialIndex}): status=${payout.status} clearedAt=${payout.clearedAt}`,
  );
  console.log(
    `  totalUsd=${payout.totalUsd} totalLbp=${payout.totalLbp} commissionUsd=${payout.commissionUsd} netUsd=${payout.netUsd} totalCollected=${payout.totalCollected}`,
  );
  console.log(
    `  amountPaidUsd=${payout.amountPaidUsd} amountPaidLbp=${payout.amountPaidLbp} remainingUsd=${payout.remainingUsd} remainingLbp=${payout.remainingLbp}`,
  );
  console.log(
    `  statementsDeductedUsd=${payout.statementsDeductedUsd} statementsDeductedLbp=${payout.statementsDeductedLbp} treasuryBoxId=${payout.treasuryBoxId}`,
  );
  console.log(`  orders (${payout.orders.length}):`);
  for (const o of payout.orders) {
    console.log(
      `    ${o.orderId}: amountUsd=${o.amountUsd} collectedUsd=${o.collectedUsd} merchantId=${o.merchantId} zoneId=${o.zoneId} status=${o.financialStatus}`,
    );
  }

  if (!payout.orders.some((o) => o.id === order.id)) {
    console.error("ERROR: Target order is not a member of this payout. Aborting.");
    process.exit(1);
  }

  // Guard: payout must be awaiting approval (Phase 2 not yet executed).
  if (payout.status !== "PENDING_APPROVAL") {
    console.error(
      `ERROR: Payout status is ${payout.status}, expected PENDING_APPROVAL. Aborting — do not modify an approved/settled payout.`,
    );
    process.exit(1);
  }

  // Guard: this payout must have been settled as an exact payment with no
  // statements deducted, so amountPaidUsd can be safely re-based onto netUsd.
  const statementsDeductedUsd = payout.statementsDeductedUsd ?? 0;
  const statementsDeductedLbp = payout.statementsDeductedLbp ?? 0;
  const wasExactPayment =
    round2(payout.amountPaidUsd ?? 0) === round2(payout.netUsd) &&
    statementsDeductedUsd === 0 &&
    statementsDeductedLbp === 0;
  if (!wasExactPayment) {
    console.error(
      `ERROR: Payout was not settled as an exact payment (amountPaidUsd=${payout.amountPaidUsd} vs netUsd=${payout.netUsd}, statementsDeductedUsd=${statementsDeductedUsd}). Manual review required. Aborting.`,
    );
    process.exit(1);
  }

  // ── 2. Find target driver D999 + admin user for history ────────────────
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
    console.error("ERROR: No ADMIN user found to record the history entry.");
    process.exit(1);
  }

  // ── 3. Commission rates for the ORIGINAL driver ─────────────────────────
  const oldDriverProfile = await prisma.driverProfile.findUnique({
    where: { id: oldDriverProfileId },
  });
  const userId = oldDriverProfile?.userId;

  const [zoneRates, sellerRates, cashSellerRates] = await Promise.all([
    prisma.driverZoneRate.findMany({ where: { driverId: oldDriverProfileId } }),
    prisma.driverSellerRate.findMany({ where: { driverId: oldDriverProfileId } }),
    userId
      ? prisma.driverCashSellerRate.findMany({ where: { driverId: userId } })
      : Promise.resolve([]),
  ]);

  console.log(
    `\n${oldDriverProfile?.driverId ?? "?"} rates (profileId=${oldDriverProfileId}, userId=${userId ?? "null"}):`,
  );
  console.log(
    `  zoneRates:       ${JSON.stringify(zoneRates.map((z) => ({ zone: z.zoneId, rate: z.rate })))}`,
  );
  console.log(
    `  sellerRates:     ${JSON.stringify(sellerRates.map((s) => ({ merchant: s.merchantId, rateUsd: s.rateUsd })))}`,
  );
  console.log(
    `  cashSellerRates: ${JSON.stringify(cashSellerRates.map((c) => ({ merchant: c.merchantId, rateUsd: c.rateUsd })))}`,
  );

  const zoneRateMap = new Map(zoneRates.map((z) => [z.zoneId, z.rate]));
  const sellerExceptionMap = new Map<string, number>();
  for (const sr of sellerRates) sellerExceptionMap.set(sr.merchantId, sr.rateUsd);
  // A $0 seller exception is still a valid override. Cash-seller entries
  // are applied second so they win, matching app/api/driver-payouts/route.ts.
  for (const cr of cashSellerRates) sellerExceptionMap.set(cr.merchantId, cr.rateUsd);

  const commissionFor = (o: { merchantId?: string | null; zoneId: string }) => {
    const mid = String(o.merchantId ?? "");
    const exception = mid ? sellerExceptionMap.get(mid) : undefined;
    if (exception !== undefined) return { rate: exception, tier: "seller-exception" };
    const zr = zoneRateMap.get(o.zoneId);
    if (zr !== undefined) return { rate: zr, tier: "zone" };
    return { rate: 0, tier: "fallback-0" };
  };

  // ── 4. Recalculate over the remaining orders (target removed) ───────────
  const remaining = payout.orders.filter((o) => o.id !== order.id);

  let newTotalUsd = 0;
  let newTotalLbp = 0;
  let newCommissionUsd = 0;
  for (const o of remaining) {
    newTotalUsd += o.amountUsd ?? 0;
    newTotalLbp += o.amountLbp ?? 0;
    const c = commissionFor(o);
    newCommissionUsd += c.rate;
    console.log(`  remaining ${o.orderId}: amountUsd=${o.amountUsd} → commission ${c.rate} (${c.tier})`);
  }
  const removedComm = commissionFor(order);
  console.log(`  removed   ${order.orderId}: amountUsd=${order.amountUsd} → commission ${removedComm.rate} (${removedComm.tier})`);

  newTotalUsd = round2(newTotalUsd);
  newTotalLbp = round2(newTotalLbp);
  newCommissionUsd = round2(newCommissionUsd);
  const newNetUsd = round2(newTotalUsd - newCommissionUsd);

  // Exact payment: bring amountPaid down to the new net (LBP keeps the same
  // "paid everything collected in LBP" property it had before).
  const newAmountPaidUsd = round2(newNetUsd);
  const newAmountPaidLbp = round2(
    newTotalLbp - ((payout.totalLbp ?? 0) - (payout.amountPaidLbp ?? 0)),
  );
  const newRemainingUsd = round2(newNetUsd - newAmountPaidUsd - statementsDeductedUsd);
  const newRemainingLbp = round2(newTotalLbp - newAmountPaidLbp);

  console.log(`\n  RECALC: totalUsd ${payout.totalUsd} → ${newTotalUsd}`);
  console.log(`  RECALC: commissionUsd ${payout.commissionUsd} → ${newCommissionUsd}`);
  console.log(`  RECALC: netUsd ${payout.netUsd} → ${newNetUsd}`);
  console.log(`  RECALC: totalCollected ${payout.totalCollected} → ${newTotalUsd}`);
  console.log(`  RECALC: amountPaidUsd ${payout.amountPaidUsd} → ${newAmountPaidUsd}`);
  console.log(`  RECALC: remainingUsd ${payout.remainingUsd} → ${newRemainingUsd}`);

  // ── 5. Execute the fix in a single transaction ──────────────────────────
  await prisma.$transaction(async (tx) => {
    // (a) Detach order from the payout, reassign to D999, WO → WD
    //     (WD = delivered, money owed to office via the new driver).
    await tx.order.update({
      where: { id: order.id },
      data: {
        driverPayoutId: null,
        driverId: newDriver.id,
        financialStatus: "WD",
        history: {
          create: {
            action: `Removed from payout ${payout.payoutReference ?? payout.id}; reassigned to ${newDriver.driverId}`,
            location: "DELIVERED",
            driverId: newDriver.id,
            userId: adminUser.id,
          },
        },
      },
    });

    // (b) Recalculate the payout from its remaining orders.
    await tx.driverPayout.update({
      where: { id: payoutId },
      data: {
        totalUsd: newTotalUsd,
        totalLbp: newTotalLbp,
        commissionUsd: newCommissionUsd,
        netUsd: newNetUsd,
        totalCollected: newTotalUsd,
        amountPaidUsd: newAmountPaidUsd,
        amountPaidLbp: newAmountPaidLbp,
        remainingUsd: newRemainingUsd,
        remainingLbp: newRemainingLbp,
      },
    });
  });

  console.log("\n✓ Transaction committed.");

  // ── 6. AFTER report ──────────────────────────────────────────────────────
  const afterOrder = await prisma.order.findUnique({
    where: { id: order.id },
    include: {
      driver: { select: { driverId: true, firstName: true, lastName: true } },
      history: { orderBy: { createdAt: "desc" }, take: 3 },
    },
  });
  const afterPayout = await prisma.driverPayout.findUnique({
    where: { id: payoutId },
    include: { orders: { select: { orderId: true, amountUsd: true, financialStatus: true } } },
  });
  const afterOldDriver = await prisma.driverProfile.findUnique({
    where: { id: oldDriverProfileId },
    select: { driverId: true, carriedDebtUsd: true, carriedDebtLbp: true },
  });

  console.log("── AFTER ────────────────────────────────────────────────");
  console.log(
    `Order ${afterOrder?.orderId}: location=${afterOrder?.location} financialStatus=${afterOrder?.financialStatus} driver=${afterOrder?.driver?.driverId} driverPayoutId=${afterOrder?.driverPayoutId}`,
  );
  for (const h of afterOrder?.history ?? []) {
    console.log(`  history: ${h.action} @ ${h.createdAt}`);
  }
  console.log(
    `Payout ${afterPayout?.payoutReference}: status=${afterPayout?.status} totalUsd=${afterPayout?.totalUsd} commissionUsd=${afterPayout?.commissionUsd} netUsd=${afterPayout?.netUsd} amountPaidUsd=${afterPayout?.amountPaidUsd} remainingUsd=${afterPayout?.remainingUsd}`,
  );
  console.log(
    `  orders left: ${JSON.stringify(afterPayout?.orders ?? [])}`,
  );
  console.log(
    `${afterOldDriver?.driverId} carriedDebt: usd=${afterOldDriver?.carriedDebtUsd} lbp=${afterOldDriver?.carriedDebtLbp} (unchanged — settlement was exact, no debt was carried)`,
  );
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
