/**
 * change-order-5272-1442-seller.js
 *
 * One-off data fix: reassign order 5272-1442 to the merchant whose
 * sequential merchantId is 8 (Order.merchantId stores the Merchant.uuid id).
 *
 * Pre-flight guards:
 *   - Order must exist
 *   - Merchant with merchantId === 8 must exist
 *   - Aborts if the order is already attached to that merchant
 *   - Aborts if the order is locked into a payout statement or a cash/pickup
 *     batch (changing the seller after settlement would corrupt the payout)
 *
 * Runs the update + history entry inside a single transaction.
 *
 * Run: node scripts/change-order-5272-1442-seller.js
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const TARGET_ORDER_ID = "5272-1442";
const TARGET_MERCHANT_SEQ = 8;

async function main() {
  const o = await prisma.order.findUnique({
    where: { orderId: TARGET_ORDER_ID },
    select: {
      id: true,
      orderId: true,
      merchantId: true,
      merchantPayoutId: true,
      cashPayoutBatchId: true,
      pickupBatchId: true,
      returnBatchId: true,
      location: true,
      financialStatus: true,
      creatorId: true,
    },
  });
  if (!o) {
    console.error(`ERROR: order ${TARGET_ORDER_ID} not found. Aborting.`);
    process.exit(1);
  }

  const target = await prisma.merchant.findUnique({
    where: { merchantId: TARGET_MERCHANT_SEQ },
    select: { id: true, merchantId: true, merchantName: true },
  });
  if (!target) {
    console.error(`ERROR: no merchant with merchantId ${TARGET_MERCHANT_SEQ}. Aborting.`);
    process.exit(1);
  }

  if (o.merchantId === target.id) {
    console.log(`Order ${TARGET_ORDER_ID} is already assigned to merchant ${TARGET_MERCHANT_SEQ} (${target.merchantName}). Nothing to change.`);
    return;
  }

  if (o.merchantPayoutId || o.cashPayoutBatchId || o.pickupBatchId || o.returnBatchId) {
    console.error(
      `ERROR: order ${TARGET_ORDER_ID} is attached to a payout/batch ` +
        `(merchantPayoutId=${o.merchantPayoutId}, cashPayoutBatchId=${o.cashPayoutBatchId}, ` +
        `pickupBatchId=${o.pickupBatchId}, returnBatchId=${o.returnBatchId}). ` +
        "Reassigning the seller would corrupt settlement records. Aborting."
    );
    process.exit(1);
  }

  const previous = o.merchantId
    ? await prisma.merchant.findUnique({ where: { id: o.merchantId }, select: { merchantId: true, merchantName: true } })
    : null;

  console.log(
    `BEFORE: ${o.orderId} seller=${previous ? `merchantId ${previous.merchantId} (${previous.merchantName})` : "none"} ` +
      `location=${o.location} fin=${o.financialStatus}`
  );

  let actor = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!actor) actor = { id: o.creatorId };

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: o.id },
      data: {
        merchantId: target.id,
        history: {
          create: {
            action: `Seller changed: ${previous ? `merchantId ${previous.merchantId} (${previous.merchantName})` : "none"} → merchantId ${target.merchantId} (${target.merchantName})`,
            location: o.location,
            userId: actor.id,
          },
        },
      },
    });
  });

  const after = await prisma.order.findUnique({
    where: { orderId: TARGET_ORDER_ID },
    select: { orderId: true, merchant: { select: { merchantId: true, merchantName: true } } },
  });
  console.log(`AFTER: ${after.orderId} seller=merchantId ${after.merchant.merchantId} (${after.merchant.merchantName})`);
  console.log("✓ Done.");
}

main()
  .catch((e) => { console.error("FATAL:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
