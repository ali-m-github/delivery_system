/**
 * fix-10007622-exchange.js
 *
 * One-off data fix for merchant Electroni's order 10007622 (an EXCHANGE order,
 * mirroring the healthy 10007834 / 10007834-ExchangeR structure).
 *
 * Root cause: the delivered COD order 10007622 (created 2026-08-07, advanced in
 * cash batch #54 = "2-07082026") was handled through the RETURN flow instead of
 * the EXCHANGE flow. The RTS flow renamed the row to "10007622R" in place, and
 * then in cash batch #74 ("2-26082026") it was deducted as a NORMAL return
 * ($1 = $5 COD - $4 fee) — but an exchange item must deduct $0 (the COD belongs
 * to the delivered main order, which was already advanced). There is no longer
 * a separate "10007622" main order row.
 *
 * Plan A (approved):
 *   1. Reclassify the current row "10007622R" as the exchange proof:
 *        orderId     10007622R  -> 10007622-Exchange
 *        amountUsd   5          -> 0     (exchanges carry no price)
 *        amountLbp   0          -> 0
 *        collectedUsd 5         -> 0     (proof never holds collected cash)
 *        collectedLbp 0         -> 0
 *        location    DELIVERED  -> RETURN
 *        deliveredAt 2026-09-02 -> null
 *        cashPayoutBatchId 54   -> null  (unlink from advance batch #54)
 *        trackToken  20330128   -> null  (moves to the restored main order)
 *        returnDeductionBatchId stays 74 (resolved in batch #74, now at $0)
 *   2. Create a NEW delivered main order "10007622":
 *        DELIVERED / WO, amountUsd=5, collectedUsd=5, cashPayoutBatchId=54,
 *        driverId + customer details copied from the source row, trackToken
 *        20330128 (so the existing public tracking link still resolves).
 *   3. Fix cash batch #74 so the exchange deducts $0 instead of $1:
 *        deductedReturns 43 -> 42, netPaid 809 -> 810
 *        (grossAdvance, profit, adjustments unchanged).
 *
 * Batch #54 stored totals are intentionally NOT changed: its advance list still
 * contains one $5 delivered order (now "10007622" instead of "10007622R").
 *
 * Safety: pre-flight asserts abort BEFORE any write if the DB does not match
 * the expected state. All writes happen in a single $transaction.
 *
 * Run: node scripts/fix-10007622-exchange.js
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const OLD_ID = "10007622R";
const NEW_MAIN_ID = "10007622";
const NEW_EXCH_ID = "10007622-Exchange";
const ADV_BATCH_ID = 54;
const RET_BATCH_ID = 74;

function assert(cond, msg) {
  if (!cond) {
    console.error(`ERROR: ${msg}. Aborting — no writes performed.`);
    process.exit(1);
  }
}
const round2 = (n) => Math.round(n * 100) / 100;

async function main() {
  // ── 1. Pre-flight: load + validate current state (before any write) ─────
  const exch = await prisma.order.findUnique({ where: { orderId: OLD_ID } });
  assert(exch, `order ${OLD_ID} not found`);

  console.log("── BEFORE ───────────────────────────────────────────────");
  console.log(
    `Order ${exch.orderId} (id=${exch.id}): location=${exch.location} fin=${exch.financialStatus} hasExchange=${exch.hasExchange}`,
  );
  console.log(
    `  amountUsd=${exch.amountUsd} amountLbp=${exch.amountLbp} collectedUsd=${exch.collectedUsd} collectedLbp=${exch.collectedLbp}`,
  );
  console.log(
    `  cashPayoutBatchId=${exch.cashPayoutBatchId} returnDeductionBatchId=${exch.returnDeductionBatchId} driverId=${exch.driverId}`,
  );
  console.log(`  trackToken=${exch.trackToken} deliveredAt=${exch.deliveredAt}`);

  // Expected source state (as inspected):
  assert(exch.location === "DELIVERED", `expected location DELIVERED, got ${exch.location}`);
  assert(exch.financialStatus === "RTS", `expected financialStatus RTS, got ${exch.financialStatus}`);
  assert(exch.amountUsd === 5, `expected amountUsd 5, got ${exch.amountUsd}`);
  assert(exch.amountLbp === 0, `expected amountLbp 0, got ${exch.amountLbp}`);
  assert(exch.collectedUsd === 5, `expected collectedUsd 5, got ${exch.collectedUsd}`);
  assert(exch.collectedLbp === 0, `expected collectedLbp 0, got ${exch.collectedLbp}`);
  assert(exch.cashPayoutBatchId === ADV_BATCH_ID, `expected cashPayoutBatchId ${ADV_BATCH_ID}, got ${exch.cashPayoutBatchId}`);
  assert(exch.returnDeductionBatchId === RET_BATCH_ID, `expected returnDeductionBatchId ${RET_BATCH_ID}, got ${exch.returnDeductionBatchId}`);
  assert(exch.driverId, "expected a driver assignment on the source row");

  // Target IDs must be free:
  const mainExists = await prisma.order.findUnique({ where: { orderId: NEW_MAIN_ID } });
  assert(!mainExists, `order ${NEW_MAIN_ID} already exists — aborting to avoid a collision`);
  const exchExists = await prisma.order.findUnique({ where: { orderId: NEW_EXCH_ID } });
  assert(!exchExists, `order ${NEW_EXCH_ID} already exists — aborting to avoid a collision`);

  // Both batches must exist:
  const advBatch = await prisma.cashPayoutBatch.findUnique({ where: { id: ADV_BATCH_ID } });
  assert(advBatch, `cash batch #${ADV_BATCH_ID} not found`);
  const retBatch = await prisma.cashPayoutBatch.findUnique({
    where: { id: RET_BATCH_ID },
    include: {
      resolvedReturns: { select: { orderId: true, amountUsd: true } },
      adjustments: { select: { amountUsd: true } },
    },
  });
  assert(retBatch, `cash batch #${RET_BATCH_ID} not found`);

  console.log(
    `\nAdvance batch #${ADV_BATCH_ID} (${advBatch.batchReference}): grossAdvance=${advBatch.grossAdvance} deductedReturns=${advBatch.deductedReturns} netPaid=${advBatch.netPaid}`,
  );
  console.log(
    `Return batch #${RET_BATCH_ID} (${retBatch.batchReference}): grossAdvance=${retBatch.grossAdvance} deductedReturns=${retBatch.deductedReturns} netPaid=${retBatch.netPaid}`,
  );
  const retHit = retBatch.resolvedReturns.find((o) => o.orderId === OLD_ID);
  assert(retHit, `order ${OLD_ID} is not in batch #${RET_BATCH_ID} resolvedReturns`);
  console.log(`  resolvedReturns contains ${retHit.orderId} amountUsd=${retHit.amountUsd}`);

  // Expected batch #74 ledger (verified against fee = 4: (5-4)+(26-4)+(13-4)+(15-4)+0 = 43):
  assert(retBatch.deductedReturns === 43, `expected batch #${RET_BATCH_ID} deductedReturns 43, got ${retBatch.deductedReturns}`);
  assert(retBatch.netPaid === 809, `expected batch #${RET_BATCH_ID} netPaid 809, got ${retBatch.netPaid}`);
  const NEW_RET_DEDUCTED = retBatch.deductedReturns - 1; // exchange deduction $1 -> $0
  const adjTotal = (retBatch.adjustments ?? []).reduce((s, a) => s + (a.amountUsd ?? 0), 0);
  const NEW_RET_NET = round2(retBatch.grossAdvance - NEW_RET_DEDUCTED + adjTotal);

  // Actor user for history/creator (ADMIN preferred; fallback to source creatorId):
  let actor = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!actor && exch.creatorId) actor = await prisma.user.findUnique({ where: { id: exch.creatorId }, select: { id: true } });
  assert(actor, "no ADMIN user (or source creator) available for history entries");

  console.log(`\nPlan A changes: rename → ${NEW_EXCH_ID}, create main ${NEW_MAIN_ID}, ` +
    `batch #${RET_BATCH_ID} deductedReturns ${retBatch.deductedReturns} → ${NEW_RET_DEDUCTED}, netPaid ${retBatch.netPaid} → ${NEW_RET_NET}`);

  // ── 2. Execute the fix in a single transaction ───────────────────────────
  const H = `Exchange data fix: row ${OLD_ID} was a delivered COD order handled as a normal return; reclassified as exchange proof ${NEW_EXCH_ID} (price $0, deducts $0) and restored main order ${NEW_MAIN_ID} as DELIVERED in advance batch ${advBatch.batchReference} (was #${ADV_BATCH_ID})`;

  const created = await prisma.$transaction(async (tx) => {
    // (a) Reclassify the source row as the exchange proof.
    await tx.order.update({
      where: { id: exch.id },
      data: {
        orderId: NEW_EXCH_ID,
        hasExchange: true,
        amountUsd: 0,
        amountLbp: 0,
        collectedUsd: 0,
        collectedLbp: 0,
        location: "RETURN",
        financialStatus: "RTS",
        deliveredAt: null,
        cashPayoutBatchId: null,
        trackToken: null,
        history: {
          create: {
            action: `${H}. Exchanges carry no price — batch #${RET_BATCH_ID} deduction corrected to $0.`,
            location: "RETURN",
            userId: actor.id,
          },
        },
      },
    });

    // (b) Create the restored delivered main order.
    const main = await tx.order.create({
      data: {
        orderId: NEW_MAIN_ID,
        customerName: exch.customerName,
        customerPhone: exch.customerPhone,
        customerAddress: exch.customerAddress,
        hasExchange: true,
        notes: exch.notes,
        packages: exch.packages,
        extraShipping: exch.extraShipping,
        amountUsd: 5,
        amountLbp: 0,
        collectedUsd: 5,
        collectedLbp: 0,
        location: "DELIVERED",
        financialStatus: "WO",
        zoneId: exch.zoneId,
        merchantId: exch.merchantId,
        driverId: exch.driverId,
        creatorId: exch.creatorId ?? actor.id,
        cashPayoutBatchId: ADV_BATCH_ID,
        cashPayoutExcluded: false,
        trackToken: exch.trackToken ?? null,
        createdAt: exch.createdAt,
        deliveredAt: exch.deliveredAt,
        history: {
          create: {
            action: `${H}.`,
            location: "DELIVERED",
            driverId: exch.driverId,
            userId: actor.id,
          },
        },
      },
    });

    // (c) Fix the return-deduction batch so the exchange deducts $0.
    await tx.cashPayoutBatch.update({
      where: { id: RET_BATCH_ID },
      data: { deductedReturns: NEW_RET_DEDUCTED, netPaid: NEW_RET_NET },
    });

    return main;
  });

  console.log("\n✓ Transaction committed. New main order id:", created.id);

  // ── 3. AFTER report + consistency check ──────────────────────────────────
  const afterExch = await prisma.order.findUnique({ where: { orderId: NEW_EXCH_ID } });
  const afterMain = await prisma.order.findUnique({
    where: { orderId: NEW_MAIN_ID },
    include: { driver: { select: { driverId: true, firstName: true, lastName: true } } },
  });
  const afterRet = await prisma.cashPayoutBatch.findUnique({
    where: { id: RET_BATCH_ID },
    include: { resolvedReturns: { select: { orderId: true, amountUsd: true } } },
  });

  console.log("── AFTER ────────────────────────────────────────────────");
  console.log(
    `Exchange proof ${afterExch?.orderId}: location=${afterExch?.location} fin=${afterExch?.financialStatus} amountUsd=${afterExch?.amountUsd} collectedUsd=${afterExch?.collectedUsd} cashBatch=${afterExch?.cashPayoutBatchId} returnBatch=${afterExch?.returnDeductionBatchId} token=${afterExch?.trackToken}`,
  );
  console.log(
    `Main order ${afterMain?.orderId}: location=${afterMain?.location} fin=${afterMain?.financialStatus} amountUsd=${afterMain?.amountUsd} collectedUsd=${afterMain?.collectedUsd} cashBatch=${afterMain?.cashPayoutBatchId} driver=${afterMain?.driver?.driverId} token=${afterMain?.trackToken} deliveredAt=${afterMain?.deliveredAt}`,
  );
  console.log(
    `Batch #${RET_BATCH_ID} (${retBatch.batchReference}): deductedReturns=${afterRet?.deductedReturns} netPaid=${afterRet?.netPaid}`,
  );
  console.log(`  resolvedReturns now: ${afterRet?.resolvedReturns.map((o) => o.orderId).join(", ")}`);

  assert(
    afterExch?.amountUsd === 0 &&
      afterExch?.collectedUsd === 0 &&
      afterExch?.cashPayoutBatchId === null &&
      afterExch?.location === "RETURN",
    "post-fix: exchange proof is not in the expected state",
  );
  assert(
    afterMain?.location === "DELIVERED" &&
      afterMain?.cashPayoutBatchId === ADV_BATCH_ID &&
      afterMain?.amountUsd === 5,
    "post-fix: main order is not in the expected state",
  );
  assert(
    afterRet?.deductedReturns === NEW_RET_DEDUCTED && afterRet?.netPaid === NEW_RET_NET,
    "post-fix: return batch totals not updated as expected",
  );
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
