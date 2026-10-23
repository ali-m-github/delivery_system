/**
 * Add a manual adjustment to batch 2-14102026 (CashPayoutBatch id=128)
 * and update its netPaid accordingly.
 *
 * The merchant reported 14 orders in his sheet instead of 12, so he deducted
 * $8 too much in delivery charges ($4 x 2 extra orders). This adjustment
 * brings the batch total to match his sheet ($189).
 *
 * Usage:
 *   npx tsx scripts/add-adjustment-2-14102026.ts
 *
 * Formula (per POST /api/admin/merchants/[id]/cash-payouts):
 *   netPaid = grossAdvance - deductedReturns + totalAdjustments
 *
 * Expected before: 393 - 190 + (-6) = 197
 * Expected after:  393 - 190 + (-6 - 8) = 189
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BATCH_REFERENCE = "2-14102026";
const DESCRIPTION = "7atet talabeyten zyede bel sheet 14 bas henne 12 order fa khasem $8 zyede";
const ADJUSTMENT_USD = -8;

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

    if (Math.abs(newNetPaid - 189) > 0.005) {
      console.warn(`WARNING: new netPaid (${newNetPaid}) != expected 189`);
    } else {
      console.log("✓ netPaid matches expected total of $189 (matches the merchant sheet)");
    }
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
