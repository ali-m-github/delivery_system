/**
 * Update CashPayoutBatch references to the {merchantId}-{DDMMYYYY} pattern,
 * where DDMMYYYY is the date of the ORDERS (not the payout recording date).
 *
 * Naming strategy (matches the POST /cash-payouts route):
 *  - Single-day batches (orders all from one day) are assigned their day first.
 *  - Multi-day batches use their LATEST order day (the batch is "for orders up
 *    to" that date), so late-recorded payouts reference the order date.
 *  - Only when a batch's order days are all already taken by other batches for
 *    the same seller does it keep a sequence suffix (-2, -3, ...), because
 *    batchReference has a UNIQUE constraint.
 *
 * Example: 8-29072026 (seller ID 8, latest order from 29/07/2026).
 *
 * Usage: npx tsx scripts/fix-cash-batch-references.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const dayKey = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${d.getFullYear()}`;

async function fixCashBatchReferences() {
  console.log(
    "Fetching all CashPayoutBatch records with merchant and order info...",
  );

  const batches = await prisma.cashPayoutBatch.findMany({
    include: {
      merchant: { select: { merchantId: true } },
      orders: { select: { createdAt: true } },
      resolvedReturns: { select: { createdAt: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  // Group batches by seller
  const bySeller = new Map<number, typeof batches>();
  for (const b of batches) {
    const s = b.merchant.merchantId;
    if (!bySeller.has(s)) bySeller.set(s, []);
    bySeller.get(s)!.push(b);
  }

  let totalFixed = 0;

  for (const [sellerId, sellerBatches] of bySeller) {
    const usedDays = new Set<string>(); // day keys already assigned for seller
    const result = new Map<number, string>(); // batchId -> new reference

    // Distinct order days per batch (fall back to batch createdAt if no orders),
    // sorted chronologically by the underlying timestamp.
    const orderDays = (b: (typeof batches)[0]): string[] => {
      const all = [
        ...b.orders.map((o) => o.createdAt),
        ...b.resolvedReturns.map((o) => o.createdAt),
      ];
      if (!all.length) return [dayKey(b.createdAt)];
      const seen = new Map<number, string>();
      for (const d of all) {
        const startOfDay = new Date(
          d.getFullYear(),
          d.getMonth(),
          d.getDate(),
        ).getTime();
        if (!seen.has(startOfDay)) seen.set(startOfDay, dayKey(d));
      }
      return [...seen.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, k]) => k);
    };

    // 1. Single-day batches get their only day first (they have no choice)
    const single = sellerBatches.filter((b) => orderDays(b).length === 1);
    for (const b of single) {
      const day = orderDays(b)[0];
      if (!usedDays.has(day)) {
        usedDays.add(day);
        result.set(b.id, `${sellerId}-${day}`);
      }
    }

    // 2. Multi-day batches pick their LATEST free order day
    const multi = sellerBatches.filter((b) => orderDays(b).length > 1);
    for (const b of multi) {
      const days = orderDays(b);
      let chosen: string | null = null;
      for (let i = days.length - 1; i >= 0; i--) {
        if (!usedDays.has(days[i])) {
          chosen = days[i];
          break;
        }
      }
      if (chosen) {
        usedDays.add(chosen);
        result.set(b.id, `${sellerId}-${chosen}`);
      }
    }

    // 3. Any batch whose days were all taken keeps a suffix on its latest day
    for (const b of sellerBatches) {
      if (result.has(b.id)) continue;
      const days = orderDays(b);
      const latest = days[days.length - 1];
      let seq = 2;
      let candidate = `${sellerId}-${latest}-${seq}`;
      while (usedDays.has(candidate)) {
        seq++;
        candidate = `${sellerId}-${latest}-${seq}`;
      }
      usedDays.add(candidate);
      result.set(b.id, candidate);
    }

    // 4. Persist changes with a two-phase rename so a target reference that is
    //    still held by another (not-yet-renamed) batch never collides with the
    //    UNIQUE constraint. Phase A moves each changed batch to a temporary
    //    unique reference; Phase B writes the final reference.
    const changed = sellerBatches.filter(
      (b) => result.get(b.id)! !== b.batchReference,
    );
    if (!changed.length) continue;

    for (const b of changed) {
      await prisma.cashPayoutBatch.update({
        where: { id: b.id },
        data: { batchReference: `__TMP__${b.id}` },
      });
    }
    for (const b of changed) {
      const newReference = result.get(b.id)!;
      await prisma.cashPayoutBatch.update({
        where: { id: b.id },
        data: { batchReference: newReference },
      });
      totalFixed++;
      console.log(
        `  Updated batch ${b.id} → ${newReference} (was: ${b.batchReference})`,
      );
    }
  }

  console.log(`\nDone. Total batches updated: ${totalFixed}`);
  await prisma.$disconnect();
}

fixCashBatchReferences().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect();
  process.exit(1);
});
