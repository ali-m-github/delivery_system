/**
 * restore-libanex-adoptions-5272-23-10-2026.ts
 *
 * One-off fix: re-create the 193 LibanexLink rows that
 * revert-libanex-import-5272-23-10-2026.ts removed for PRE-EXISTING PWA
 * orders of seller "5272" (the "adoption" links from the 2026-10-23 13:31
 * import run).
 *
 * Why
 * ---
 * Without a LibanexLink, the 30-minute sync ignores the order: a delivery
 * made on Libanex would no longer appear here. The reverted IMPORT created
 * duplicates, but the links themselves were correct, so they are restored.
 *
 * How it finds them
 * -----------------
 * Every Libanex order of seller 5272 whose order_id equals an existing PWA
 * Order.orderId and which has NO LibanexLink right now. (The 9 links created
 * 16–21 Oct and the 3 links from the 13:57 re-import are already linked and
 * therefore skipped.)
 *
 * The recreated links carry lastHistoryStamp = now(), exactly like
 * exportOrdersToLibanex does, so the sync starts tracking from NOW and does
 * not replay old Libanex history into the orders' timelines. Status changes
 * from now on (Delivered, Return, amounts) sync normally.
 *
 * Safety
 * ------
 *   - Dry-run by default. Pass APPLY=1 to actually write.
 *   - Touches ONLY LibanexLink rows; no Order is modified.
 *
 * Usage
 * -----
 *   DRY RUN : npx tsx scripts/restore-libanex-adoptions-5272-23-10-2026.ts
 *   APPLY   : APPLY=1 npx tsx scripts/restore-libanex-adoptions-5272-23-10-2026.ts
 */
import { PrismaClient } from "@prisma/client";
import { libanexGet, type LibanexOrder } from "../lib/libanexSync";

const prisma = new PrismaClient();

const SELLER_ID = "5272";
const PAGE_LIMIT = 500;
const MAX_ORDERS = 10000;

const APPLY = process.env.APPLY === "1";

async function fetchAllOrders(sellerId: string): Promise<LibanexOrder[]> {
  const out: LibanexOrder[] = [];
  for (let offset = 0; offset < MAX_ORDERS; offset += PAGE_LIMIT) {
    const body = await libanexGet("orders.php", {
      seller_id: sellerId,
      limit: String(PAGE_LIMIT),
      offset: String(offset),
    });
    out.push(...(body.data as LibanexOrder[]));
    if (body.pagination.returned < PAGE_LIMIT) break;
  }
  return out;
}

async function main() {
  console.log(`── MODE: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"} ──\n`);

  const lxOrders = await fetchAllOrders(SELLER_ID);
  console.log(`Libanex orders for seller ${SELLER_ID}: ${lxOrders.length}`);

  const existing = await prisma.order.findMany({
    where: { orderId: { in: lxOrders.map((o) => o.order_id) } },
    select: { id: true, orderId: true, location: true, financialStatus: true },
  });
  const byOrderId = new Map(existing.map((o) => [o.orderId, o]));

  const linked = await prisma.libanexLink.findMany({
    where: { libanexOrderId: { in: lxOrders.map((o) => o.order_id) } },
    select: { libanexOrderId: true },
  });
  const linkedSet = new Set(linked.map((l) => l.libanexOrderId));

  const toRestore = lxOrders.filter(
    (lx) => byOrderId.has(lx.order_id) && !linkedSet.has(lx.order_id),
  );

  console.log(`\nAlready linked (skipped):            ${linkedSet.size}`);
  console.log(`Unlinked but existing in PWA:        ${toRestore.length}  ← these get re-linked`);
  console.log(`Not in the PWA at all (left alone):  ${lxOrders.length - toRestore.length - linkedSet.size}`);

  console.log(`\nSample of links to create (first 10):`);
  for (const lx of toRestore.slice(0, 10)) {
    const o = byOrderId.get(lx.order_id)!;
    console.log(`  ${lx.order_id} → PWA ${o.orderId} (${o.location}/${o.financialStatus})`);
  }

  if (!APPLY) {
    console.log(`\nDry run complete. Re-run with APPLY=1 to re-create the links.`);
    return;
  }

  const now = new Date();
  let created = 0;
  for (const lx of toRestore) {
    const o = byOrderId.get(lx.order_id)!;
    await prisma.libanexLink.create({
      data: {
        libanexOrderId: lx.order_id,
        libanexSellerId: SELLER_ID,
        orderId: o.id,
        lastHistoryStamp: now, // don't replay old Libanex history into the timeline
        rawLocation: lx.location,
        rawFinStatus: lx.fin_status,
        lastSyncedAt: now,
      },
    });
    created++;
  }
  console.log(`\nCreated ${created} LibanexLink rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
