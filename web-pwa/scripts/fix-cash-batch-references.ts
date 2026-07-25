/**
 * Script to update existing CashPayoutBatch records to follow the {merchantId}-{DDMMYYYY} pattern.
 * Example: 8-19072026 (seller ID 8, date 19/07/2026)
 *
 * Usage: npx tsx scripts/fix-cash-batch-references.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function fixCashBatchReferences() {
  console.log("Fetching all CashPayoutBatch records with merchant info...");

  const batches = await prisma.cashPayoutBatch.findMany({
    include: { merchant: { select: { merchantId: true } } },
    orderBy: { createdAt: "asc" },
  });

  // Group by sellerId + date to handle multiple payouts on same day
  const counter: Record<string, number> = {};
  let totalFixed = 0;

  for (const batch of batches) {
    const sellerId = batch.merchant.merchantId;
    const day = String(batch.createdAt.getDate()).padStart(2, "0");
    const month = String(batch.createdAt.getMonth() + 1).padStart(2, "0");
    const year = batch.createdAt.getFullYear();
    const dateKey = `${sellerId}-${day}${month}${year}`;

    counter[dateKey] = (counter[dateKey] || 0) + 1;
    const seq = counter[dateKey];
    const newReference = seq === 1 ? dateKey : `${dateKey}-${seq}`;

    if (batch.batchReference !== newReference) {
      await prisma.cashPayoutBatch.update({
        where: { id: batch.id },
        data: { batchReference: newReference },
      });
      totalFixed++;
      console.log(
        `  Updated batch ${batch.id} → ${newReference} (was: ${batch.batchReference})`,
      );
    }
  }

  console.log(`\nDone. Total batches updated: ${totalFixed}`);
  await prisma.$disconnect();
}

fixCashBatchReferences().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect();
  process.exit(1);
});
