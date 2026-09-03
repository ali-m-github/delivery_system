/**
 * fix-exchange-proof-order-prices.ts
 *
 * One-off data fix: "-Exchange" proof orders (e.g. 10007834-Exchange) are
 * created by lib/exchange.ts as proof that an item is being returned to the
 * merchant. They must NEVER carry the main order's COD price — the COD value
 * belongs to the main order, which was already advanced. Before the code fix
 * (createExchangeOrderFromDelivered now writes amountUsd/Lbp = 0), legacy rows
 * copied the main price and were deducted at full amount in
 * "Unresolved Returns to Deduct" (cash seller payouts).
 *
 * Changes (one $transaction per affected order):
 *   1. Order: amountUsd → 0, amountLbp → 0 (collected columns already 0)
 *   2. OrderHistory entry recording the fix
 *
 * Safety: only touches orders whose orderId ends with "-Exchange", whose
 * collected amounts are already 0, and that are NOT yet claimed by any cash
 * payout batch. Orders already deducted in a batch are reported but NOT
 * modified (a batch's historical numbers would become inconsistent).
 *
 * Run: npx ts-node scripts/fix-exchange-proof-order-prices.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function assert(cond: any, msg?: string): asserts cond {
  if (!cond) {
    console.error(`ERROR: ${msg}. Aborting — no writes performed.`);
    process.exit(1);
  }
}

async function main() {
  // ── 1. Load + validate current state (before any write) ─────────────────
  const exchangeOrders = await prisma.order.findMany({
    where: { orderId: { endsWith: "-Exchange" } },
    select: {
      id: true,
      orderId: true,
      merchantId: true,
      amountUsd: true,
      amountLbp: true,
      collectedUsd: true,
      collectedLbp: true,
      financialStatus: true,
      location: true,
      cashPayoutBatchId: true,
      returnDeductionBatchId: true,
    },
    orderBy: { createdAt: "desc" },
  });

  assert(
    exchangeOrders.length > 0,
    `expected at least one "-Exchange" order, found ${exchangeOrders.length}`,
  );

  for (const o of exchangeOrders) {
    assert(
      o.collectedUsd === 0 && o.collectedLbp === 0,
      `${o.orderId}: collected amounts must already be 0 (proof order)`,
    );
  }

  const toFix = exchangeOrders.filter((o) => o.amountUsd !== 0 || o.amountLbp !== 0);
  const alreadyZero = exchangeOrders.filter((o) => o.amountUsd === 0 && o.amountLbp === 0);
  const inBatch = exchangeOrders.filter(
    (o) => o.cashPayoutBatchId !== null || o.returnDeductionBatchId !== null,
  );

  // Never rewrite rows already claimed by a cash payout batch — the batch's
  // stored totals (deductedReturns / netPaid) would no longer match.
  const fixable = toFix.filter(
    (o) => o.cashPayoutBatchId === null && o.returnDeductionBatchId === null,
  );
  const skipped = toFix.filter((o) => !fixable.includes(o));

  console.log("── BEFORE ───────────────────────────────────────────────");
  for (const o of exchangeOrders) {
    console.log(
      `Order ${o.orderId}: amountUsd=${o.amountUsd} amountLbp=${o.amountLbp} status=${o.financialStatus} location=${o.location} advanceBatch=${o.cashPayoutBatchId ?? "-"} returnBatch=${o.returnDeductionBatchId ?? "-"}`,
    );
  }
  console.log(
    `\n${fixable.length} to fix, ${skipped.length} skipped (already in a batch), ${alreadyZero.length} already zero.`,
  );

  if (fixable.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // ── 2. Execute the fix in a single transaction ───────────────────────────
  const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  assert(adminUser !== null, "no ADMIN user found for history entries");

  await prisma.$transaction(async (tx) => {
    for (const o of fixable) {
      await tx.order.update({
        where: { id: o.id },
        data: {
          amountUsd: 0,
          amountLbp: 0,
          history: {
            create: {
              action: `Data fix: null price on exchange proof order (was amountUsd=${o.amountUsd}, amountLbp=${o.amountLbp}); exchanges carry no price — their deduction is $0`,
              location: o.location,
              userId: adminUser.id,
            },
          },
        },
      });
    }
  });

  console.log("\n✓ Transaction committed.");

  // ── 3. AFTER report + consistency check ──────────────────────────────────
  const after = await prisma.order.findMany({
    where: { orderId: { endsWith: "-Exchange" } },
    select: { orderId: true, amountUsd: true, amountLbp: true, financialStatus: true },
  });

  console.log("── AFTER ────────────────────────────────────────────────");
  for (const o of after) {
    console.log(`Order ${o.orderId}: amountUsd=${o.amountUsd} amountLbp=${o.amountLbp} status=${o.financialStatus}`);
  }

  assert(
    fixable.every((o) => {
      const a = after.find((x) => x.orderId === o.orderId);
      return a?.amountUsd === 0 && a?.amountLbp === 0;
    }),
    "post-fix: some exchange orders still carry a price",
  );

  if (skipped.length > 0) {
    console.warn(
      `\n⚠ SKIPPED (already in a cash payout batch — review manually): ${skipped
        .map((o) => o.orderId)
        .join(", ")}`,
    );
  }

  console.log("\n✓ All post-fix consistency checks passed.");
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
