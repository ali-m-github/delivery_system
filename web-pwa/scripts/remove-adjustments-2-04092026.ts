/**
 * Remove both manual adjustments from batch 2-04092026 and restore
 * netPaid to the original payout of 1623.
 *
 * Usage:
 *   npx tsx scripts/remove-adjustments-2-04092026.ts
 *
 * Removes:
 *   - "be2e min 7seb 2-9-2026"  (+1000)
 *   - "Be2e elo min hayda l7seb" (-31)
 *
 * Note: the batch was originally created (netPaid=1623) with the +1000
 * adjustment already baked in. Per user request, removing both lines must
 * bring netPaid back to the original 1623 (the +1000 side cash stands).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BATCH_REFERENCE = "2-04092026";
const DESCRIPTIONS = ["be2e min 7seb 2-9-2026", "Be2e elo min hayda l7seb"];
const TARGET_NET_PAID = 1623;

async function main() {
  const batch = await prisma.cashPayoutBatch.findUnique({
    where: { batchReference: BATCH_REFERENCE },
    include: { adjustments: { select: { id: true, description: true, amountUsd: true } } },
  });

  if (!batch) {
    console.error(`Batch "${BATCH_REFERENCE}" not found.`);
    process.exit(1);
  }

  const toDelete = batch.adjustments.filter((a) => DESCRIPTIONS.includes(a.description));

  await prisma.$transaction(async (tx) => {
    if (toDelete.length > 0) {
      await tx.payoutAdjustment.deleteMany({
        where: { id: { in: toDelete.map((a) => a.id) }, batchId: batch.id },
      });
      console.log("Removed adjustments:");
      for (const a of toDelete) {
        console.log(`  "${a.description}" = ${a.amountUsd} (id=${a.id})`);
      }
    } else {
      console.log("Target adjustments already removed.");
    }

    if (Math.abs(batch.netPaid - TARGET_NET_PAID) > 0.005) {
      await tx.cashPayoutBatch.update({
        where: { id: batch.id },
        data: { netPaid: TARGET_NET_PAID },
      });
    }

    console.log("=".repeat(60));
    console.log(`Batch: ${BATCH_REFERENCE} (id=${batch.id})`);
    console.log(`  grossAdvance:     ${batch.grossAdvance}`);
    console.log(`  deductedReturns:  ${batch.deductedReturns}`);
    console.log(`  OLD netPaid:      ${batch.netPaid}`);
    console.log(`  NEW netPaid:      ${TARGET_NET_PAID}`);
    console.log("=".repeat(60));
    console.log(`✓ netPaid is now $${TARGET_NET_PAID}`);
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
