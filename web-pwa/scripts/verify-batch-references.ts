/**
 * Verify all CashPayoutBatch references follow the {sellerId}-{DDMMYYYY}
 * pattern using the same strategy as scripts/fix-cash-batch-references.ts:
 * single-day batches first (their only day), multi-day batches use their
 * LATEST order day; a suffix is only allowed when a batch's order days are
 * all already claimed by other batches of the same seller.
 * Usage: npx tsx scripts/verify-batch-references.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const dayKey = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${d.getFullYear()}`;

async function main() {
  const batches = await prisma.cashPayoutBatch.findMany({
    orderBy: [{ merchantId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      merchant: { select: { merchantId: true, merchantName: true } },
      orders: { select: { createdAt: true } },
      resolvedReturns: { select: { createdAt: true } },
    },
  });

  console.log(`Total cash payout batches: ${batches.length}\n`);

  // Recompute the expected reference per the same deterministic algorithm
  const bySeller = new Map<number, typeof batches>();
  for (const b of batches) {
    const s = b.merchant.merchantId;
    if (!bySeller.has(s)) bySeller.set(s, []);
    bySeller.get(s)!.push(b);
  }

  const expected = new Map<number, string>();
  for (const [sellerId, sellerBatches] of bySeller) {
    const used = new Set<string>();
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

    for (const b of sellerBatches.filter((b) => orderDays(b).length === 1)) {
      const day = orderDays(b)[0];
      if (!used.has(day)) {
        used.add(day);
        expected.set(b.id, `${sellerId}-${day}`);
      }
    }
    for (const b of sellerBatches.filter((b) => orderDays(b).length > 1)) {
      const days = orderDays(b);
      let chosen: string | null = null;
      for (let i = days.length - 1; i >= 0; i--) {
        if (!used.has(days[i])) {
          chosen = days[i];
          break;
        }
      }
      if (chosen) {
        used.add(chosen);
        expected.set(b.id, `${sellerId}-${chosen}`);
      }
    }
    for (const b of sellerBatches) {
      if (expected.has(b.id)) continue;
      const latest = orderDays(b)[orderDays(b).length - 1];
      let seq = 2;
      let candidate = `${sellerId}-${latest}-${seq}`;
      while (used.has(candidate)) {
        seq++;
        candidate = `${sellerId}-${latest}-${seq}`;
      }
      used.add(candidate);
      expected.set(b.id, candidate);
    }
  }

  let mismatches = 0;
  for (const b of batches) {
    const exp = expected.get(b.id)!;
    const matches = b.batchReference === exp;
    if (!matches) mismatches++;
    console.log(
      `${matches ? "OK " : "BAD"} id=${String(b.id).padStart(3)} seller=${b.merchant.merchantId} ref=${b.batchReference.padEnd(15)} expected=${exp} (${b.merchant.merchantName})`,
    );
  }

  console.log(`\n${mismatches === 0 ? "ALL" : `${mismatches} `}match(es).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Fatal:", e);
  prisma.$disconnect();
  process.exit(1);
});
