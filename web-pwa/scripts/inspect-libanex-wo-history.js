/**
 * READ-ONLY follow-up: for Libanex-linked orders sitting in WO/PS with no
 * payout link, dump their history so we can see WHO moved them (libanex sync
 * vs a Jett user), and summarise raw Libanex codes across all linked orders.
 *
 * Run: node scripts/inspect-libanex-wo-history.js
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  // 1) How the raw Libanex fin codes are distributed across all linked orders.
  const grouped = await prisma.libanexLink.groupBy({
    by: ["rawFinStatus"],
    _count: { _all: true },
  });
  console.log("\n=== Libanex rawFinStatus across all linked orders ===");
  for (const g of grouped) {
    console.log(`  ${String(g.rawFinStatus ?? "(null)").padEnd(8)} ${g._count._all}`);
  }

  const locGrouped = await prisma.libanexLink.groupBy({
    by: ["rawLocation"],
    _count: { _all: true },
  });
  console.log("\n=== Libanex rawLocation across all linked orders ===");
  for (const g of locGrouped) {
    console.log(`  ${String(g.rawLocation ?? "(null)").padEnd(8)} ${g._count._all}`);
  }

  // 2) Linked orders in WO/PS with no payout link at all.
  const suspects = await prisma.order.findMany({
    where: {
      financialStatus: { in: ["WO", "PS"] },
      libanexLink: { isNot: null },
      driverPayoutId: null,
      merchantPayoutId: null,
      cashPayoutBatchId: null,
    },
    include: {
      libanexLink: { select: { rawLocation: true, rawFinStatus: true, lastSyncedAt: true } },
      merchant: { select: { merchantName: true, isCashSeller: true } },
      history: {
        orderBy: { createdAt: "asc" },
        select: {
          action: true,
          location: true,
          createdAt: true,
          userId: true,
          meta: true,
          user: { select: { username: true } },
        },
      },
    },
    orderBy: { orderId: "asc" },
  });

  console.log(`\n=== ${suspects.length} linked WO/PS orders with NO payout link ===\n`);
  for (const o of suspects) {
    console.log(
      `--- ${o.orderId} | ${o.merchant?.merchantName ?? "?"} | jett=${o.location}/${o.financialStatus}` +
        ` | lx=${o.libanexLink?.rawLocation}/${o.libanexLink?.rawFinStatus}` +
        ` | amount=$${o.amountUsd} collected=$${o.collectedUsd} | deliveredAt=${
          o.deliveredAt ? o.deliveredAt.toISOString() : "null"
        } | createdAt=${o.createdAt.toISOString()}`,
    );
    for (const h of o.history) {
      const src = h.meta && h.meta.source ? ` [${h.meta.source}]` : "";
      console.log(`      ${h.createdAt.toISOString()}  ${h.user?.username ?? "?"}  ${h.action}${src}`);
    }
    console.log("");
  }

  // 3) Linked orders where the sync would currently move the PWA location
  //    BACKWARDS past DELIVERED (Libanex shows a non-De code, we show DELIVERED).
  const backwards = await prisma.order.findMany({
    where: {
      location: "DELIVERED",
      libanexLink: { isNot: null },
    },
    select: {
      orderId: true,
      location: true,
      financialStatus: true,
      libanexLink: { select: { rawLocation: true, rawFinStatus: true } },
    },
    orderBy: { orderId: "asc" },
  });
  const backwardsFiltered = backwards.filter(
    (o) => !["De", "Re", "Ba", "Rc"].includes((o.libanexLink.rawLocation ?? "").trim()),
  );
  console.log(`=== Linked orders DELIVERED on Jett but Libanex shows a non-De code: ${backwardsFiltered.length} ===`);
  for (const o of backwardsFiltered.slice(0, 40)) {
    console.log(
      `  ${o.orderId.padEnd(14)} jett=${o.location}/${o.financialStatus}` +
        `  lx=${o.libanexLink.rawLocation}/${o.libanexLink.rawFinStatus}`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
});
