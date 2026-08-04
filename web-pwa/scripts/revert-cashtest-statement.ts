/**
 * Revert the CashTest statement #1 test data.
 *
 * The user asked to:
 *   1. "Revert back statement #1 CashTest" — undo the statement that locked the
 *      STMT-TEST-01..09 orders into financialStatus "PS" (Paid to Seller).
 *   2. "Revert back the statement orders of Cashtest to WO" so they can be
 *      printed / selected again.
 *   3. Fix the statement-ID collision: CashTest #1 and Tloba #1 both show "#1".
 *      Statement sequentialIndex is made globally unique.
 *
 * What this script does:
 *   - Finds every statement belonging to the CashTest seller.
 *   - Unlinks all their orders (merchantPayoutId -> null) and reverts their
 *     financialStatus back to "WO" (location stays DELIVERED so they remain in
 *     the WO tab / payable orders).
 *   - Deletes the CashTest statement records.
 *   - Renumbers all remaining statements so sequentialIndex is globally unique
 *     (sorted by createdAt), fixing the shared "#1" between CashTest & Tloba.
 *
 * Run: npx tsx scripts/revert-cashtest-statement.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// CashTest seller id (from /sellers/74b94747-7577-4f09-9eb6-328efdd354f6)
const CASH_TEST_MERCHANT_ID = "74b94747-7577-4f09-9eb6-328efdd354f6";

async function main() {
  // ── 1. Locate the CashTest merchant ──────────────────────────────────────
  const merchant = await prisma.merchant.findUnique({
    where: { id: CASH_TEST_MERCHANT_ID },
    select: { id: true, merchantName: true },
  });

  if (!merchant) {
    console.error(
      `ERROR: CashTest merchant ${CASH_TEST_MERCHANT_ID} not found.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  // ── 2. Fetch all CashTest statements with their orders ──────────────────
  const statements = await prisma.merchantPayout.findMany({
    where: { merchantId: merchant.id },
    include: { orders: { select: { id: true, orderId: true } } },
  });

  console.log(
    `Found ${statements.length} statement(s) for ${merchant.merchantName}:`,
  );
  for (const s of statements)
    console.log(
      `  #${s.sequentialIndex} (${s.id}) — ${s.orders.length} orders`,
    );

  if (statements.length === 0) {
    console.log("No CashTest statements to revert.");
  } else {
    const orderIds = statements.flatMap((s) => s.orders.map((o) => o.id));

    // ── 3. Revert orders: unlink from statement + financialStatus -> WO ────
    if (orderIds.length > 0) {
      const updated = await prisma.order.updateMany({
        where: { id: { in: orderIds } },
        data: {
          merchantPayoutId: null,
          financialStatus: "WO",
        },
      });
      console.log(`\nReverted ${updated.count} order(s) back to WO.`);
    }

    // ── 4. Delete the CashTest statement records ──────────────────────────
    const del = await prisma.merchantPayout.deleteMany({
      where: { merchantId: merchant.id },
    });
    console.log(`Deleted ${del.count} CashTest statement record(s).`);
  }

  // ── 5. Renumber remaining statements to be GLOBALLY unique ──────────────
  const remaining = await prisma.merchantPayout.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      merchant: { select: { id: true, merchantName: true } },
    },
  });

  console.log(
    `\nRenumbering ${remaining.length} remaining statement(s) globally:`,
  );
  for (let i = 0; i < remaining.length; i++) {
    const stmt = remaining[i];
    const newIndex = i + 1;
    if (stmt.sequentialIndex !== newIndex) {
      await prisma.merchantPayout.update({
        where: { id: stmt.id },
        data: { sequentialIndex: newIndex },
      });
      console.log(
        `  #${stmt.sequentialIndex} -> #${newIndex} (${stmt.merchant.merchantName})`,
      );
    } else {
      console.log(
        `  #${stmt.sequentialIndex} (unchanged, ${stmt.merchant.merchantName})`,
      );
    }
  }

  console.log(
    "\nDone. CashTest statement reverted & statement IDs de-duplicated.",
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
