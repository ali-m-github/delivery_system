/**
 * fix-addresses-seller-15-28-9-2026.ts
 *
 * One-off data fix: replace placeholder customer addresses
 * ("Cust Premises" / "Co. Warehouse") with the real delivery addresses
 * provided in the seller's sheet, for 16 orders of seller #15
 * (merchantId = 15, tinaeternelleecheritage), dated 28/9/2026.
 *
 * The change is address-only — no price/amount, zone, or payout impact.
 * Each update also writes an OrderHistory entry in the same format the
 * generic order-edit API uses:
 *   Address: '<old>' -> '<new>'
 *
 * Safety
 * ------
 *   - Dry-run by default. Pass APPLY=1 to actually write.
 *   - Pre-flight aborts BEFORE any write if: an order is missing, an order
 *     does not belong to seller #15, or an order already holds a real
 *     (non-placeholder) address that differs from the target — so we never
 *     clobber existing data.
 *   - All writes run in a single $transaction.
 *
 * Usage
 * -----
 *   DRY RUN : npx tsx scripts/fix-addresses-seller-15-28-9-2026.ts
 *   APPLY   : APPLY=1 npx tsx scripts/fix-addresses-seller-15-28-9-2026.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MERCHANT_MERCHANT_ID = 15; // seller #15 in the UI = Merchant.merchantId
const APPLY = process.env.APPLY === "1";

/** Addresses the importer writes when the sheet left the column blank. */
const PLACEHOLDERS = new Set(["Cust Premises", "Co. Warehouse"]);

/** orderId -> corrected address (values from the seller's sheet/image). */
const ADDRESS_FIXES: { orderId: string; address: string }[] = [
  { orderId: "5846-0714", address: "aitit madraset el reda" },
  { orderId: "5846-1828", address: "ramlet bayda" },
  { orderId: "5846-1950", address: "faraya qorb baladeye" },
  { orderId: "5846-1970", address: "chouifet qorb furn shamsine" },
  { orderId: "5846-2090", address: "dawra trombet abo 2artin" },
  { orderId: "5846-2197", address: "bir abed" },
  { orderId: "5846-3180", address: "clemencauce sherket nest lil mafroshet" },
  { orderId: "5846-3474", address: "zahle karak tht hamra plaza" },
  { orderId: "5846-4306", address: "bseba fo2 kfarshima qorb trombet medco" },
  { orderId: "5846-4584", address: "akkar halba" },
  { orderId: "5846-4794", address: "hasbaya" },
  { orderId: "5846-5048", address: "wadi jamous akkar" },
  { orderId: "5846-5225", address: "bekaa baalbeck mainroad" },
  { orderId: "5846-6377", address: "kfarouman" },
  { orderId: "5846-7849", address: "rweisat" },
  { orderId: "5846-9452", address: "trablos bab ramel" },
];

function assert(cond: any, msg?: string): asserts cond {
  if (!cond) {
    console.error(`ERROR: ${msg}. Aborting — no writes performed.`);
    process.exit(1);
  }
}

