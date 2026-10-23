/**
 * One-off repair: add pending return deductions to cash payout batch
 * "2-14102026" (Electroni, CashPayoutBatch id=128).
 *
 * The owner asked to include 12 returned orders plus one exchange proof order
 * in the batch. All rows already exist renamed with the "R" suffix (returned
 * to seller via the UI) but were NEVER deducted from any payout
 * (returnDeductionBatchId = null), so they must be settled against this batch.
 *
 * Mirrors POST /api/admin/merchants/[id]/cash-payouts (return-deduction part):
 *   fee             = merchant.defaultSellerRate + merchant.defaultProfitRate
 *   deduction       = (amountUsd - fee)  per return order
 *   "-Exchange" rows deduct $0 (exchange proofs carry no price and the delivery
 *                     fee was already earned delivering the exchange item —
 *                     no fee is re-charged on the proof).
 *   deductedReturns = existing + SUM(deductions)
 *   netPaid         = grossAdvance - deductedReturns + SUM(adjustments)
 *   grossAdvance / profit are NOT touched (no new advance orders added).
 *
 * Usage:
 *   npx tsx scripts/include-returns-in-payout-2-14102026.ts [--dry-run]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BATCH_REFERENCE = "2-14102026";

// Order IDs as the owner listed them (base IDs, no "R"; the rows exist under
// the "…R" RTS-renamed form — each is resolved by trying the exact ID first,
// then ID + "R").
const REQUESTED_ORDER_IDS = [
  "5219-3130",
  "5219-3116",
  "5219-3167",
  "10007977",
  "5219-3176",
  "10007986",
  "10007995",
  "5219-3202",
  "5219-3210",
  "5219-3247",
  "10007938",
  "5219-3285",
  // Exchange proof: settles at $0 (no COD value, no delivery-fee deduction).
  "5219-3172-Exchange",
];

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`ERROR: ${msg}. Aborting — no writes performed.`);
    process.exit(1);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// House convention: "-Exchange" (or the RTS-renamed "-ExchangeR") proof rows.
const isExchangeProof = (orderId: string) => orderId.includes("-Exchange");

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // ── 1. Load the batch ─────────────────────────────────────────────────────
  const batch = await prisma.cashPayoutBatch.findUnique({
    where: { batchReference: BATCH_REFERENCE },
    include: {
      merchant: {
        select: {
          id: true,
          merchantId: true,
          merchantName: true,
          defaultSellerRate: true,
          defaultProfitRate: true,
        },
      },
      adjustments: { select: { id: true, description: true, amountUsd: true } },
    },
  });

  assert(batch, `CashPayoutBatch "${BATCH_REFERENCE}" not found`);

  const fee =
    (batch.merchant.defaultSellerRate ?? 4.0) +
    (batch.merchant.defaultProfitRate ?? 0);

  console.log("=".repeat(70));
  console.log(`Batch id=${batch.id} (${batch.batchReference})`);
  console.log(
    `Merchant: ${batch.merchant.merchantName} (merchantId ${batch.merchant.merchantId})`,
  );
  console.log(
    `Current: grossAdvance=${batch.grossAdvance} deductedReturns=${batch.deductedReturns} netPaid=${batch.netPaid}`,
  );
  console.log(`Fee per return: ${fee}`);
  console.log("=".repeat(70));

  // ── 2. Resolve + validate every requested order BEFORE any write ─────────
  const resolved: {
    id: string;
    orderId: string;
    amountUsd: number;
    exchange: boolean;
    deduction: number;
  }[] = [];

  for (const requested of REQUESTED_ORDER_IDS) {
    let order = await prisma.order.findUnique({
      where: { orderId: requested },
      select: {
        id: true,
        orderId: true,
        merchantId: true,
        amountUsd: true,
        isArchived: true,
        returnDeductionBatchId: true,
        cashPayoutBatchId: true,
        location: true,
        financialStatus: true,
      },
    });
    if (!order) {
      // The RTS flow renames rows to "<id>R" — try that form.
      order = await prisma.order.findUnique({
        where: { orderId: `${requested}R` },
        select: {
          id: true,
          orderId: true,
          merchantId: true,
          amountUsd: true,
          isArchived: true,
          returnDeductionBatchId: true,
          cashPayoutBatchId: true,
          location: true,
          financialStatus: true,
        },
      });
    }
    assert(order, `order "${requested}" (or "${requested}R") not found`);
    assert(
      order.merchantId === batch.merchantId,
      `order "${order.orderId}" belongs to a different merchant than the batch`,
    );
    assert(!order.isArchived, `order "${order.orderId}" is archived`);
    assert(
      order.returnDeductionBatchId === null,
      `order "${order.orderId}" is already deducted in batch #${order.returnDeductionBatchId} — refusing to double-deduct`,
    );

    const exchange = isExchangeProof(order.orderId);
    // "-Exchange" proof rows carry no price and must NOT be charged the fee
    // (the exchange item's delivery was already paid) — they settle at $0.
    if (exchange) {
      assert(
        order.amountUsd === 0,
        `exchange proof "${order.orderId}" unexpectedly holds amountUsd=${order.amountUsd}`,
      );
    }
    const deduction = exchange ? 0 : (order.amountUsd ?? 0) - fee;

    resolved.push({
      id: order.id,
      orderId: order.orderId,
      amountUsd: order.amountUsd ?? 0,
      exchange,
      deduction,
    });

    console.log(
      `  ${order.orderId}: loc=${order.location} fin=${order.financialStatus} amountUsd=${order.amountUsd} -> deduction=${deduction.toFixed(2)}`,
    );
  }

  // ── 3. New totals ─────────────────────────────────────────────────────────
  const addedDeductions = round2(resolved.reduce((s, o) => s + o.deduction, 0));
  const newDeductedReturns = round2(batch.deductedReturns + addedDeductions);
  const totalAdjustments = round2(
    batch.adjustments.reduce((s, a) => s + (a.amountUsd ?? 0), 0),
  );
  const newNetPaid = round2(
    batch.grossAdvance - newDeductedReturns + totalAdjustments,
  );

  console.log("=".repeat(70));
  console.log(`Added deductions: ${addedDeductions.toFixed(2)}`);
  console.log(`  OLD: deductedReturns=${batch.deductedReturns} netPaid=${batch.netPaid}`);
  console.log(
    `  NEW: deductedReturns=${newDeductedReturns.toFixed(2)} netPaid=${newNetPaid.toFixed(2)}`,
  );
  console.log("=".repeat(70));

  if (dryRun) {
    console.log("\n[dry-run] No changes written.");
    await prisma.$disconnect();
    return;
  }

  // ── 4. Apply everything in one atomic transaction ─────────────────────────
  await prisma.$transaction(async (tx) => {
    for (const o of resolved) {
      await tx.order.update({
        where: { id: o.id },
        data: { returnDeductionBatchId: batch.id },
      });
    }
    await tx.cashPayoutBatch.update({
      where: { id: batch.id },
      data: { deductedReturns: newDeductedReturns, netPaid: newNetPaid },
    });
  });

  console.log(
    `\nDone. ${resolved.length} orders linked to batch ${BATCH_REFERENCE} (id=${batch.id}) as return deductions.`,
  );
  console.log(
    `  deductedReturns: ${batch.deductedReturns} -> ${newDeductedReturns.toFixed(2)}`,
  );
  console.log(`  netPaid:         ${batch.netPaid} -> ${newNetPaid.toFixed(2)}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  prisma.$disconnect();
  process.exit(1);
});
