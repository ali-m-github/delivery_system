/**
 * renumber-merchant-14-to-13.js
 *
 * Renames the consolidated "Alexa Cosmetics" seller from merchant #14 to
 * #13 (the number originally created), and renumbers its order IDs from
 * "14-XXXX" to "13-XXXX" so the human-readable IDs stay consistent with the
 * seller number (orderId format is "{merchantId}-{seq}").
 *
 * Safety:
 *   - Aborts if merchant #13 already exists (unique constraint).
 *   - Aborts if any "13-XXXX" orderId already exists (unique constraint).
 *   - Aborts if any of the seller's orders is claimed (driver / payout /
 *     statement / cash-batch reference) or delivered/archived — renumbering
 *     such orders could break external references.
 *
 * OrderHistory rows reference the order's internal id (cuid), not the
 * orderId string, so no history rows need updating. A history entry is added
 * per order recording the renumber.
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const MERCHANT_ID = "244b2a2f-b02f-4d00-9d9f-e9786d9af9ed"; // "Alexa Cosmetics" (currently #14)
const FROM_NUM = 14;
const TO_NUM = 13;

async function main() {
  const merchant = await prisma.merchant.findUnique({
    where: { id: MERCHANT_ID },
    select: { id: true, merchantId: true, sellerNumber: true, merchantName: true },
  });
  if (!merchant) {
    console.log("Merchant not found — nothing to do. Exiting.");
    return;
  }
  if (merchant.merchantId === TO_NUM) {
    console.log(`Merchant is already #${TO_NUM}. Exiting.`);
    return;
  }
  if (merchant.merchantId !== FROM_NUM) {
    throw new Error(
      `Expected merchantId ${FROM_NUM}, found ${merchant.merchantId} — aborting.`,
    );
  }

  // Pre-checks (outside the transaction, informational + fast-fail)
  const num13Exists = await prisma.merchant.findUnique({
    where: { merchantId: TO_NUM },
    select: { merchantId: true },
  });
  if (num13Exists) throw new Error(`Merchant #${TO_NUM} already exists — aborting.`);

  const collidingOrders = await prisma.order.findMany({
    where: { orderId: { startsWith: `${TO_NUM}-` } },
    select: { orderId: true },
    take: 5,
  });
  if (collidingOrders.length > 0)
    throw new Error(
      `Existing ${TO_NUM}-XXXX orderIds would collide: ${collidingOrders
        .map((o) => o.orderId)
        .join(", ")} — aborting.`,
    );

  const orders = await prisma.order.findMany({
    where: { merchantId: MERCHANT_ID },
    select: {
      id: true,
      orderId: true,
      location: true,
      driverId: true,
      driverPayoutId: true,
      merchantPayoutId: true,
      cashPayoutBatchId: true,
      returnDeductionBatchId: true,
      isArchived: true,
      creatorId: true,
    },
  });
  console.log(
    `Found ${orders.length} orders on merchant #${FROM_NUM}. Claimed/delivered check:`,
  );
  for (const o of orders) {
    const claimed =
      o.driverId ||
      o.driverPayoutId ||
      o.merchantPayoutId ||
      o.cashPayoutBatchId ||
      o.returnDeductionBatchId;
    console.log(
      `  ${o.orderId}  loc=${o.location}  claimed=${Boolean(
        claimed,
      )}  archived=${o.isArchived}`,
    );
    if (claimed || o.isArchived || o.location === "DELIVERED") {
      throw new Error(
        `Order ${o.orderId} is claimed/delivered/archived — aborting to avoid breaking references.`,
      );
    }
    if (!o.orderId.startsWith(`${FROM_NUM}-`)) {
      throw new Error(
        `Order ${o.orderId} does not start with "${FROM_NUM}-" — aborting (unexpected ID format).`,
      );
    }
  }
  if (orders.length === 0) {
    console.log("No orders to renumber; only the merchant number will change.");
  }

  // ── Apply (single transaction) ─────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    // Re-verify inside the transaction (authoritative state).
    const fresh = await tx.merchant.findUnique({
      where: { id: MERCHANT_ID },
      select: { merchantId: true },
    });
    if (!fresh || fresh.merchantId !== FROM_NUM) {
      throw new Error("Merchant changed concurrently — aborting.");
    }
    const fresh13 = await tx.merchant.findUnique({
      where: { merchantId: TO_NUM },
      select: { merchantId: true },
    });
    if (fresh13) throw new Error(`Merchant #${TO_NUM} now exists — aborting.`);

    // 1. Renumber each order's orderId + add an audit history entry.
    for (const o of orders) {
      const newOrderId = `${TO_NUM}-${o.orderId.slice(String(FROM_NUM).length)}`;
      const res = await tx.order.updateMany({
        where: { id: o.id, orderId: o.orderId },
        data: { orderId: newOrderId },
      });
      if (res.count !== 1) {
        throw new Error(`Could not rename ${o.orderId} (concurrent change).`);
      }
      await tx.orderHistory.create({
        data: {
          orderId: o.id,
          userId: o.creatorId,
          action: `Renumbered order ID ${o.orderId} -> ${newOrderId} (seller renumbered #${FROM_NUM} -> #${TO_NUM})`,
        },
      });
    }

    // 2. Renumber the merchant itself.
    const updated = await tx.merchant.updateMany({
      where: { id: MERCHANT_ID, merchantId: FROM_NUM },
      data: { merchantId: TO_NUM, sellerNumber: TO_NUM },
    });
    if (updated.count !== 1) {
      throw new Error("Could not update merchant number (concurrent change).");
    }
  });

  // ── Post-verification ──────────────────────────────────────────────────
  const final = await prisma.merchant.findUnique({
    where: { merchantId: TO_NUM },
    select: {
      merchantId: true,
      sellerNumber: true,
      merchantName: true,
      isCashSeller: true,
      user: { select: { username: true, email: true } },
    },
  });
  const finalOrders = await prisma.order.findMany({
    where: { merchantId: MERCHANT_ID },
    select: { orderId: true, location: true },
    orderBy: { orderId: "asc" },
  });
  console.log("\nDone. Final state:");
  console.log(JSON.stringify(final, null, 2));
  console.log("Orders:", JSON.stringify(finalOrders));
}

main()
  .catch((e) => {
    console.error("RENUMBER FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
