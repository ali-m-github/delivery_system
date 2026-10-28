/**
 * One-time repair: Libanex-linked orders that the sync pulled to WO/PS because
 * Libanex itself marked them "With Office"/"Paid to Seller" (e.g. the
 * "Stmt-82386" bulk statement on 2026-10-27 for Lily's Corner).
 *
 * WO/PS are financial statements that only a Jett employee may set (see
 * lib/libanexSync.ts → JETT_OWNED_FIN_CODES), so these orders never went
 * through a Jett payout. They are restored to DELIVERED + WD so they reappear
 * in the payout/statement screens.
 *
 * An order is only touched when ALL of these hold — the combination that proves
 * the WO/PS came from Libanex and not from one of our payouts:
 *   - it has a LibanexLink whose raw Libanex fin status is WO or PS;
 *   - it has NO payout link at all (driverPayoutId / merchantPayoutId /
 *     cashPayoutBatchId are all null) — Jett's payout flows always set one.
 *   - its location is DELIVERED (an order Libanex later returned is left alone).
 *
 * Dry run by default. Apply with:  node scripts/fix-libanex-wo-ps-to-wd.js --apply
 *   (or: npx tsx scripts/fix-libanex-wo-ps-to-wd.js --apply)
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");

async function main() {
  const candidates = await prisma.order.findMany({
    where: {
      location: "DELIVERED",
      financialStatus: { in: ["WO", "PS"] },
      driverPayoutId: null,
      merchantPayoutId: null,
      cashPayoutBatchId: null,
      // `is` on a to-one relation implies the link exists AND matches.
      libanexLink: { is: { rawFinStatus: { in: ["WO", "PS"] } } },
    },
    include: {
      libanexLink: { select: { rawLocation: true, rawFinStatus: true } },
      merchant: { select: { merchantName: true, isCashSeller: true } },
    },
    orderBy: { orderId: "asc" },
  });

  console.log(`Mode: ${APPLY ? "APPLYING" : "DRY RUN (add --apply to change the database)"}`);
  console.log(`Found ${candidates.length} Libanex-linked order(s) stuck in WO/PS with no Jett payout:\n`);

  let total = 0;
  for (const o of candidates) {
    total += o.collectedUsd || o.amountUsd || 0;
    console.log(
      `  ${o.orderId.padEnd(14)} ${o.merchant?.merchantName ?? "(no merchant)"}  ` +
        `jett=${o.location}/${o.financialStatus}  lx=${o.libanexLink?.rawLocation}/${o.libanexLink?.rawFinStatus}  ` +
        `collected=$${o.collectedUsd} amount=$${o.amountUsd}  deliveredAt=${
          o.deliveredAt ? o.deliveredAt.toISOString().slice(0, 10) : "null"
        }`,
    );
  }
  console.log(`\nTotal collected value being returned to payout eligibility: $${total}`);

  if (candidates.length === 0) {
    console.log("\nNothing to fix.");
    await prisma.$disconnect();
    return;
  }

  if (!APPLY) {
    console.log("\nDry run only — no changes written. Re-run with --apply to fix.");
    await prisma.$disconnect();
    return;
  }

  const systemUser = await prisma.user.findUnique({ where: { username: "libanex" } });
  if (!systemUser) throw new Error('System user "libanex" not found — cannot write history rows.');

  let fixed = 0;
  for (const o of candidates) {
    // Same transaction semantics as the payout flows: the order row and its
    // audit trail must not diverge.
    await prisma.$transaction([
      prisma.order.update({
        where: { id: o.id },
        data: {
          financialStatus: "WD",
          // Keep the real delivery date; backfill "now" only if it was missing,
          // so the order still appears in the Delivered tab.
          deliveredAt: o.deliveredAt ?? new Date(),
        },
      }),
      prisma.orderHistory.create({
        data: {
          orderId: o.id,
          action: "Reverted Libanex WO/PS back to WD (WO/PS are set by Jett payouts only)",
          location: "DELIVERED",
          driverId: o.driverId,
          userId: systemUser.id,
          meta: {
            source: "LIBANEX_WOPS_ROLLBACK",
            libanexOrderId: o.orderId,
            previousFinancialStatus: o.financialStatus,
            libanexRawFin: o.libanexLink?.rawFinStatus ?? null,
            libanexRawLocation: o.libanexLink?.rawLocation ?? null,
          },
        },
      }),
    ]);
    fixed++;
  }

  console.log(`\nFixed ${fixed} order(s): WO/PS -> WD, location kept DELIVERED.`);
  console.log("The sync will no longer re-apply Libanex WO/PS to these orders.");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Repair failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
