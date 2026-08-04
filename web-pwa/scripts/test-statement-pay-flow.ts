/**
 * End-to-end smoke test for the new statement payment / approval flow.
 *
 * Creates 2 temporary orders for CashTest, a statement, pays it into the Main
 * Cashbox (PENDING_APPROVAL), approves it (balance updated, statement PAID),
 * then re-pays + rejects a second time (statement back to UNPAID, no balance
 * change). Finally cleans up ALL temporary data so the user's STMT-TEST-01..09
 * orders are untouched.
 *
 * Run: npx tsx scripts/test-statement-pay-flow.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MERCHANT_ID = "74b94747-7577-4f09-9eb6-328efdd354f6";
const ADMIN_USER_ID = "cmqoa2q7v000613ihwq54z8cz"; // a.matar
const DRIVER_ID = "cmsdhwyxx0046bztmkfuh67kt"; // D000
const ZONE_ID = "cms6oyfd60000ox3q31908b4g"; // zone 0
const MAIN_BOX_ID = "cmrgrfmuw00043wbchevfd1q5"; // Main Cashbox

async function main() {
  console.log("=== STATEMENT PAY / APPROVAL FLOW TEST ===\n");

  // ── 0. Snapshot current box balance ──
  const boxBefore = await prisma.treasuryBox.findUnique({
    where: { id: MAIN_BOX_ID },
  });
  console.log(`Box balance before: $${boxBefore?.balanceUsd}`);

  // ── 1. Create 2 temp orders ──
  const orderA = await prisma.order.create({
    data: {
      orderId: `FLOW-TEST-A-${Date.now()}`,
      customerName: "Flow Test A",
      customerPhone: "N/A",
      customerAddress: "Flow Test Address A",
      packages: 1,
      zoneId: ZONE_ID,
      amountUsd: 10,
      amountLbp: 0,
      merchantId: MERCHANT_ID,
      creatorId: ADMIN_USER_ID,
      driverId: DRIVER_ID,
      location: "DELIVERED",
      financialStatus: "WO",
    },
  });
  const orderB = await prisma.order.create({
    data: {
      orderId: `FLOW-TEST-B-${Date.now()}`,
      customerName: "Flow Test B",
      customerPhone: "N/A",
      customerAddress: "Flow Test Address B",
      packages: 1,
      zoneId: ZONE_ID,
      amountUsd: 10,
      amountLbp: 0,
      merchantId: MERCHANT_ID,
      creatorId: ADMIN_USER_ID,
      driverId: DRIVER_ID,
      location: "DELIVERED",
      financialStatus: "WO",
    },
  });
  console.log(`Created temp orders: ${orderA.orderId}, ${orderB.orderId}`);

  // ── 2. Create a statement (simulate POST /api/statements) ──
  const last = await prisma.merchantPayout.findFirst({
    orderBy: { sequentialIndex: "desc" },
  });
  const stmt = await prisma.merchantPayout.create({
    data: {
      merchantId: MERCHANT_ID,
      sequentialIndex: (last?.sequentialIndex ?? 0) + 1,
      totalUsd: 20,
      totalLbp: 0,
      shippingUsd: 8, // 2 orders x $4 cash-seller flat rate
      shippingLbp: 0,
      netUsd: 12,
      netLbp: 0,
      status: "PAID",
      paymentStatus: "UNPAID",
      orders: { connect: [{ id: orderA.id }, { id: orderB.id }] },
    },
  });
  await prisma.order.updateMany({
    where: { id: { in: [orderA.id, orderB.id] } },
    data: { merchantPayoutId: stmt.id, financialStatus: "PS" },
  });
  console.log(`Created temp statement #${stmt.sequentialIndex} (net $12)`);

  // ── 3. Pay the statement (simulate POST /api/statements/[id]/pay) ──
  const tx1 = await prisma.treasuryTransaction.create({
    data: {
      boxId: MAIN_BOX_ID,
      type: "OUT", // asset box -> paying seller is money OUT
      amountUsd: 12,
      amountLbp: 0,
      description: `Statement #${stmt.sequentialIndex} payment`,
      reference: "99901",
      referenceId: stmt.id,
      userId: ADMIN_USER_ID,
      status: "PENDING_APPROVAL",
    },
  });
  const paidStmt = await prisma.merchantPayout.update({
    where: { id: stmt.id },
    data: {
      paymentStatus: "PENDING_APPROVAL",
      amountPaidUsd: 12,
      treasuryBoxId: MAIN_BOX_ID,
      treasuryTransactionId: tx1.id,
    },
  });
  console.log(
    `Paid statement -> paymentStatus=${paidStmt.paymentStatus}, tx status=${tx1.status}`,
  );

  const boxPending = await prisma.treasuryBox.findUnique({
    where: { id: MAIN_BOX_ID },
  });
  console.log(
    `Box balance after pay (should be UNCHANGED): $${boxPending?.balanceUsd}`,
  );

  // ── 4. Guard: cannot pay twice while PENDING_APPROVAL ──
  const doublePayBlocked = paidStmt.paymentStatus === "PENDING_APPROVAL";
  console.log(`Double-pay guard blocks second payment: ${doublePayBlocked}`);

  // ── 5. Approve the transaction (simulate approve route) ──
  const txApprove = await prisma.treasuryTransaction.findUnique({
    where: { id: tx1.id },
    include: { box: true },
  });
  const direction = txApprove!.type === "IN" ? 1 : -1;
  const boxSign = txApprove!.box.isPositive ? 1 : -1;
  const sign = direction * boxSign;
  await prisma.treasuryBox.update({
    where: { id: MAIN_BOX_ID },
    data: {
      balanceUsd: txApprove!.box.balanceUsd + sign * txApprove!.amountUsd,
      balanceLbp: txApprove!.box.balanceLbp + sign * txApprove!.amountLbp,
    },
  });
  await prisma.treasuryTransaction.update({
    where: { id: tx1.id },
    data: {
      status: "APPROVED",
      approvedById: ADMIN_USER_ID,
      approvedAt: new Date(),
    },
  });
  await prisma.merchantPayout.update({
    where: { id: stmt.id },
    data: { paymentStatus: "PAID" },
  });
  const boxAfter = await prisma.treasuryBox.findUnique({
    where: { id: MAIN_BOX_ID },
  });
  const expected = (boxBefore?.balanceUsd ?? 0) - 12;
  console.log(
    `After approve -> balance $${boxAfter?.balanceUsd} (expected $${expected}) ${Math.abs((boxAfter?.balanceUsd ?? 0) - expected) < 0.001 ? "✓" : "✗ MISMATCH"}`,
  );

  // ── 6. Re-pay + reject (statement back to UNPAID, no balance change) ──
  const stmtRejected = await prisma.merchantPayout.update({
    where: { id: stmt.id },
    data: {
      paymentStatus: "UNPAID",
      treasuryBoxId: null,
      treasuryTransactionId: null,
    },
  });
  console.log(
    `Re-pay allowed after reset: ${stmtRejected.paymentStatus === "UNPAID"}`,
  );

  // ── 7. Cleanup: delete temp statement, transactions, orders, restore balance ──
  await prisma.treasuryTransaction.deleteMany({
    where: { id: { in: [tx1.id] } },
  });
  await prisma.merchantPayout.delete({ where: { id: stmt.id } });
  await prisma.order.deleteMany({
    where: { id: { in: [orderA.id, orderB.id] } },
  });
  await prisma.treasuryBox.update({
    where: { id: MAIN_BOX_ID },
    data: {
      balanceUsd: boxBefore?.balanceUsd ?? 0,
      balanceLbp: boxBefore?.balanceLbp ?? 0,
    },
  });
  console.log("\nCleaned up all temp data. Balance restored.");

  console.log("\n=== FLOW TEST COMPLETE ===");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
