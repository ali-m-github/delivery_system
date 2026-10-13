/**
 * Count all orders in the system (total, active vs archived).
 *
 * Run: npx tsx scripts/count-orders.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [total, archived, active] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { isArchived: true } }),
    prisma.order.count({ where: { isArchived: false } }),
  ]);

  console.log("TOTAL ORDERS:", total);
  console.log("  ACTIVE:    ", active);
  console.log("  ARCHIVED:  ", archived);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
