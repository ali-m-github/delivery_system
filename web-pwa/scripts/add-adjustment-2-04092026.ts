/**
 * Add a manual adjustment (side payment / deduction) to batch 2-04092026
 * and update its netPaid accordingly.
 *
 * Usage:
 *   npx tsx scripts/add-adjustment-2-04092026.ts
 *
 * Adjustment: "Be2e elo min hayda l7seb" -> -31 USD
 * Formula (per POST /api/admin/merchants/[id]/cash-payouts):
 *   netPaid = grossAdvance - deductedReturns + totalAdjustments
 *
 * Expected before: 759 - 136 + 1000 = 1623
 * Expected after:  759 - 136 + (1000 - 31) = 1592
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BATCH_REFERENCE = "2-04092026";
const DESCRIPTION = "Be2e elo min hayda l7seb";
const ADJUSTMENT_USD = -31;

async function main() {
  const batch = await prisma.cashPayoutBatch.findUnique({
    where: { batchReference: BATCH_REFERENCE },
    include: { adjustments: { select: { id: true, description: true, amountUsd: true } } },
  });

  if (!batch) {
    console.error(`Batch "${BATCH_REFERENCE}" not found.`);
    process.exit(1);
  }

  // Guard: skip if this exact adjustment already exists
  const alreadyExists = batch.adjustments.some(
    (a) => a.description === DESCRIPTION && a.amountUsd === ADJUSTMENT_USD,
  );
  if (alreadyExists) {
    console.log(`Adjustment "${DESCRIPTION}" (${ADJUSTMENT_USD}) already exists on batch ${BATCH_REFERENCE}. Nothing to do.`);
    await prisma.$disconnect();
    process.exit(0);
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;

  await prisma.$transaction(async (tx) => {
    await tx.payoutAdjustment.create({
      data: {
        batchId: batch.id,
        description: DESCRIPTION,
        amountUsd: ADJUSTMENT_USD,
        amountLbp: 0,
      },
    });

    const totalAdjustments = round2(
      [...batch.adjustments, { amountUsd: ADJUSTMENT_USD }].reduce((s, a) => s + (a.amountUsd ?? 0), 0),
    );
    const newNetPaid = round2(batch.grossAdvance - batch.deductedReturns + totalAdjustments);

    await tx.cashPayoutBatch.update({
      where: { id: batch.id },
      data: { netPaid: newNetPaid },
    });

    console.log("=".repeat(60));
    console.log(`Batch: ${BATCH_REFERENCE} (id=${batch.id})`);
    console.log(`Adjustment added: "${DESCRIPTION}" = ${ADJUSTMENT_USD}`);
    console.log(`  grossAdvance:     ${batch.grossAdvance}`);
    console.log(`  deductedReturns:  ${batch.deductedReturns}`);
    console.log(`  totalAdjustments: ${totalAdjustments}`);
    console.log(`  OLD netPaid:      ${batch.netPaid}`);
    console.log(`  NEW netPaid:      ${newNetPaid}`);
    console.log("=".repeat(60));

    if (Math.abs(newNetPaid - 1592) > 0.005) {
      console.warn(`WARNING: new netPaid (${newNetPaid}) != expected 1592`);
    } else {
      console.log("✓ netPaid matches expected total of $1592");
    }
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
