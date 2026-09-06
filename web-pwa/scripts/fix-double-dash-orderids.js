/**
 * fix-double-dash-orderids.js
 *
 * Corrective follow-up to renumber-merchant-14-to-13.js, which accidentally
 * produced orderIds of the form "13--XXXX" (double dash) instead of
 * "13-XXXX". This script renames any order whose orderId matches
 * /^13--\d+$/ to the proper "13-XXXX" form and fixes the matching audit
 * history action text. Safe to re-run (idempotent): a no-op once fixed.
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const RE = /^13--(\d+)$/;

async function main() {
  const bad = await prisma.order.findMany({
    where: { orderId: { startsWith: "13--" } },
    select: { id: true, orderId: true, creatorId: true },
  });
  if (bad.length === 0) {
    console.log("No double-dash orderIds found — already correct.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const o of bad) {
      const m = o.orderId.match(RE);
      if (!m) {
        console.warn(`  Skipping ${o.orderId} (unexpected shape)`);
        continue;
      }
      const seq = m[1];
      const newOrderId = `13-${seq}`;
      const res = await tx.order.updateMany({
        where: { id: o.id, orderId: o.orderId },
        data: { orderId: newOrderId },
      });
      if (res.count !== 1) {
        throw new Error(`Could not fix ${o.orderId}`);
      }
      // Fix the audit action text ("13--XXXX" -> "13-XXXX").
      await tx.orderHistory.updateMany({
        where: {
          orderId: o.id,
          action: { contains: `-> ${o.orderId} ` },
        },
        data: {
          action: `Renumbered order ID 14-${seq} -> ${newOrderId} (seller renumbered #14 -> #13)`,
        },
      });
      console.log(`  ${o.orderId}  ->  ${newOrderId}`);
    }
  });

  const final = await prisma.order.findMany({
    where: { orderId: { startsWith: "13-" } },
    select: { orderId: true, location: true },
    orderBy: { orderId: "asc" },
  });
  console.log("Final orderIds:", JSON.stringify(final));
}

main()
  .catch((e) => {
    console.error("FIX FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
