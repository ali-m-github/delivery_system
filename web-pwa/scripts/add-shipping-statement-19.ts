/**
 * Add the missing shipping to statement #19 (MerchantPayout.sequentialIndex = 19).
 *
 * Statement #19 (KidsGram, created 2026-10-29) was created with shippingUsd = 0.
 * Per the owner's instruction, charge a $3 shipping rate for EVERY order in the
 * statement and recalculate the net:
 *
 *   shippingUsd = orderCount * 3
 *   netUsd      = totalUsd - shippingUsd
 *
 * LBP is untouched (this statement has totalLbp = 0 and no LBP rates apply).
 *
 * Guards (the script refuses to run if any fail):
 *  - Exactly one statement with sequentialIndex = 19.
 *  - The statement must not have been paid or be pending approval, and must
 *    have no linked treasury transaction or driver settlement (otherwise the
 *    already-posted money would drift from the ledger).
 *  - Idempotent: skips if shippingUsd already equals orderCount * 3.
 *
 * Usage:
 *   npx tsx scripts/add-shipping-statement-19.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEQUENTIAL_INDEX = 19;
const SHIPPING_PER_ORDER_USD = 3;

const round2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const statements = await prisma.merchantPayout.findMany({
    where: { sequentialIndex: SEQUENTIAL_INDEX },
    include: {
      merchant: { select: { id: true, merchantName: true } },
      orders: { select: { id: true, orderId: true } },
    },
  });

  if (statements.length !== 1) {
    console.error(
      `Expected exactly one statement with sequentialIndex=${SEQUENTIAL_INDEX}, found ${statements.length}. Aborting.`,
    );
    process.exit(1);
  }

  const stmt = statements[0];

  // ── Safety guards: the statement must be financially untouched ──────────
  if (
    stmt.paymentStatus === "PAID" ||
    stmt.paymentStatus === "PENDING_APPROVAL" ||
    stmt.treasuryTransactionId ||
    stmt.paidByDriverPayoutId ||
    (stmt.amountPaidUsd ?? 0) !== 0 ||
    (stmt.amountPaidLbp ?? 0) !== 0
  ) {
    console.error(
      `Statement #${SEQUENTIAL_INDEX} has already been paid, is pending approval, or is linked to a treasury transaction / driver settlement. ` +
        `Recalculating it now would desync the ledger. Aborting.`,
    );
    process.exit(1);
  }

  const orderCount = stmt.orders.length;
  const newShippingUsd = round2(orderCount * SHIPPING_PER_ORDER_USD);

  if (round2(stmt.shippingUsd) === newShippingUsd && stmt.shippingUsd !== 0) {
    console.log(
      `Statement #${SEQUENTIAL_INDEX} already has shippingUsd=${stmt.shippingUsd} (${orderCount} orders x $${SHIPPING_PER_ORDER_USD}). Nothing to do.`,
    );
    await prisma.$disconnect();
    process.exit(0);
  }

  const newNetUsd = round2(stmt.totalUsd - newShippingUsd);

  await prisma.merchantPayout.update({
    where: { id: stmt.id },
    data: {
      shippingUsd: newShippingUsd,
      netUsd: newNetUsd,
      // shippingLbp / netLbp unchanged: this statement has no LBP amounts.
    },
  });

  console.log("=".repeat(70));
  console.log(
    `Statement #${stmt.sequentialIndex} (${stmt.merchant.merchantName}) id=${stmt.id}`,
  );
  console.log(`orders:               ${orderCount} x $${SHIPPING_PER_ORDER_USD} shipping`);
  console.log(`  totalUsd:           ${stmt.totalUsd} (unchanged)`);
  console.log(`  shippingUsd:        ${stmt.shippingUsd} -> ${newShippingUsd}`);
  console.log(`  netUsd:             ${stmt.netUsd} -> ${newNetUsd}`);
  console.log(`  totalLbp/shippingLbp/netLbp unchanged (${stmt.totalLbp}/${stmt.shippingLbp}/${stmt.netLbp})`);
  console.log(`  orderIds: ${stmt.orders.map((o) => o.orderId).join(", ")}`);
  console.log("=".repeat(70));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
