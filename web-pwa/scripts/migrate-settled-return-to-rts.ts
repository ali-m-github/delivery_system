/**
 * One-time migration: Update financialStatus from "SETTLED_RETURN" to "RTS"
 *
 * Context: Orders that were deducted in a cash seller payout batch had their
 * financialStatus set to "SETTLED_RETURN", which caused them to disappear from
 * the Returns tab (which only filters for "Re" and "RTS").
 *
 * Run: npx tsx scripts/migrate-settled-return-to-rts.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.order.updateMany({
    where: {
      financialStatus: "SETTLED_RETURN",
    },
    data: {
      financialStatus: "RTS",
    },
  });

  console.log(`Migrated ${result.count} order(s) from SETTLED_RETURN to RTS.`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
