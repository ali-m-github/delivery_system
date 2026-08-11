/**
 * Backdate the "date received" (createdAt) of a specific set of orders
 * from 5/8/2026 (Aug 5) to 3/8/2026 (Aug 3), preserving the original
 * time-of-day of each order.
 *
 * Run: npx tsx scripts/update-order-received-dates.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGET_ORDER_IDS = [
  "0606298",
  "0606299",
  "0606297",
  "0606296",
  "0606295",
  "0606294",
];

// Target date: 3/8/2026 in DD/MM format -> August 3, 2026
const TARGET_DATE = new Date(2026, 7, 3); // Month is 0-indexed: 7 = August

async function main() {
  const orders = await prisma.order.findMany({
    where: { orderId: { in: TARGET_ORDER_IDS } },
    select: { id: true, orderId: true, createdAt: true },
  });

  const byOrderId = new Map(orders.map((o) => [o.orderId, o]));
  const missing = TARGET_ORDER_IDS.filter((id) => !byOrderId.has(id));

  if (missing.length > 0) {
    console.error(`ERROR: Missing orders: ${missing.join(", ")}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(
    `Updating ${orders.length} orders to date received 3/8/2026...\n`,
  );

  for (const orderId of TARGET_ORDER_IDS) {
    const o = byOrderId.get(orderId)!;

    // Preserve the original time-of-day, but set the calendar date to Aug 3, 2026
    const newDate = new Date(
      TARGET_DATE.getFullYear(),
      TARGET_DATE.getMonth(),
      TARGET_DATE.getDate(),
      o.createdAt.getHours(),
      o.createdAt.getMinutes(),
      o.createdAt.getSeconds(),
      o.createdAt.getMilliseconds(),
    );

    const updated = await prisma.order.update({
      where: { id: o.id },
      data: { createdAt: newDate },
      select: { orderId: true, createdAt: true },
    });

    console.log(
      `${updated.orderId} | date received: ${o.createdAt.toISOString()} -> ${updated.createdAt.toISOString()}`,
    );
  }

  console.log("\nDone.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
