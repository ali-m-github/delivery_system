/**
 * duplicate-order-70617533.ts
 *
 * Creates a duplicate of order 70617533 with the same details, but:
 *   - new orderId: 70617533-1
 *   - NOT delivered: location = ASSIGNED, financialStatus = UD,
 *     collected amounts reset to 0, no payout/statement links
 *   - assigned to driver D0003
 *
 * Idempotent: if 70617533-1 already exists, it is skipped.
 *
 * Run: npx tsx scripts/duplicate-order-70617533.ts
 */
import { PrismaClient } from "@prisma/client";
import { generateTrackToken } from "../lib/tracking";

const prisma = new PrismaClient();

const SOURCE_ORDER_ID = "70617533";
const TARGET_ORDER_ID = "70617533-1";
const TARGET_DRIVER_ID = "D0003";

function assert(cond: any, msg?: string): asserts cond {
  if (!cond) {
    console.error(`ERROR: ${msg}. Aborting — no writes performed.`);
    process.exit(1);
  }
}

async function main() {
  // ── 1. Load source order (with zone/merchant/driver for reference) ───────
  const source = await prisma.order.findUnique({
    where: { orderId: SOURCE_ORDER_ID },
    include: {
      zone: { select: { id: true, name: true } },
      merchant: { select: { id: true, merchantName: true } },
      driver: { select: { id: true, driverId: true, firstName: true, lastName: true } },
      creator: { select: { id: true, username: true } },
    },
  });
  assert(source !== null, `source order ${SOURCE_ORDER_ID} not found`);

  console.log(`Source order ${source.orderId}:`);
  console.log(`  customer:    ${source.customerName} (${source.customerPhone})`);
  console.log(`  address:     ${source.customerAddress}`);
  console.log(`  merchant:    ${source.merchant?.merchantName ?? "none"}`);
  console.log(`  zone:        ${source.zone?.name ?? "none"}`);
  console.log(`  driver:      ${source.driver ? `${source.driver.firstName} ${source.driver.lastName} (${source.driver.driverId})` : "unassigned"}`);
  console.log(`  amounts:     USD ${source.amountUsd} / LBP ${source.amountLbp}`);
  console.log(`  status:      location=${source.location}, financial=${source.financialStatus}`);

  // ── 2. Idempotency: skip if target already exists ────────────────────────
  const existing = await prisma.order.findUnique({ where: { orderId: TARGET_ORDER_ID } });
  if (existing) {
    console.log(`\n${TARGET_ORDER_ID} already exists (DB id ${existing.id}) — nothing to do.`);
    await prisma.$disconnect();
    return;
  }

  // ── 3. Locate target driver D0003 ────────────────────────────────────────
  const driverProfile = await prisma.driverProfile.findFirst({
    where: { driverId: { equals: TARGET_DRIVER_ID, mode: "insensitive" } },
    select: { id: true, driverId: true, firstName: true, lastName: true },
  });
  assert(driverProfile !== null, `driver ${TARGET_DRIVER_ID} not found in the system`);
  console.log(
    `\nTarget driver: ${driverProfile.firstName} ${driverProfile.lastName} (${driverProfile.driverId}, DB id ${driverProfile.id})`,
  );

  // ── 4. Creator for history entries: reuse the source order's creator ─────
  const creator =
    source.creator ?? (await prisma.user.findFirst({ where: { role: "ADMIN" } }));
  assert(creator !== null, "no creator user found (source has no creator and no ADMIN exists)");

  // ── 5. Create the duplicate in one transaction ───────────────────────────
  const trackToken = await generateTrackToken();

  const created = await prisma.$transaction(async (tx) => {
    return tx.order.create({
      data: {
        orderId: TARGET_ORDER_ID,

        // Same details as the source order
        customerName: source.customerName,
        customerPhone: source.customerPhone,
        customerAddress: source.customerAddress,
        hasExchange: source.hasExchange,
        notes: source.notes,
        packages: source.packages,
        extraShipping: source.extraShipping,

        // Same commercial terms
        amountUsd: source.amountUsd,
        amountLbp: source.amountLbp,
        zoneId: source.zoneId,
        merchantId: source.merchantId,
        creatorId: creator.id,
        cashPayoutExcluded: source.cashPayoutExcluded,

        // NOT delivered / not yet collected
        collectedUsd: 0,
        collectedLbp: 0,
        location: "ASSIGNED",
        financialStatus: "UD",
        driverId: driverProfile.id,

        // Fresh identity
        trackToken,
        dispatchedAt: null,
        deliveredAt: null,
        isArchived: false,
        isCorrection: false,
        // no driverPayoutId / merchantPayoutId / cashPayoutBatchId / returnDeductionBatchId

        history: {
          create: [
            {
              action: "Order Created",
              location: "ASSIGNED",
              driverId: driverProfile.id,
              userId: creator.id,
            },
            {
              action: "Assigned to Driver (Duplicate of " + SOURCE_ORDER_ID + ")",
              location: "ASSIGNED",
              driverId: driverProfile.id,
              userId: creator.id,
            },
          ],
        },
      },
      include: {
        driver: { select: { driverId: true } },
      },
    });
  });

  console.log(`\n✓ Created ${created.orderId} (DB id ${created.id})`);
  console.log(`  driver:    ${created.driver?.driverId}`);
  console.log(`  location:  ${created.location}, financial: ${created.financialStatus}`);
  console.log(`  trackToken: ${created.trackToken}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect().catch(() => {});
});
