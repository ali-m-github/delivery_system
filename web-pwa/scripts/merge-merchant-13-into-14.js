/**
 * merge-merchant-13-into-14.js
 *
 * Consolidates the duplicate "Alexa Cosmetics" seller ledgers into a single
 * merchant (#14), which already owns:
 *   - the 7 CP orders (14-0001..14-0007)
 *   - the login account (username: alexacosmetics, email: alexacosmetics@gmail.com)
 *
 * What it does:
 *   1. Asserts merchant 13 is truly empty (no orders, zone rates, payout
 *      batches, driver rates, or linked user). Aborts otherwise.
 *   2. Copies merchant 13's business profile (name, contact, phone, address,
 *      logo) and cash-seller settings (isCashSeller, defaultSellerRate,
 *      defaultProfitRate) onto merchant 14 so none of that config is lost.
 *   3. Deletes merchant 13.
 *
 * The whole operation runs in one transaction and is idempotent-safe: if
 * merchant 13 no longer exists the script exits without doing anything.
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const M14_ID = "244b2a2f-b02f-4d00-9d9f-e9786d9af9ed"; // #14 alexacosmetics (keeps account + orders)
const M13_NUM = 13; // "Alexa Cosmetics" (the orphaned duplicate)

async function main() {
  const source = await prisma.merchant.findUnique({
    where: { merchantId: M13_NUM },
  });
  if (!source) {
    console.log("Merchant #13 not found — nothing to do. Exiting.");
    return;
  }

  const target = await prisma.merchant.findUnique({
    where: { id: M14_ID },
    include: { user: { select: { username: true, email: true, role: true } } },
  });
  if (!target) {
    throw new Error(`Target merchant ${M14_ID} not found — aborting.`);
  }

  // ── Safety checks: merchant 13 must be empty ──────────────────────────
  const counts = await Promise.all([
    prisma.order.count({ where: { merchantId: source.id } }),
    prisma.merchantZoneRate.count({ where: { merchantId: source.id } }),
    prisma.cashPayoutBatch.count({ where: { merchantId: source.id } }),
    prisma.merchantPayout.count({ where: { merchantId: source.id } }),
    prisma.driverSellerRate.count({ where: { merchantId: source.id } }),
    prisma.driverCashSellerRate.count({ where: { merchantId: source.id } }),
  ]);
  const [orders, zoneRates, cashBatches, payouts, drvSeller, drvCash] = counts;
  console.log(
    `Merchant 13 occupancy -> orders: ${orders}, zoneRates: ${zoneRates}, ` +
      `cashBatches: ${cashBatches}, payouts: ${payouts}, ` +
      `driverSellerRates: ${drvSeller}, driverCashSellerRates: ${drvCash}`,
  );
  if (
    orders + zoneRates + cashBatches + payouts + drvSeller + drvCash !== 0 ||
    source.userId
  ) {
    throw new Error(
      "Merchant 13 still holds data or a linked user — refusing to delete. " +
        "Move the records to merchant 14 manually first.",
    );
  }
  if (target.userId === null) {
    throw new Error(
      "Target merchant 14 has no linked user — aborting to avoid unlinking the account.",
    );
  }

  // ── Merge (single transaction) ─────────────────────────────────────────
  const result = await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction; the inner state is authoritative.
    const freshSource = await tx.merchant.findUnique({
      where: { id: source.id },
    });
    if (!freshSource) {
      throw new Error("Source merchant disappeared mid-transaction.");
    }
    const freshOrders = await tx.order.count({
      where: { merchantId: freshSource.id },
    });
    if (freshOrders > 0) {
      throw new Error(
        "Orders appeared on merchant 13 since the pre-check — aborting.",
      );
    }

    await tx.merchant.update({
      where: { id: target.id },
      data: {
        merchantName: freshSource.merchantName,
        contactName: freshSource.contactName ?? target.contactName,
        phone: freshSource.phone ?? target.phone,
        address: freshSource.address ?? target.address,
        socialMedia: freshSource.socialMedia ?? target.socialMedia,
        logoUrl: freshSource.logoUrl ?? target.logoUrl,
        isCashSeller: freshSource.isCashSeller,
        defaultSellerRate: freshSource.defaultSellerRate,
        defaultProfitRate: freshSource.defaultProfitRate,
      },
    });

    await tx.merchant.delete({ where: { id: freshSource.id } });
  });

  const final = await prisma.merchant.findUnique({
    where: { id: M14_ID },
    select: {
      merchantId: true,
      merchantName: true,
      contactName: true,
      phone: true,
      address: true,
      logoUrl: true,
      isCashSeller: true,
      defaultSellerRate: true,
      defaultProfitRate: true,
      user: { select: { username: true, email: true } },
    },
  });
  console.log("Done. Merged into:", JSON.stringify(final, null, 2));
  console.log("Merchant 13 deleted:", result !== undefined);
}

main()
  .catch((e) => {
    console.error("MIGRATION FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
