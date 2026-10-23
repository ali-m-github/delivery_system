/**
 * Inspect order "2-0001": why is it not showing in "Eligible Orders for Advance"?
 * Checks the exact eligibility filter used by
 * GET /api/admin/merchants/[id]/cash-payouts:
 *   merchantId matches, cashPayoutBatchId = null, returnDeductionBatchId = null,
 *   cashPayoutExcluded = false, isArchived = false, orderId NOT endsWith "-Exchange".
 * Read-only. Run: npx tsx scripts/inspect-order-2-0001.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const exact = await prisma.order.findMany({
    where: { orderId: { equals: "2-0001" } },
    select: {
      id: true,
      orderId: true,
      merchantId: true,
      merchant: { select: { merchantId: true, merchantName: true, isCashSeller: true } },
      amountUsd: true,
      amountLbp: true,
      collectedUsd: true,
      location: true,
      financialStatus: true,
      isArchived: true,
      cashPayoutExcluded: true,
      cashPayoutBatchId: true,
      returnDeductionBatchId: true,
      returnBatchId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (exact.length === 0) {
    console.error('No order with orderId exactly "2-0001" found.');
    console.error("Searching for any orderId containing \"2-0001\"...");
    const partial = await prisma.order.findMany({
      where: { orderId: { contains: "2-0001" } },
      select: { id: true, orderId: true, merchantId: true, createdAt: true },
      take: 20,
    });
    console.log(JSON.stringify(partial, null, 2));
    await prisma.$disconnect();
    return;
  }

  console.log("=== MATCHING ORDERS ===");
  console.log(JSON.stringify(exact, null, 2));

  for (const o of exact) {
    const reasons: string[] = [];
    if (o.isArchived) reasons.push("isArchived = true");
    if (o.cashPayoutExcluded) reasons.push("cashPayoutExcluded = true (manually removed via Remove button)");
    if (o.cashPayoutBatchId) reasons.push(`already in cash payout batch id=${o.cashPayoutBatchId}`);
    if (o.returnDeductionBatchId) reasons.push(`already used as a return deduction in batch id=${o.returnDeductionBatchId}`);
    if (o.orderId.endsWith("-Exchange")) reasons.push("orderId ends with -Exchange");
    if (reasons.length === 0) reasons.push("NO disqualifying flags — should already be eligible (check merchant id / date filter in UI)");
    console.log(`\n=== WHY NOT ELIGIBLE: ${o.orderId} ===`);
    for (const r of reasons) console.log(" - " + r);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
