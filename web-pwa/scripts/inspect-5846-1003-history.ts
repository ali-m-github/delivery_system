/**
 * Inspect the history of order 5846-1003 (id cmunt5bu600mmrbhdotfvrcgc).
 *
 * Run: npx tsx scripts/inspect-5846-1003-history.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const order = await prisma.order.findUnique({
    where: { id: "cmunt5bu600mmrbhdotfvrcgc" },
    select: {
      id: true,
      orderId: true,
      location: true,
      financialStatus: true,
      updatedAt: true,
      history: {
        orderBy: { createdAt: "asc" },
        select: {
          action: true,
          location: true,
          createdAt: true,
          userId: true,
        },
      },
    },
  });
  console.log(JSON.stringify(order, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Inspect failed:", err);
  process.exit(1);
});
