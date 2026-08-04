/**
 * Create 9 test orders ($10 each) for a specific seller (merchant) and
 * assign them to driver D000.
 *
 * This is used to test the "statement printing" flow:
 *   1. Creates 9 orders for the seller, each with amountUsd = 10
 *   2. Assigns each order to driver D000 (location ASSIGNED, financialStatus UD)
 *
 * Run: npx tsx scripts/create-test-orders-d000.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// The seller page URL id (Merchant.id UUID)
const SELLER_ID = "74b94747-7577-4f09-9eb6-328efdd354f6";

// Test driver's human-readable driverId
const TARGET_DRIVER_ID = "D000";

const ORDER_COUNT = 9;
const ORDER_AMOUNT_USD = 10;

function makeOrderId(index: number): string {
  const seq = String(index).padStart(2, "0");
  return `STMT-TEST-${seq}`;
}

async function main() {
  console.log(`Creating ${ORDER_COUNT} test orders for seller ${SELLER_ID}...`);

  // ── 1. Locate the merchant (seller) ──────────────────────────────────────
  const merchant = await prisma.merchant.findUnique({
    where: { id: SELLER_ID },
    select: { id: true, merchantName: true, merchantId: true },
  });

  if (!merchant) {
    console.error(`ERROR: Merchant/Seller with id ${SELLER_ID} not found.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(
    `Found seller: ${merchant.merchantName} (merchantId #${merchant.merchantId})`,
  );

  // ── 2. Locate driver D000 ────────────────────────────────────────────────
  const driverProfile = await prisma.driverProfile.findFirst({
    where: { driverId: { equals: TARGET_DRIVER_ID, mode: "insensitive" } },
    select: { id: true, driverId: true, firstName: true, lastName: true },
  });

  if (!driverProfile) {
    console.error(`ERROR: Driver ${TARGET_DRIVER_ID} not found in the system.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(
    `Found driver: ${driverProfile.firstName} ${driverProfile.lastName} (${driverProfile.driverId}, DB ID: ${driverProfile.id})`,
  );

  // ── 3. Pick a zone for the orders ────────────────────────────────────────
  const zone = await prisma.zone.findFirst({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  if (!zone) {
    console.error("ERROR: No zone available to attach orders to.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`Using zone: ${zone.name} (${zone.id})`);

  // ── 4. Find an admin user to record as creator / history user ───────────
  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, username: true },
  });

  if (!adminUser) {
    console.error("ERROR: No admin user found to record history entries.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`Using admin user: ${adminUser.username} (${adminUser.id})`);

  // ── 5. Create the orders (idempotent: skip existing orderIds) ────────────
  const orderIds = Array.from({ length: ORDER_COUNT }, (_, i) =>
    makeOrderId(i + 1),
  );

  const existing = await prisma.order.findMany({
    where: { orderId: { in: orderIds } },
    select: { orderId: true, driverId: true },
  });
  const existingMap = new Map(existing.map((o) => [o.orderId, o]));

  let createdCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < ORDER_COUNT; i++) {
    const orderId = orderIds[i];

    if (existingMap.has(orderId)) {
      console.log(`  - ${orderId} already exists (skipped)`);
      skippedCount++;
      continue;
    }

    try {
      await prisma.order.create({
        data: {
          orderId,
          customerName: `Test Customer ${i + 1}`,
          customerPhone: "N/A",
          customerAddress: `Test Address ${i + 1}`,
          packages: 1,
          zoneId: zone.id,
          hasExchange: false,
          amountUsd: ORDER_AMOUNT_USD,
          amountLbp: 0,
          extraShipping: 0,
          notes: `Statement printing test order ${i + 1}`,
          merchantId: merchant.id,
          creatorId: adminUser.id,
          driverId: driverProfile.id,
          location: "ASSIGNED",
          financialStatus: "UD",
          history: {
            create: [
              {
                action: "Order Created",
                location: "WAREHOUSE",
                userId: adminUser.id,
              },
              {
                action: "Assigned to Driver (Test)",
                location: "ASSIGNED",
                driverId: driverProfile.id,
                userId: adminUser.id,
              },
            ],
          },
        },
      });
      console.log(
        `  ✓ ${orderId} → created ($10) and assigned to ${driverProfile.driverId}`,
      );
      createdCount++;
    } catch (err: any) {
      console.error(`  ✗ ${orderId} → Error: ${err.message}`);
    }
  }

  // ── 6. Final summary ─────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  FINAL SUMMARY");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Seller:       ${merchant.merchantName}`);
  console.log(`  Driver:       ${driverProfile.driverId}`);
  console.log(`  Zone:         ${zone.name}`);
  console.log(`  Created:      ${createdCount}`);
  console.log(`  Skipped:      ${skippedCount}`);
  console.log(`  Amount/order: $${ORDER_AMOUNT_USD}`);
  console.log(`  Total value:  $${createdCount * ORDER_AMOUNT_USD}`);
  console.log("═══════════════════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
