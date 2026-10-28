/**
 * READ-ONLY audit: find Libanex-linked orders whose PWA financial status is
 * WO or PS, and work out whether that change came from Libanex (the 30-minute
 * sync) or from a Jett payout workflow.
 *
 * Evidence used:
 *  - LibanexLink.rawFinStatus  = the last fin code the sync saw on Libanex.
 *  - Payout links (driverPayoutId / merchantPayoutId / cashPayoutBatchId) are
 *    ONLY set by Jett's own payout flows, which are the flows that legitimately
 *    move an order WD -> WO -> PS. An order in WO/PS with no payout link at all
 *    could therefore only have gotten there from the sync.
 *
 * Run: node scripts/audit-libanex-wo-ps.js
 * This script performs no writes.
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function fmt(d) {
  return d instanceof Date ? d.toISOString().slice(0, 16).replace("T", " ") : "";
}

async function main() {
  const rows = await prisma.order.findMany({
    where: {
      financialStatus: { in: ["WO", "PS"] },
      libanexLink: { isNot: null },
    },
    include: {
      libanexLink: {
        select: { libanexOrderId: true, libanexSellerId: true, rawLocation: true, rawFinStatus: true, lastSyncedAt: true },
      },
      merchant: { select: { id: true, merchantName: true, isCashSeller: true } },
      driver: { select: { driverId: true, firstName: true, lastName: true } },
      driverPayout: { select: { id: true, payoutReference: true, status: true } },
      merchantPayout: { select: { id: true, sequentialIndex: true, status: true } },
      cashPayoutBatch: { select: { id: true, batchReference: true } },
    },
    orderBy: { orderId: "asc" },
  });

  const noPayout = [];
  const withPayout = [];

  for (const o of rows) {
    const hasPayout = !!(o.driverPayoutId || o.merchantPayoutId || o.cashPayoutBatchId);
    const rec = {
      orderId: o.orderId,
      lxId: o.libanexLink?.libanexOrderId ?? "",
      seller: o.merchant?.merchantName ?? "(no merchant)",
      lxSellerId: o.libanexLink?.libanexSellerId ?? "",
      location: o.location,
      fin: o.financialStatus,
      lxLoc: o.libanexLink?.rawLocation ?? "",
      lxFin: o.libanexLink?.rawFinStatus ?? "",
      driver: o.driver ? `${o.driver.driverId} ${o.driver.firstName ?? ""} ${o.driver.lastName ?? ""}`.trim() : "(none)",
      amountUsd: o.amountUsd,
      collectedUsd: o.collectedUsd,
      deliveredAt: fmt(o.deliveredAt),
      payouts: [
        o.driverPayout ? `driverPayout=${o.driverPayout.payoutReference ?? o.driverPayout.id}/${o.driverPayout.status}` : "",
        o.merchantPayout ? `merchantPayout=#${o.merchantPayout.sequentialIndex}/${o.merchantPayout.status}` : "",
        o.cashPayoutBatch ? `cashBatch=${o.cashPayoutBatch.batchReference ?? o.cashPayoutBatch.id}` : "",
      ].filter(Boolean).join(", "),
    };
    if (hasPayout) withPayout.push(rec);
    else noPayout.push(rec);
  }

  const print = (list) => {
    if (list.length === 0) {
      console.log("  (none)");
      return;
    }
    console.log(
      [
        "ORDER",
        "LIBANEX_ID",
        "SELLER",
        "LX_LOC",
        "LX_FIN",
        "JETT_LOC",
        "JETT_FIN",
        "DRIVER",
        "AMT$",
        "PAID$",
        "DELIVERED",
        "PAYOUT_LINK",
      ].join(" | "),
    );
    console.log("-".repeat(160));
    for (const r of list) {
      console.log(
        [
          r.orderId,
          r.lxId,
          r.seller,
          r.lxLoc,
          r.lxFin,
          r.location,
          r.fin,
          r.driver,
          r.amountUsd,
          r.collectedUsd,
          r.deliveredAt,
          r.payouts || "(none)",
        ].join(" | "),
      );
    }
  };

  console.log(`\nLibanex-linked orders currently in WO/PS: ${rows.length}\n`);

  console.log("=== A) NO payout link — the WO/PS could only have come from the Libanex sync ===");
  console.log("    (these are the candidates to move back to WD)\n");
  print(noPayout);

  console.log("\n=== B) Has a Jett payout link — moved by a real payout, probably leave alone ===\n");
  print(withPayout);

  // Extra safety: any order where Libanex still reports UD/WD but we hold WO/PS
  // would mean a *Jett-side* change that the sync hasn't overwritten back.
  const drifted = rows.filter(
    (o) => ["UD", "WD"].includes((o.libanexLink?.rawFinStatus ?? "").trim()),
  );
  console.log(`\n=== C) Libanex still says UD/WD while Jett says WO/PS: ${drifted.length} ===`);
  console.log("    (the sync will not pull these back under the current rules)\n");
  print(
    drifted.map((o) => ({
      orderId: o.orderId,
      lxId: o.libanexLink?.libanexOrderId ?? "",
      seller: o.merchant?.merchantName ?? "(no merchant)",
      lxSellerId: o.libanexLink?.libanexSellerId ?? "",
      location: o.location,
      fin: o.financialStatus,
      lxLoc: o.libanexLink?.rawLocation ?? "",
      lxFin: o.libanexLink?.rawFinStatus ?? "",
      driver: o.driver ? `${o.driver.driverId}` : "(none)",
      amountUsd: o.amountUsd,
      collectedUsd: o.collectedUsd,
      deliveredAt: fmt(o.deliveredAt),
      payouts: "",
    })),
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
});
