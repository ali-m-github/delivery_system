/**
 * Create a single test order for the merchant "Kids Gram" and assign it to
 * driver "Ali Matar" (location ASSIGNED, financialStatus UD).
 *
 * Used to manually test new features end-to-end (orders list, driver app,
 * tracking link, etc.).
 *
 * Run: node --env-file=.env scripts/create-test-order-kids-gram.ts
 */

import { PrismaClient } from "@prisma/client";
import { randomInt } from "node:crypto";

const prisma = new PrismaClient();

const MERCHANT_NAME_QUERY = "kidsgram";
const DRIVER_FIRST_NAME = "ali";
const DRIVER_LAST_NAME = "matar";

const ORDER_AMOUNT_USD = 10;

/** Same 8-digit shape as lib/tracking.ts (kept inline so the script has no
 *  dependency on the app's "@/..." path aliases). */
async function generateTrackToken(client: PrismaClient): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const token = String(10000000 + randomInt(0, 90000000));
    const existing = await client.order.findUnique({
      where: { trackToken: token },
      select: { id: true },
    });
    if (!existing) return token;
  }
  throw new Error("Could not generate a unique tracking token");
}

async function main() {
  // ── 1. Locate the merchant ───────────────────────────────────────────────
  const merchant = await prisma.merchant.findFirst({
    where: { merchantName: { contains: MERCHANT_NAME_QUERY, mode: "insensitive" } },
    select: { id: true, merchantName: true, merchantId: true },
  });

  if (!merchant) {
    console.error(`ERROR: Merchant matching "${MERCHANT_NAME_QUERY}" not found.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(
    `Found merchant: ${merchant.merchantName} (merchantId #${merchant.merchantId}, DB ID: ${merchant.id})`,
  );

  // ── 2. Locate the driver ─────────────────────────────────────────────────
  const driverProfile = await prisma.driverProfile.findFirst({
    where: {
      OR: [
        {
          firstName: { equals: DRIVER_FIRST_NAME, mode: "insensitive" },
          lastName: { equals: DRIVER_LAST_NAME, mode: "insensitive" },
        },
        {
          firstName: { equals: DRIVER_LAST_NAME, mode: "insensitive" },
          lastName: { equals: DRIVER_FIRST_NAME, mode: "insensitive" },
        },
      ],
    },
    select: { id: true, driverId: true, firstName: true, lastName: true },
  });

  if (!driverProfile) {
    console.error(`ERROR: Driver "${DRIVER_FIRST_NAME} ${DRIVER_LAST_NAME}" not found.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(
    `Found driver: ${driverProfile.firstName} ${driverProfile.lastName} (${driverProfile.driverId}, DB ID: ${driverProfile.id})`,
  );

  // ── 3. Pick a zone — prefer one already assigned to the driver ───────────
  const driverZone = await prisma.driverZoneAssignment.findFirst({
    where: { driverId: driverProfile.id },
    select: { zone: { select: { id: true, name: true } } },
  });

  const zone = driverZone?.zone
    ? driverZone.zone
    : await prisma.zone.findFirst({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });

  if (!zone) {
    console.error("ERROR: No zone available to attach the order to.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`Using zone: ${zone.name} (${zone.id})`);

  // ── 4. Find an admin user to record as creator / history user ────────────
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

  // ── 5. Create the test order, assigned to the driver ─────────────────────
  const orderId = `TEST-${Date.now()}`;
  const trackToken = await generateTrackToken(prisma);

  const order = await prisma.order.create({
    data: {
      orderId,
      trackToken,
      customerName: "Test Customer",
      customerPhone: "N/A",
      customerAddress: "Test Address",
      packages: 1,
      zoneId: zone.id,
      hasExchange: false,
      amountUsd: ORDER_AMOUNT_USD,
      amountLbp: 0,
      extraShipping: 0,
      notes: "Test order for feature testing",
      merchantId: merchant.id,
      creatorId: adminUser.id,
      driverId: driverProfile.id,
      location: "ASSIGNED",
      financialStatus: "UD",
      history: {
        create: [
          {
            action: "Order Created (Test)",
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
    select: { id: true, orderId: true, trackToken: true },
  });

  // ── 6. Summary ────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  TEST ORDER CREATED");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Order ID:     ${order.orderId}`);
  console.log(`  Internal ID:  ${order.id}`);
  console.log(`  Merchant:     ${merchant.merchantName}`);
  console.log(`  Driver:       ${driverProfile.firstName} ${driverProfile.lastName} (${driverProfile.driverId})`);
  console.log(`  Zone:         ${zone.name}`);
  console.log(`  Amount:       $${ORDER_AMOUNT_USD}`);
  console.log(`  Location:     ASSIGNED / UD`);
  console.log(`  Track token:  ${order.trackToken}`);
  console.log("═══════════════════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
