/**
 * fix-76594311-78852369.ts
 *
 * One-off data fix for orders 76594311 (price 19 → 24) and 78852369
 * (price 10 → 15). Both orders are already in:
 *   - DriverPayout D1-004 (SETTLED, treasury IN transaction posted)
 *   - Merchant statement #3 (UNPAID, no treasury records)
 *
 * Changes (one $transaction):
 *   1. Order 76594311: amountUsd 19 → 24, collectedUsd 19 → 24
 *   2. Order 78852369: amountUsd 10 → 15, collectedUsd 10 → 15
 *   3. DriverPayout D1-004: totalUsd 557 → 567, totalCollected 557 → 567,
 *      netUsd 482 → 492, amountPaidUsd 482 → 492
 *      (commissionUsd 75 unchanged — commission is a per-order RATE, not a
 *       function of price; remainingUsd stays 0)
 *   4. TreasuryTransaction for the payout settlement: 482 → 492
 *   5. TreasuryBox (Main Cashbox) balance: +10
 *   6. Merchant statement #3: totalUsd 63.5 → 73.5, netUsd 51.5 → 61.5
 *      (shippingUsd 12 unchanged — shipping is per-order driver fees;
 *       profitUsd stays 0 — merchant has no profit rate)
 *
 * Pre-flight validation aborts BEFORE any write if the DB state does not
 * match expectations. All writes happen in a single $transaction.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORDER_IDS = ["76594311", "78852369"] as const;
const PAYOUT_ID = "cmsbtrcp4000ulqagvlflynn2"; // D1-004
const STATEMENT_ID = "7e26246c-7981-4b4c-8397-48274e684dbf"; // statement #3
const TREASURY_TX_ID = "cmspupwsb00n9ln2dg4i1y61a";
const BOX_ID = "cmrgrfmuw00043wbchevfd1q5";

const round2 = (n: number) => Math.round(n * 100) / 100;

function assert(cond: any, msg?: string): asserts cond {
  if (!cond) {
    console.error(`ERROR: ${msg}. Aborting — no writes performed.`);
    process.exit(1);
  }
}

async function main() {
  // ── 1. Load + validate current state (before any write) ─────────────────
  const orders = await prisma.order.findMany({
    where: { orderId: { in: [...ORDER_IDS] } },
    select: {
      id: true,
      orderId: true,
      amountUsd: true,
      amountLbp: true,
      collectedUsd: true,
      collectedLbp: true,
      financialStatus: true,
      location: true,
      driverId: true,
      driverPayoutId: true,
      merchantPayoutId: true,
      cashPayoutBatchId: true,
    },
  });
  assert(orders.length === 2, `expected 2 target orders, found ${orders.length}`);

  for (const o of orders) {
    assert(o.amountUsd === o.collectedUsd, `${o.orderId}: amountUsd ≠ collectedUsd`);
    assert(o.amountLbp === 0 && o.collectedLbp === 0, `${o.orderId}: LBP amounts must be 0`);
    assert(o.financialStatus === "PS", `${o.orderId}: financialStatus must be PS, got ${o.financialStatus}`);
    assert(o.driverPayoutId === PAYOUT_ID, `${o.orderId}: not in payout D1-004`);
    assert(o.merchantPayoutId === STATEMENT_ID, `${o.orderId}: not in statement #3`);
    assert(o.cashPayoutBatchId === null, `${o.orderId}: has cashPayoutBatchId — not expected`);
  }

  const byOrderId = new Map(orders.map((o) => [o.orderId, o]));
  const o1 = byOrderId.get("76594311")!;
  const o2 = byOrderId.get("78852369")!;
  assert(o1.amountUsd === 19, `76594311: expected amountUsd 19, got ${o1.amountUsd}`);
  assert(o2.amountUsd === 10, `78852369: expected amountUsd 10, got ${o2.amountUsd}`);

  const payout = await prisma.driverPayout.findUnique({
    where: { id: PAYOUT_ID },
    include: {
      orders: { select: { id: true, orderId: true, amountUsd: true, collectedUsd: true } },
    },
  });
  assert(payout !== null, "payout D1-004 not found");
  assert(payout.status === "SETTLED", `payout status must be SETTLED, got ${payout.status}`);
  assert(payout.totalUsd === 557, `payout totalUsd must be 557, got ${payout.totalUsd}`);
  assert(payout.commissionUsd === 75, `payout commissionUsd must be 75, got ${payout.commissionUsd}`);
  assert(payout.netUsd === 482, `payout netUsd must be 482, got ${payout.netUsd}`);
  assert(payout.totalCollected === 557, `payout totalCollected must be 557, got ${payout.totalCollected}`);
  assert(payout.amountPaidUsd === 482, `payout amountPaidUsd must be 482, got ${payout.amountPaidUsd}`);
  assert(payout.remainingUsd === 0, `payout remainingUsd must be 0, got ${payout.remainingUsd}`);
  assert(payout.statementsDeductedUsd === 0, "payout must have no statements deducted");
  assert(payout.treasuryBoxId === BOX_ID, `payout treasuryBoxId must be ${BOX_ID}`);
  assert(
    payout.orders.every((o) => o.amountUsd === o.collectedUsd || o.collectedUsd === 0),
    "payout orders have unexpected collectedUsd pattern",
  );

  // Sanity: current totals must equal the sum of member orders.
  const sumAmount = round2(payout.orders.reduce((s, o) => s + (o.amountUsd ?? 0), 0));
  assert(sumAmount === payout.totalUsd, `payout totalUsd ${payout.totalUsd} ≠ sum of orders ${sumAmount}`);
  // The app treats collectedUsd = 0 as "unset" and falls back to amountUsd
  // (see settlements enrich + driver-payouts creation), so totalCollected is
  // Σ (collectedUsd > 0 ? collectedUsd : amountUsd), not the raw collectedUsd sum.
  const sumCollected = round2(
    payout.orders.reduce((s, o) => s + ((o.collectedUsd ?? 0) > 0 ? (o.collectedUsd ?? 0) : (o.amountUsd ?? 0)), 0),
  );
  assert(sumCollected === payout.totalCollected, `payout totalCollected ${payout.totalCollected} ≠ sum of orders (collected-or-amount) ${sumCollected}`);

  const treasuryTx = await prisma.treasuryTransaction.findUnique({ where: { id: TREASURY_TX_ID } });
  assert(treasuryTx !== null, "treasury transaction for payout not found");
  assert(treasuryTx.referenceId === PAYOUT_ID, "treasury transaction is not for this payout");
  assert(treasuryTx.type === "IN", `treasury transaction type must be IN, got ${treasuryTx.type}`);
  assert(treasuryTx.status === "APPROVED", `treasury transaction must be APPROVED, got ${treasuryTx.status}`);
  assert(treasuryTx.amountUsd === 482, `treasury transaction amountUsd must be 482, got ${treasuryTx.amountUsd}`);
  assert(treasuryTx.boxId === BOX_ID, "treasury transaction is on the wrong box");

  const box = await prisma.treasuryBox.findUnique({ where: { id: BOX_ID } });
  assert(box !== null, "treasury box not found");
  assert(box.balanceLbp === 0, "box balanceLbp must be 0");

  const statement = await prisma.merchantPayout.findUnique({
    where: { id: STATEMENT_ID },
    include: { orders: { select: { id: true, orderId: true, amountUsd: true } } },
  });
  assert(statement !== null, "statement #3 not found");
  assert(statement.totalUsd === 63.5, `statement totalUsd must be 63.5, got ${statement.totalUsd}`);
  assert(statement.shippingUsd === 12, `statement shippingUsd must be 12, got ${statement.shippingUsd}`);
  assert(statement.netUsd === 51.5, `statement netUsd must be 51.5, got ${statement.netUsd}`);
  assert(statement.profitUsd === 0, `statement profitUsd must be 0, got ${statement.profitUsd}`);
  assert(statement.paymentStatus === "UNPAID", `statement must be UNPAID, got ${statement.paymentStatus}`);
  assert(statement.amountPaidUsd === 0, "statement must be unpaid");
  assert(statement.treasuryBoxId === null, "statement has no treasury box (expected)");
  assert(statement.treasuryTransactionId === null, "statement has no treasury transaction (expected)");
  const sumStmt = round2(statement.orders.reduce((s, o) => s + (o.amountUsd ?? 0), 0));
  assert(sumStmt === statement.totalUsd, `statement totalUsd ${statement.totalUsd} ≠ sum of orders ${sumStmt}`);

  const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  assert(adminUser !== null, "no ADMIN user found for history entries");

  // ── 2. New values ────────────────────────────────────────────────────────
  const NEW_ORDER = { "76594311": 24, "78852369": 15 };
  const DELTA = 10; // 5 + 5

  console.log("── BEFORE ───────────────────────────────────────────────");
  for (const o of orders) {
    console.log(
      `Order ${o.orderId}: amountUsd=${o.amountUsd} collectedUsd=${o.collectedUsd} status=${o.financialStatus}`,
    );
  }
  console.log(
    `Payout D1-004: totalUsd=${payout.totalUsd} commissionUsd=${payout.commissionUsd} netUsd=${payout.netUsd} totalCollected=${payout.totalCollected} amountPaidUsd=${payout.amountPaidUsd} remainingUsd=${payout.remainingUsd}`,
  );
  console.log(`TreasuryTx ${treasuryTx.id}: IN amountUsd=${treasuryTx.amountUsd} status=${treasuryTx.status}`);
  console.log(`Box "${box.name}": balanceUsd=${box.balanceUsd}`);
  console.log(
    `Statement #3: totalUsd=${statement.totalUsd} shippingUsd=${statement.shippingUsd} netUsd=${statement.netUsd} profitUsd=${statement.profitUsd} paymentStatus=${statement.paymentStatus}`,
  );

  console.log("── PLAN ─────────────────────────────────────────────────");
  console.log(`Order 76594311: 19 → ${NEW_ORDER["76594311"]} (amount + collected)`);
  console.log(`Order 78852369: 10 → ${NEW_ORDER["78852369"]} (amount + collected)`);
  console.log(`Payout D1-004: totalUsd/totalCollected 557 → 567; netUsd/amountPaidUsd 482 → 492`);
  console.log(`TreasuryTx: 482 → 492; Box balance ${box.balanceUsd} → ${round2(box.balanceUsd + DELTA)}`);
  console.log(`Statement #3: totalUsd 63.5 → 73.5; netUsd 51.5 → 61.5`);

  // ── 3. Execute the fix in a single transaction ───────────────────────────
  await prisma.$transaction(async (tx) => {
    for (const o of orders) {
      const newAmt = NEW_ORDER[o.orderId as keyof typeof NEW_ORDER];
      await tx.order.update({
        where: { id: o.id },
        data: {
          amountUsd: newAmt,
          collectedUsd: newAmt,
          history: {
            create: {
              action: `Data fix: price & collected ${o.amountUsd} → ${newAmt} (order ${o.orderId}); payout D1-004 and statement totals adjusted accordingly`,
              location: o.location,
              driverId: o.driverId,
              userId: adminUser.id,
            },
          },
        },
      });
    }

    await tx.driverPayout.update({
      where: { id: PAYOUT_ID },
      data: {
        totalUsd: round2(557 + DELTA), // 567
        totalCollected: round2(557 + DELTA), // 567
        netUsd: round2(482 + DELTA), // 492 (commission 75 unchanged)
        amountPaidUsd: round2(482 + DELTA), // 492 (exact payment, remaining stays 0)
      },
    });

    await tx.treasuryTransaction.update({
      where: { id: TREASURY_TX_ID },
      data: { amountUsd: round2(482 + DELTA) }, // 492
    });

    await tx.treasuryBox.update({
      where: { id: BOX_ID },
      data: { balanceUsd: { increment: DELTA } },
    });

    await tx.merchantPayout.update({
      where: { id: STATEMENT_ID },
      data: {
        totalUsd: round2(63.5 + DELTA), // 73.5
        netUsd: round2(51.5 + DELTA), // 61.5 (shipping 12 unchanged)
      },
    });
  });

  console.log("\n✓ Transaction committed.");

  // ── 4. AFTER report ──────────────────────────────────────────────────────
  const afterOrders = await prisma.order.findMany({
    where: { orderId: { in: [...ORDER_IDS] } },
    select: { orderId: true, amountUsd: true, collectedUsd: true, financialStatus: true },
  });
  const afterPayout = await prisma.driverPayout.findUnique({
    where: { id: PAYOUT_ID },
    include: {
      orders: { select: { orderId: true, amountUsd: true, collectedUsd: true } },
    },
  });
  const afterTx = await prisma.treasuryTransaction.findUnique({ where: { id: TREASURY_TX_ID } });
  const afterBox = await prisma.treasuryBox.findUnique({ where: { id: BOX_ID } });
  const afterStmt = await prisma.merchantPayout.findUnique({
    where: { id: STATEMENT_ID },
    include: { orders: { select: { orderId: true, amountUsd: true } } },
  });

  console.log("── AFTER ────────────────────────────────────────────────");
  for (const o of afterOrders) {
    console.log(`Order ${o.orderId}: amountUsd=${o.amountUsd} collectedUsd=${o.collectedUsd} status=${o.financialStatus}`);
  }
  console.log(
    `Payout D1-004: totalUsd=${afterPayout?.totalUsd} commissionUsd=${afterPayout?.commissionUsd} netUsd=${afterPayout?.netUsd} totalCollected=${afterPayout?.totalCollected} amountPaidUsd=${afterPayout?.amountPaidUsd} remainingUsd=${afterPayout?.remainingUsd}`,
  );
  console.log(`TreasuryTx: IN amountUsd=${afterTx?.amountUsd} status=${afterTx?.status}`);
  console.log(`Box "${afterBox?.name}": balanceUsd=${afterBox?.balanceUsd}`);
  console.log(
    `Statement #3: totalUsd=${afterStmt?.totalUsd} shippingUsd=${afterStmt?.shippingUsd} netUsd=${afterStmt?.netUsd} profitUsd=${afterStmt?.profitUsd} paymentStatus=${afterStmt?.paymentStatus}`,
  );

  // Consistency checks on final state
  const afterSumPayout = round2((afterPayout?.orders ?? []).reduce((s, o) => s + (o.amountUsd ?? 0), 0));
  console.log(`  check: payout sum of orders = ${afterSumPayout} vs totalUsd ${afterPayout?.totalUsd}`);
  const afterSumStmt = round2((afterStmt?.orders ?? []).reduce((s, o) => s + (o.amountUsd ?? 0), 0));
  console.log(`  check: statement sum of orders = ${afterSumStmt} vs totalUsd ${afterStmt?.totalUsd}`);
  assert(afterSumPayout === afterPayout?.totalUsd, "post-fix payout totals inconsistent");
  assert(afterSumStmt === afterStmt?.totalUsd, "post-fix statement totals inconsistent");
  assert(afterPayout?.netUsd === round2((afterPayout?.totalUsd ?? 0) - (afterPayout?.commissionUsd ?? 0)), "post-fix payout net inconsistent");
  assert(afterStmt?.netUsd === round2((afterStmt?.totalUsd ?? 0) - (afterStmt?.shippingUsd ?? 0)), "post-fix statement net inconsistent");
  console.log("\n✓ All post-fix consistency checks passed.");
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
