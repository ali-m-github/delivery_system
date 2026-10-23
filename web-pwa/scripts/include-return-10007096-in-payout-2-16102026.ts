/**
 * One-off repair: add pending return deduction for order "10007096R"
 * (Electroni, amountUsd=14) to cash payout batch "2-16102026"
 * (CashPayoutBatch id=129).
 *
 * The order was returned to seller (RETURN / RTS) but never deducted from any
 * payout (returnDeductionBatchId = null). Its advance was paid earlier in
 * batch #109 — linking it here is exactly what the app's return-deduction
 * flow (POST /api/admin/merchants/[id]/cash-payouts) would do:
 *   fee             = merchant.defaultSellerRate + merchant.defaultProfitRate (= 4)
 *   deduction       = amountUsd - fee = 14 - 4 = 10
 *   deductedReturns = existing + 10
 *   netPaid         = grossAdvance - deductedReturns + SUM(adjustments)
 *   grossAdvance / profit are NOT touched.
 *
 * Usage:
 *   npx tsx scripts/include-return-10007096-in-payout-2-16102026.ts [--dry-run]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BATCH_REFERENCE = "2-16102026";
const ORDER_ID = "10007096R";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`ERROR: ${msg}. Aborting — no writes performed.`);
    process.exit(1);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const dryRun = process.argv.includes("--dry-run");

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
      adjustments: { select: { amountUsd: true } },
    },
  });
  assert(batch, `CashPayoutBatch "${BATCH_REFERENCE}" not found`);

  const order = await prisma.order.findUnique({
    where: { orderId: ORDER_ID },
    select: {
      id: true,
      orderId: true,
      merchantId: true,
      amountUsd: true,
      isArchived: true,
      returnDeductionBatchId: true,
      location: true,
      financialStatus: true,
    },
  });
  assert(order, `order "${ORDER_ID}" not found`);
  assert(
    order.merchantId === batch.merchantId,
    `order "${order.orderId}" belongs to a different merchant than the batch`,
  );
  assert(!order.isArchived, `order "${order.orderId}" is archived`);
  assert(
    order.returnDeductionBatchId === null,
    `order "${order.orderId}" is already deducted in batch #${order.returnDeductionBatchId} — refusing to double-deduct`,
  );
  assert(
    !order.orderId.includes("-Exchange"),
    `order "${order.orderId}" is an exchange proof — it should settle at $0, not via this script`,
  );

  const fee =
    (batch.merchant.defaultSellerRate ?? 4.0) +
    (batch.merchant.defaultProfitRate ?? 0);
  const deduction = (order.amountUsd ?? 0) - fee;

  const newDeductedReturns = round2(batch.deductedReturns + deduction);
  const totalAdjustments = round2(
    batch.adjustments.reduce((s, a) => s + (a.amountUsd ?? 0), 0),
  );
  const newNetPaid = round2(
    batch.grossAdvance - newDeductedReturns + totalAdjustments,
  );

  console.log("=".repeat(70));
  console.log(
    `Batch id=${batch.id} (${batch.batchReference}) — ${batch.merchant.merchantName}`,
  );
  console.log(
    `Order ${order.orderId}: loc=${order.location} fin=${order.financialStatus} amountUsd=${order.amountUsd} -> deduction=${deduction.toFixed(2)} (fee=${fee})`,
  );
  console.log(
    `  OLD: deductedReturns=${batch.deductedReturns} netPaid=${batch.netPaid}`,
  );
  console.log(
    `  NEW: deductedReturns=${newDeductedReturns.toFixed(2)} netPaid=${newNetPaid.toFixed(2)}`,
  );
  console.log("=".repeat(70));

  if (dryRun) {
    console.log("\n[dry-run] No changes written.");
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { returnDeductionBatchId: batch.id },
    });
    await tx.cashPayoutBatch.update({
      where: { id: batch.id },
      data: { deductedReturns: newDeductedReturns, netPaid: newNetPaid },
    });
  });

  console.log(
    `\nDone. ${order.orderId} linked to batch ${BATCH_REFERENCE} (id=${batch.id}) as a return deduction.`,
  );
  console.log(
    `  deductedReturns: ${batch.deductedReturns} -> ${newDeductedReturns.toFixed(2)}`,
  );
  console.log(
    `  netPaid:         ${batch.netPaid} -> ${newNetPaid.toFixed(2)}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  prisma.$disconnect();
  process.exit(1);
});
