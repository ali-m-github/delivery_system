/**
 * One-time migration: Fix orders that incorrectly have financialStatus = "WD"
 * when they should be "UD".
 *
 * Context: Orders rolled back from a driver payout (via /api/drivers/payouts/items/[orderId])
 * were incorrectly set to financialStatus = "WD" instead of "UD". WD means the order
 * is delivered and cash is with the driver. UD means the order is assigned to a driver
 * but not yet delivered.
 *
 * Fix: Any order with financialStatus = "WD" but location != "DELIVERED" is corrected to "UD".
 *
 * Run: npx tsx scripts/fix-wd-to-ud-for-returned-orders.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Preview: show what will be fixed
  const affected = await prisma.order.findMany({
    where: {
      financialStatus: "WD",
      location: { not: "DELIVERED" },
    },
    select: {
      orderId: true,
      location: true,
      financialStatus: true,
      driverId: true,
      driverPayoutId: true,
    },
  });

  console.log(
    `Found ${affected.length} order(s) with incorrect financialStatus = "WD" (not in DELIVERED location):`,
  );
  for (const o of affected) {
    console.log(
      `  orderId=${o.orderId}, location=${o.location}, driverPayoutId=${o.driverPayoutId ?? "null"}`,
    );
  }

  if (affected.length === 0) {
    console.log("Nothing to fix.");
    await prisma.$disconnect();
    return;
  }

  // Apply the fix
  const result = await prisma.order.updateMany({
    where: {
      financialStatus: "WD",
      location: { not: "DELIVERED" },
    },
    data: {
      financialStatus: "UD",
    },
  });

  console.log(`\nFixed ${result.count} order(s): WD -> UD`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
