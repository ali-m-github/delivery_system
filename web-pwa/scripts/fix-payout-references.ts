/**
 * Script to fix existing DriverPayout records to follow the D001-001 pattern.
 * Each payout ID starts with the driver's driverId (e.g. D001) followed by
 * a 3-digit sequential index (001, 002, 003, etc).
 *
 * Usage: npx tsx scripts/fix-payout-references.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function fixPayoutReferences() {
  console.log("Fetching all drivers with payouts...");

  const drivers = await prisma.driverProfile.findMany({
    include: {
      payouts: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  let totalFixed = 0;

  for (const driver of drivers) {
    const driverIdLabel = driver.driverId; // e.g. "D001"
    const payouts = driver.payouts;

    if (payouts.length === 0) continue;

    console.log(
      `\nProcessing driver ${driverIdLabel} (${payouts.length} payouts)...`,
    );

    // Sort by createdAt to ensure proper chronological ordering
    // (sequentialIndex may be unreliable for existing records)
    const sorted = [...payouts].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    for (let i = 0; i < sorted.length; i++) {
      const payout = sorted[i];
      const seq = i + 1;
      const reference = `${driverIdLabel}-${String(seq).padStart(3, "0")}`;

      if (payout.payoutReference !== reference) {
        await prisma.driverPayout.update({
          where: { id: payout.id },
          data: {
            payoutReference: reference,
            sequentialIndex: seq,
          },
        });
        totalFixed++;
        console.log(
          `  Updated payout ${payout.id.slice(0, 8)}... → ${reference} (status: ${payout.status})`,
        );
      }
    }
  }

  console.log(`\nDone. Total payouts updated: ${totalFixed}`);
  await prisma.$disconnect();
}

fixPayoutReferences().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect();
  process.exit(1);
});
