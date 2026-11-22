/**
 * return-settled-order-to-warehouse.ts
 *
 * Reusable repair: move an order that was MISTAKENLY delivered back to the
 * WAREHOUSE even though it is already included in a driver payout that is
 * SETTLED (approved + posted to the treasury). The in-app Return action only
 * allows PENDING payouts (see lib/commission.ts MUTABLE_PAYOUT_STATUSES), so
 * this script performs the same reversal PLUS the money corrections a SETTLED
 * payout needs:
 *
 *   1. Order: WAREHOUSE / UD, detached from the driver payout, delivery and
 *      collection fields cleared, driver unassigned — identical to what
 *      app/api/admin/orders/return/route.ts does for a legal return.
 *   2. Payout: totals recomputed from the REMAINING orders through the
 *      authoritative commission module (loadDriverRateTable +
 *      recalcPayoutTotals in lib/commission.ts) — the same figures payout
 *      creation and approval wrote. amountPaid is re-based onto the new net
 *      (valid only because the payout was an exact payment, verified below).
 *   3. Treasury: the payout's APPROVED IN transaction already credited the
 *      cashbox with the OLD net. A compensating APPROVED OUT transaction is
 *      posted on the SAME box for the over-collected amount (order gross −
 *      its commission), atomically decrementing the box balance in the same
 *      transaction, so the ledger and the cashbox stay consistent.
 *      => Physically hand that cash back to the driver.
 *
 * The driver's carriedDebt is deliberately NOT modified: the money is being
 * refunded now, not carried forward.
 *
 * SAFETY
 *   - Pre-flight validation aborts BEFORE any write when anything differs
 *     from expectations (order not DELIVERED/WO, payout not SETTLED, payout
 *     not an exact payment, statements deducted, debt carried in, payout
 *     would become empty, treasury transaction not APPROVED, …).
 *   - Prints a full BEFORE → AFTER plan; applying requires typing YES.
 *   - All writes happen in ONE $transaction with compare-and-swap guards, so
 *     a concurrent change rolls everything back instead of corrupting state.
 *
 * USAGE
 *   npx tsx scripts/return-settled-order-to-warehouse.ts <orderId>
 *   npx tsx scripts/return-settled-order-to-warehouse.ts              # asks for it
 *   npx tsx scripts/return-settled-order-to-warehouse.ts <orderId> --dry-run
 */
import { PrismaClient, type Order, type DriverPayout } from "@prisma/client";
import * as readline from "readline/promises";
import { stdin, exit } from "process";
import {
  loadDriverRateTable,
  recalcPayoutTotals,
  computeOrderCommission,
  grossUsd,
  grossLbp,
} from "@/lib/commission";
import { nextTreasuryReference } from "@/lib/sequences";
import { orderIdForFinancialStatus } from "@/lib/order-id";

const prisma = new PrismaClient();

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Abort helper. Explicitly typed so TypeScript narrows past the call site. */
const fail: (msg: string) => never = (msg) => {
  console.error(`\nABORT: ${msg}`);
  exit(1);
};

type OrderWithRel = Order & {
  driver: { id: string; driverId: string; firstName: string; lastName: string } | null;
};

type PayoutWithRel = DriverPayout & {
  orders: (Order & {
    zone: { name: string } | null;
    merchant: { merchantName: string } | null;
  })[];
  driver: { driverId: string; firstName: string; lastName: string };
};

const ORDER_INCLUDE = {
  driver: { select: { id: true, driverId: true, firstName: true, lastName: true } },
} as const;

const PAYOUT_INCLUDE = {
  orders: {
    include: {
      zone: { select: { name: true } },
      merchant: { select: { merchantName: true } },
    },
  },
  driver: { select: { driverId: true, firstName: true, lastName: true } },
} as const;

