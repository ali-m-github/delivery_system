/**
 * fix-date-received-24-8-2026.ts
 *
 * One-off data fix: change "Date Received" from 2026-08-21 → 2026-08-24
 * for 22 orders (5219-2906…5219-2921, 10007823-25, 10007351-53).
 *
 * The UI renders "Date Received" from Order.createdAt (e.g.
 * app/print/orders/page.tsx, app/drivers/[id]/page.tsx), and the
 * bulk-import API writes `dateReceived` into `createdAt`
 * (app/api/orders/route.ts). So updating `createdAt` is the fix.
 *
 * Pre-flight validation aborts BEFORE any write. All writes happen
 * in a single $transaction (per-order updates, +3 days preserves the
 * original time-of-day exactly).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORDER_IDS = [
  "5219-2906",
  "5219-2907",
  "5219-2908",
  "5219-2909",
  "5219-2910",
  "5219-2911",
  "5219-2912",
  "5219-2913",
  "5219-2914",
  "5219-2915",
  "5219-2916",
  "5219-2917",
  "5219-2918",
  "5219-2919",
  "5219-2920",
  "5219-2921",
  "10007823",
  "10007824",
  "10007825",
  "10007351",
  "10007352",
  "10007353",
] as const;

const OLD_DATE = "2026-08-21";
const NEW_DATE = "2026-08-24";
const THREE_DAYS_MS = 3 * 86400 * 1000;

function assert(cond: any, msg?: string): asserts cond {
  if (!cond) {
    console.error(`ERROR: ${msg}. Aborting — no writes performed.`);
    process.exit(1);
  }
}

const datePart = (d: Date) => d.toISOString().split("T")[0];

async function main() {
  // ── 1. Load + validate current state (before any write) ─────────────────
  const orders = await prisma.order.findMany({
    where: { orderId: { in: [...ORDER_IDS] } },
    select: { id: true, orderId: true, createdAt: true },
  });

  assert(
    orders.length === ORDER_IDS.length,
    `expected ${ORDER_IDS.length} target orders, found ${orders.length} — missing: ${
      ORDER_IDS.filter((id) => !orders.some((o) => o.orderId === id)).join(", ") || "none"
    }`,
  );

  for (const o of orders) {
    assert(
      datePart(o.createdAt) === OLD_DATE,
      `${o.orderId}: createdAt is ${o.createdAt.toISOString()}, expected date ${OLD_DATE}`,
    );
  }

  console.log(`── BEFORE ─────────────────────────────────────────────────────`);
  for (const o of orders) {
    console.log(`${o.orderId}: createdAt=${o.createdAt.toISOString()}`);
  }

  // ── 2. Write: single transaction, +3 days per order (preserves time-of-day)
  await prisma.$transaction(
    orders.map((o) =>
      prisma.order.update({
        where: { id: o.id },
        data: { createdAt: new Date(o.createdAt.getTime() + THREE_DAYS_MS) },
      }),
    ),
  );

  // ── 3. AFTER report ──────────────────────────────────────────────────────
  const after = await prisma.order.findMany({
    where: { orderId: { in: [...ORDER_IDS] } },
    select: { orderId: true, createdAt: true },
  });

  console.log(`\n── AFTER ──────────────────────────────────────────────────────`);
  for (const o of after) {
    console.log(`${o.orderId}: createdAt=${o.createdAt.toISOString()}`);
  }

  for (const o of after) {
    assert(
      datePart(o.createdAt) === NEW_DATE,
      `${o.orderId}: post-fix createdAt is ${o.createdAt.toISOString()}, expected date ${NEW_DATE}`,
    );
  }
  console.log(`\n✓ ${after.length}/${ORDER_IDS.length} orders now dated ${NEW_DATE}.`);
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
