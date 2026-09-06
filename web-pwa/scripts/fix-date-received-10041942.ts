/**
 * fix-date-received-10041942.ts
 *
 * One-off data fix for order 10041942:
 *   1. Change "Date Received" (Order.createdAt) to 2026-08-22 (22/8/2026).
 *      The UI renders "Date Received" from Order.createdAt and the
 *      import API writes `dateReceived` into `createdAt` as UTC midnight
 *      (app/api/orders/route.ts), so this order (created 2026-09-05 via
 *      import without backdating) gets 2026-08-22T00:00:00.000Z.
 *   2. Repair the corrupted orderId: it was stored as "\t 10041942"
 *      (leading tab + spaces from the source sheet), which breaks
 *      exact-ID lookups. Trimmed to "10041942".
 *
 * Pre-flight validation aborts BEFORE any write. All writes happen
 * in a single $transaction.
 *
 * Run: npx -y tsx scripts/fix-date-received-10041942.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DIRTY_ORDER_ID = "\t 10041942"; // exact stored value (tab + 2 spaces)
const CLEAN_ORDER_ID = "10041942";
const NEW_RECEIVED_DATE = "2026-08-22"; // 22/8/2026 (DD/MM/YYYY)

function assert(cond: any, msg?: string): asserts cond {
  if (!cond) {
    console.error(`ERROR: ${msg}. Aborting — no writes performed.`);
    process.exit(1);
  }
}

async function main() {
  // ── 1. Load + validate current state (before any write) ─────────────────
  const order = await prisma.order.findUnique({
    where: { orderId: DIRTY_ORDER_ID },
    select: { id: true, orderId: true, createdAt: true, financialStatus: true },
  });

  assert(order, `order with orderId ${JSON.stringify(DIRTY_ORDER_ID)} not found`);

  const collision = await prisma.order.findUnique({
    where: { orderId: CLEAN_ORDER_ID },
    select: { id: true },
  });
  assert(
    !collision || collision.id === order.id,
    `clean orderId ${JSON.stringify(CLEAN_ORDER_ID)} is already used by another order — aborting trim`,
  );

  console.log(`── BEFORE ─────────────────────────────────────────────────────`);
  console.log(`orderId: ${JSON.stringify(order.orderId)}`);
  console.log(`createdAt: ${order.createdAt.toISOString()}`);
  console.log(`financialStatus: ${order.financialStatus}`);

  // ── 2. Write: single transaction ─────────────────────────────────────────
  const updated = await prisma.$transaction(async (tx) => {
    return tx.order.update({
      where: { id: order!.id },
      data: {
        createdAt: new Date(`${NEW_RECEIVED_DATE}T00:00:00.000Z`),
        orderId: CLEAN_ORDER_ID,
      },
      select: { id: true, orderId: true, createdAt: true },
    });
  });

  // ── 3. AFTER report + verify ─────────────────────────────────────────────
  const after = await prisma.order.findUnique({
    where: { orderId: CLEAN_ORDER_ID },
    select: { orderId: true, createdAt: true },
  });

  console.log(`\n── AFTER ──────────────────────────────────────────────────────`);
  console.log(`orderId: ${JSON.stringify(after?.orderId)}`);
  console.log(`createdAt: ${after?.createdAt.toISOString()}`);

  assert(
    after && after.orderId === CLEAN_ORDER_ID &&
      after.createdAt.toISOString().split("T")[0] === NEW_RECEIVED_DATE,
    `post-fix state mismatch`,
  );

  console.log(`\n✓ ${CLEAN_ORDER_ID} now dated ${NEW_RECEIVED_DATE} (date received), orderId cleaned up.`);
  void updated;
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