async function main() {
  const args = process.argv.slice(2).filter(Boolean);
  const dryRun = args.includes("--dry-run");
  let orderIdArg = args.find((a) => !a.startsWith("--")) ?? "";

  if (!orderIdArg) {
    const rl = readline.createInterface({ input: stdin, output: process.stdout });
    orderIdArg = (
      await rl.question("Order ID to return to the warehouse (e.g. 2-0206): ")
    ).trim();
    rl.close();
    if (!orderIdArg) fail("No order ID provided.");
  }

  // ── 1. Resolve the order ─────────────────────────────────────────────────
  let found: OrderWithRel | null = await prisma.order.findUnique({
    where: { orderId: orderIdArg },
    include: ORDER_INCLUDE,
  });
  if (!found) {
    const candidates = await prisma.order.findMany({
      where: { orderId: { contains: orderIdArg } },
      select: { orderId: true, location: true, financialStatus: true },
      take: 20,
    });
    if (candidates.length === 1) {
      console.log(`No exact match; using the single partial match: ${candidates[0].orderId}`);
      found = await prisma.order.findUniqueOrThrow({
        where: { orderId: candidates[0].orderId },
        include: ORDER_INCLUDE,
      });
    } else {
      fail(
        `Order "${orderIdArg}" not found.` +
          (candidates.length
            ? ` Partial matches: ${candidates
                .map((c) => `${c.orderId} (${c.location}/${c.financialStatus})`)
                .join(", ")}`
            : ""),
      );
    }
  }
  const order: OrderWithRel = found;

  console.log("\n── ORDER ────────────────────────────────────────────────");
  console.log(`  ${order.orderId}: location=${order.location} financialStatus=${order.financialStatus}`);
  console.log(
    `  driver: ${order.driver?.driverId ?? "none"} (${order.driver?.firstName ?? ""} ${order.driver?.lastName ?? ""})`,
  );
  console.log(
    `  amountUsd=${order.amountUsd} collectedUsd=${order.collectedUsd} | amountLbp=${order.amountLbp} collectedLbp=${order.collectedLbp}`,
  );
  console.log(
    `  driverPayoutId=${order.driverPayoutId} merchantPayoutId=${order.merchantPayoutId} cashPayoutBatchId=${order.cashPayoutBatchId}`,
  );

  if (order.location !== "DELIVERED") {
    fail(`Order location is ${order.location}, expected DELIVERED.`);
  }
  if (order.financialStatus !== "WO") {
    fail(
      `Order financialStatus is ${order.financialStatus}, expected WO (a settled payout holds WO orders). ` +
        `If it is WD, its payout is not approved yet — use the in-app Return action instead.`,
    );
  }
  if (!order.driverPayoutId) {
    fail("Order is not linked to a driver payout — use the normal in-app Return action instead.");
  }
  if (order.merchantPayoutId) {
    console.log("  NOTE: order is ALSO linked to a merchant payout — verify merchant finances afterwards.");
  }
  if (order.cashPayoutBatchId) {
    console.log("  NOTE: order is in a cash payout batch — verify cash seller finances afterwards.");
  }

  // ── 2. The payout ────────────────────────────────────────────────────────
  const payoutFound = await prisma.driverPayout.findUnique({
    where: { id: order.driverPayoutId },
    include: PAYOUT_INCLUDE,
  });
  if (!payoutFound) fail("Linked driver payout not found (dangling link). Manual review required.");
  const payout: PayoutWithRel = payoutFound;
  const payoutLabel = payout.payoutReference ?? payout.id;

  if (payout.status !== "SETTLED") {
    fail(
      `Payout ${payoutLabel} status is ${payout.status}, expected SETTLED. ` +
        (payout.status === "PENDING"
          ? "PENDING payouts must be returned through the normal in-app Return action."
          : "This script only handles SETTLED payouts; this one needs manual review."),
    );
  }
  if (!payout.orders.some((o) => o.id === order.id)) {
    fail("Order is not a member of this payout (inconsistent link). Manual review required.");
  }

  // Exact-payment guard: amountPaid == net, no statement deductions, no debt
  // carried into the payout. Otherwise re-basing amountPaid is unsafe.
  const isExactPayment =
    round2(payout.amountPaidUsd) === round2(payout.netUsd) &&
    payout.statementsDeductedUsd === 0 &&
    payout.statementsDeductedLbp === 0 &&
    payout.previousDebtUsd === 0 &&
    payout.previousDebtLbp === 0;
  if (!isExactPayment) {
    fail(
      `Payout ${payoutLabel} was NOT settled as an exact payment ` +
        `(amountPaidUsd=${payout.amountPaidUsd} vs netUsd=${payout.netUsd}, ` +
        `statementsDeductedUsd=${payout.statementsDeductedUsd}, previousDebtUsd=${payout.previousDebtUsd}). ` +
        `Manual review required — do not run this script on it.`,
    );
  }

  console.log(`\n── PAYOUT ${payoutLabel} (status=${payout.status}) ──`);
  console.log(`  driver: ${payout.driver.firstName} ${payout.driver.lastName} (${payout.driver.driverId})`);
  console.log(
    `  totalUsd=${payout.totalUsd} commissionUsd=${payout.commissionUsd} netUsd=${payout.netUsd} amountPaidUsd=${payout.amountPaidUsd}`,
  );
  console.log(`  totalLbp=${payout.totalLbp} amountPaidLbp=${payout.amountPaidLbp}`);
  console.log(`  orders: ${payout.orders.length}`);

  // ── 3. Recompute the payout totals from the REMAINING orders ─────────────
  const remaining = payout.orders.filter((o) => o.id !== order.id);
  if (remaining.length === 0) {
    fail(
      `Payout ${payoutLabel} would become EMPTY after removal. A SETTLED payout with a posted treasury ` +
        `entry cannot be deleted automatically — manual review required.`,
    );
  }
  const rateTable = await loadDriverRateTable(prisma, payout.driverId);
  const newTotals = recalcPayoutTotals(rateTable, remaining);

  // This order's own contribution (for the plan printout and the LBP delta).
  const comm = computeOrderCommission(rateTable, order);
  if (!comm.ok) {
    console.log(
      "  NOTE: no commission rate is configured for this order's seller/zone; treating its commission as $0.",
    );
  }
  const orderCommUsd = comm.ok ? comm.usd : 0;
  const orderCommLbp = comm.ok ? comm.lbp : 0;
  const deltaUsd = round2(grossUsd(order) - orderCommUsd); // refund owed to the driver
  const deltaLbp = round2(grossLbp(order) - orderCommLbp);

  // ── 4. Treasury reconciliation plan ─────────────────────────────────────
  const treasuryTx = await prisma.treasuryTransaction.findFirst({
    where: { referenceId: payout.id, type: "IN" },
    select: { id: true, boxId: true, amountUsd: true, amountLbp: true, status: true, reference: true },
  });
  if (treasuryTx && treasuryTx.status !== "APPROVED") {
    fail(
      `Linked treasury transaction ${treasuryTx.reference ?? treasuryTx.id} is ` +
        `${treasuryTx.status}, not APPROVED. Manual review required.`,
    );
  }
  const box = treasuryTx
    ? await prisma.treasuryBox.findUnique({
        where: { id: treasuryTx.boxId },
        select: { id: true, name: true, balanceUsd: true, balanceLbp: true },
      })
    : null;
  if (treasuryTx && !box) fail("Treasury transaction references a cashbox that no longer exists.");

  const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!adminUser) fail("No ADMIN user found to record the history entry.");

  // ── 5. Print the full plan ───────────────────────────────────────────────
  console.log("\n── PLAN ─────────────────────────────────────────────────");
  console.log(`Order ${order.orderId}:`);
  console.log(`  location         ${order.location} -> WAREHOUSE`);
  console.log(`  financialStatus  ${order.financialStatus} -> UD`);
  console.log(`  driverPayoutId   ${order.driverPayoutId} -> null (detached)`);
  console.log(`  driverId         ${order.driverId ?? "null"} -> null (unassigned)`);
  console.log(`  deliveredAt      ${order.deliveredAt ?? "null"} -> null`);
  console.log(`  collectedUsd     ${order.collectedUsd} -> 0    collectedLbp ${order.collectedLbp} -> 0`);
  console.log(`Payout ${payoutLabel} (stays SETTLED, totals corrected):`);
  console.log(`  totalUsd         ${payout.totalUsd} -> ${newTotals.totalUsd}`);
  console.log(`  commissionUsd    ${payout.commissionUsd} -> ${newTotals.commissionUsd}`);
  console.log(`  netUsd           ${payout.netUsd} -> ${newTotals.netUsd}`);
  console.log(`  totalCollected   ${payout.totalCollected} -> ${newTotals.totalCollected}`);
  console.log(`  totalLbp         ${payout.totalLbp} -> ${newTotals.totalLbp}`);
  console.log(
    `  amountPaidUsd    ${payout.amountPaidUsd} -> ${newTotals.netUsd} (re-based; payout was an exact payment)`,
  );
  console.log(
    `  amountPaidLbp    ${payout.amountPaidLbp} -> ${round2(payout.amountPaidLbp - deltaLbp)}`,
  );
  console.log(
    `  (this order contributed gross $${round2(grossUsd(order))} / commission $${orderCommUsd})`,
  );
  console.log("Treasury:");
  if (treasuryTx && box && (deltaUsd !== 0 || deltaLbp !== 0)) {
    console.log(
      `  posted IN  ${treasuryTx.reference ?? treasuryTx.id} ($${treasuryTx.amountUsd}) stays untouched as history.`,
    );
    console.log(
      `  NEW compensating OUT on box "${box.name}" (current balance $${box.balanceUsd}):`,
    );
    console.log(
      `    $${deltaUsd}${deltaLbp ? ` / ${deltaLbp} LBP` : ""} — deducted from the box in the same transaction.`,
    );
    console.log(
      `  ACTION: physically refund $${deltaUsd}${deltaLbp ? ` + ${deltaLbp} LBP` : ""} to the driver ` +
        `${payout.driver.driverId} (he handed it in for an order that was never delivered).`,
    );
  } else if (deltaUsd === 0 && deltaLbp === 0) {
    console.log("  no treasury adjustment needed (this order contributed $0 net).");
  } else {
    console.log(
      "  WARNING: no APPROVED IN treasury transaction found for this payout — no compensating OUT will be\n" +
        "           posted. Verify the treasury manually.",
    );
  }
  console.log("Driver carriedDebt: NOT modified.");

  if (dryRun) {
    console.log("\n--dry-run: nothing was written.");
    return;
  }

  // ── 6. Confirm ───────────────────────────────────────────────────────────
  const rl = readline.createInterface({ input: stdin, output: process.stdout });
  const answer = await rl.question("\nType YES to apply everything above: ");
  rl.close();
  if (answer.trim() !== "YES") {
    console.log("Cancelled — nothing was written.");
    return;
  }

  // ── 7. Apply (ONE transaction, CAS everywhere) ───────────────────────────
  const newAmountPaidLbp = round2(payout.amountPaidLbp - deltaLbp);
  await prisma.$transaction(async (tx) => {
    // Order: CAS on the exact pre-read state.
    const updOrder = await tx.order.updateMany({
      where: {
        id: order.id,
        location: order.location,
        financialStatus: order.financialStatus,
        driverPayoutId: order.driverPayoutId,
      },
      data: {
        orderId: orderIdForFinancialStatus(order.orderId, "UD"),
        location: "WAREHOUSE",
        financialStatus: "UD",
        driverPayoutId: null,
        deliveredAt: null,
        collectedUsd: 0,
        collectedLbp: 0,
        driverId: null,
      },
    });
    if (updOrder.count !== 1) throw new Error("Order changed concurrently; nothing was saved. Re-run.");

    // Payout: CAS on status SETTLED so a concurrent edit loses the race.
    const updPayout = await tx.driverPayout.updateMany({
      where: { id: payout.id, status: "SETTLED" },
      data: {
        totalUsd: newTotals.totalUsd,
        totalLbp: newTotals.totalLbp,
        commissionUsd: newTotals.commissionUsd,
        netUsd: newTotals.netUsd,
        totalCollected: newTotals.totalCollected,
        amountPaidUsd: newTotals.netUsd,
        amountPaidLbp: newAmountPaidLbp,
        remainingUsd: 0,
        remainingLbp: 0,
      },
    });
    if (updPayout.count !== 1) {
      throw new Error("Payout status changed concurrently; nothing was saved. Re-run.");
    }

    // Treasury: compensating OUT + atomic balance decrement (ledger + money commit together).
    if (treasuryTx && box && (deltaUsd !== 0 || deltaLbp !== 0)) {
      await tx.treasuryTransaction.create({
        data: {
          boxId: treasuryTx.boxId,
          type: "OUT",
          amountUsd: deltaUsd,
          amountLbp: deltaLbp,
          description:
            `Correction: order ${order.orderId} returned to the warehouse after the settlement of ` +
            `${payoutLabel} (mistakenly delivered). Refund of cash over-collected from driver ` +
            `${payout.driver.driverId}.`,
          reference: await nextTreasuryReference(tx),
          referenceId: payout.id,
          userId: adminUser!.id,
          status: "APPROVED",
        },
      });
      await tx.treasuryBox.update({
        where: { id: treasuryTx.boxId },
        data: { balanceUsd: { decrement: deltaUsd }, balanceLbp: { decrement: deltaLbp } },
      });
    }

    // Order history, matching the wording of the in-app return flow.
    await tx.orderHistory.create({
      data: {
        orderId: order.id,
        action:
          `Returned delivered order (${order.financialStatus}) to WAREHOUSE/UD — unlinked from ` +
          `SETTLED driver payout ${payoutLabel} (totals recalculated, treasury corrected) [repair script]`,
        location: "WAREHOUSE",
        driverId: order.driverId,
        userId: adminUser!.id,
      },
    });
  });

  console.log("\nDONE. Order returned to the warehouse, payout recalculated, treasury balanced.");
  if (treasuryTx && box && (deltaUsd !== 0 || deltaLbp !== 0)) {
    console.log(
      `Remember: physically refund $${deltaUsd}${deltaLbp ? ` + ${deltaLbp} LBP` : ""} to driver ` +
        `${payout.driver.driverId}.`,
    );
  }
}

main()
  .catch((e) => {
    console.error("FAILED (nothing was saved):", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
