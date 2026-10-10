/**
 * fix-date-received-2-0001.ts
 *
 * One-off data fix for order 2-0001:
 *   Change "Date Received" (Order.createdAt) to 2026-10-08 (8/10/2026).
 *   The UI renders "Date Received" from Order.createdAt and the
 *   import API writes `dateReceived` into `createdAt` as UTC midnight
 *   (app/api/orders/route.ts), so we set 2026-10-08T00:00:00.000Z.
 *
 * Pre-flight validation aborts BEFORE any write. All writes happen
 * in a single $transaction.
 *
 * Run: npx -y tsx scripts/fix-date-received-2-0001.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGET_ORDER_ID = "2-0001";
const NEW_RECEIVED_DATE = "2026-10-08"; // 8/10/2026 (DD/MM/YYYY)

function assert(cond: any, msg?: string): asserts cond {
  if (!cond) {
    console.error(`ERROR: ${msg}. Aborting — no writes performed.`);
    process.exit(1);
  }
}

async function main() {
  // ── 1. Load + validate current state (before any write) ─────────────────
  const order = await prisma.order.findUnique({
    where: { orderId: TARGET_ORDER_ID },
    select: { id: true, orderId: true, createdAt: true, financialStatus: true },
  });

  assert(order, `order with orderId ${JSON.stringify(TARGET_ORDER_ID)} not found`);

  console.log(`── BEFORE ─────────────────────────────────────────────────────`);
  console.log(`orderId: ${JSON.stringify(order.orderId)}`);
  console.log(`createdAt: ${order.createdAt.toISOString()}`);
  console.log(`financialStatus: ${order.financialStatus}`);

  // ── 2. Write: single transaction ─────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    return tx.order.update({
      where: { id: order!.id },
      data: {
        createdAt: new Date(`${NEW_RECEIVED_DATE}T00:00:00.000Z`),
      },
      select: { id: true, orderId: true, createdAt: true },
    });
  });

  // ── 3. AFTER report + verify ─────────────────────────────────────────────
  const after = await prisma.order.findUnique({
    where: { orderId: TARGET_ORDER_ID },
    select: { orderId: true, createdAt: true },
  });

  console.log(`\n── AFTER ──────────────────────────────────────────────────────`);
  console.log(`orderId: ${JSON.stringify(after?.orderId)}`);
  console.log(`createdAt: ${after?.createdAt.toISOString()}`);

  assert(
    after && after.orderId === TARGET_ORDER_ID &&
      after.createdAt.toISOString().split("T")[0] === NEW_RECEIVED_DATE,
    `post-fix state mismatch`,
  );

  console.log(`\n✓ ${TARGET_ORDER_ID} now dated ${NEW_RECEIVED_DATE} (date received).`);
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
