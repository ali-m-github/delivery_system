/**
 * One-off repair: order "2-0001" (Electroni, merchantId
 * 61d8d846-d526-41bb-b580-1431a72a1db0) had been excluded from cash-seller
 * payouts (cashPayoutExcluded = true, set 2026-10-16 via the "Remove" button).
 * The owner asked for it to be paid, so re-include it in "Eligible Orders for
 * Advance" by clearing the flag — exactly what the UI's exclude endpoint does
 * (PATCH /api/admin/merchants/[id]/cash-payouts/exclude with excluded=false).
 *
 * Run: npx tsx scripts/fix-include-order-2-0001.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const order = await prisma.order.findFirst({
    where: {
      orderId: "2-0001",
      merchantId: "61d8d846-d526-41bb-b580-1431a72a1db0",
    },
    select: {
      id: true,
      orderId: true,
      merchantId: true,
      cashPayoutExcluded: true,
      cashPayoutBatchId: true,
      returnDeductionBatchId: true,
      isArchived: true,
    },
  });

  if (!order) {
    console.error('Order "2-0001" not found for that merchant — nothing changed.');
    await prisma.$disconnect();
    process.exit(1);
  }

  if (!order.cashPayoutExcluded) {
    console.log("Order is already included (cashPayoutExcluded = false) — nothing changed.");
    await prisma.$disconnect();
    return;
  }

  // Defensive: never re-include an order that a payout batch already paid or
  // deducted — that would double-pay it.
  if (order.cashPayoutBatchId || order.returnDeductionBatchId) {
    console.error(
      `Refusing: order already belongs to a payout batch (cashPayoutBatchId=${order.cashPayoutBatchId}, returnDeductionBatchId=${order.returnDeductionBatchId}).`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { cashPayoutExcluded: false },
    select: { id: true, orderId: true, cashPayoutExcluded: true },
  });

  console.log("Re-included in Eligible Orders for Advance:", updated);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