async function main() {
  console.log(`── MODE: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"} ──`);

  // ── 1. Resolve the seller ────────────────────────────────────────────────
  const merchant = await prisma.merchant.findUnique({
    where: { merchantId: MERCHANT_MERCHANT_ID },
    select: { id: true, merchantId: true, sellerNumber: true, merchantName: true },
  });
  assert(merchant, `no merchant with merchantId=${MERCHANT_MERCHANT_ID} found`);
  console.log(
    `Seller: #${merchant.merchantId} (sellerNumber=${merchant.sellerNumber}) "${merchant.merchantName}"`,
  );

  // ── 2. Load + validate current state (before any write) ─────────────────
  const orders = await prisma.order.findMany({
    where: { orderId: { in: ADDRESS_FIXES.map((f) => f.orderId) } },
    select: {
      id: true,
      orderId: true,
      customerName: true,
      customerAddress: true,
      location: true,
      merchantId: true,
    },
  });

  const missing = ADDRESS_FIXES.filter(
    (f) => !orders.some((o) => o.orderId === f.orderId),
  );
  assert(
    missing.length === 0,
    `missing orders: ${missing.map((f) => f.orderId).join(", ")}`,
  );

  for (const o of orders) {
    assert(
      o.merchantId === merchant.id,
      `${o.orderId} does not belong to seller #${MERCHANT_MERCHANT_ID}`,
    );
  }

  const toFix: { id: string; orderId: string; oldAddress: string; newAddress: string; location: string }[] = [];
  const alreadyCorrect: string[] = [];
  const unexpected: { orderId: string; oldAddress: string; newAddress: string }[] = [];

  for (const f of ADDRESS_FIXES) {
    const o = orders.find((x) => x.orderId === f.orderId)!;
    if (o.customerAddress === f.address) {
      alreadyCorrect.push(o.orderId);
    } else if (PLACEHOLDERS.has(o.customerAddress)) {
      toFix.push({
        id: o.id,
        orderId: o.orderId,
        oldAddress: o.customerAddress,
        newAddress: f.address,
        location: o.location,
      });
    } else {
      unexpected.push({
        orderId: o.orderId,
        oldAddress: o.customerAddress,
        newAddress: f.address,
      });
    }
  }

  // ── 3. Report BEFORE ─────────────────────────────────────────────────────
  console.log(`\n── PLANNED CHANGES (${toFix.length}) ─────────────────────────`);
  for (const c of toFix) {
    console.log(`  ${c.orderId}: "${c.oldAddress}" -> "${c.newAddress}"`);
  }
  if (alreadyCorrect.length > 0) {
    console.log(
      `\nAlready correct (skipped): ${alreadyCorrect.join(", ")}`,
    );
  }
  if (unexpected.length > 0) {
    console.log(`\n⚠ Orders with a NON-placeholder address (refusing to overwrite):`);
    for (const u of unexpected) {
      console.log(`  ${u.orderId}: current="${u.oldAddress}" target="${u.newAddress}"`);
    }
  }

  assert(
    unexpected.length === 0,
    "one or more orders already hold a real address that differs from the target",
  );

  if (toFix.length === 0) {
    console.log("\nNothing to update.");
    return;
  }

  if (!APPLY) {
    console.log(`\nDRY RUN complete — ${toFix.length} address(es) pending. Re-run with APPLY=1 to apply.`);
    return;
  }

  // ── 4. Write: single transaction + one history entry per order ───────────
  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
  });
  assert(adminUser !== null, "no ADMIN user found for history entries");

  await prisma.$transaction(async (tx) => {
    for (const c of toFix) {
      await tx.order.update({
        where: { id: c.id },
        data: {
          customerAddress: c.newAddress,
          history: {
            create: {
              action: `Address: '${c.oldAddress}' -> '${c.newAddress}'`,
              location: c.location,
              userId: adminUser.id,
            },
          },
        },
      });
    }
  });

  console.log("\n✓ Transaction committed.");

  // ── 5. AFTER report + verification ──────────────────────────────────────
  const after = await prisma.order.findMany({
    where: { id: { in: toFix.map((c) => c.id) } },
    select: { orderId: true, customerAddress: true },
  });

  console.log("\n── AFTER ──────────────────────────────────────────────────────");
  for (const o of after) {
    console.log(`  ${o.orderId}: "${o.customerAddress}"`);
  }

  for (const c of toFix) {
    const a = after.find((x) => x.orderId === c.orderId);
    assert(
      a?.customerAddress === c.newAddress,
      `${c.orderId}: post-fix address is "${a?.customerAddress}", expected "${c.newAddress}"`,
    );
  }

  console.log(`\n✓ ${after.length}/${toFix.length} addresses corrected.`);
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
