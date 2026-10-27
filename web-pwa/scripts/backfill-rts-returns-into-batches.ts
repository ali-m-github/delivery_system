/**
 * One-off repair: wrap orphan "Returned to Seller" orders into ReturnBatch rows.
 *
 * Background: the Returns-tab "Returned to Seller" button used to perform a
 * BARE status flip (Re/EX → RTS) with no ReturnBatch. Those orders then fell
 * out of the cash-payout GET's pending-returns query (which requires
 * returnBatchId = null only for the legacy path AND is superseded by batch
 * cards) — worse, they were never attached to any settlement unit, so they
 * could drift through payouts unnoticed. The button now creates proper
 * ReturnBatch rows (app/api/admin/return-batches/route.ts POST).
 *
 * This script fixes the historical damage:
 *   orphans = financialStatus "RTS" AND location "RETURN"
 *             AND returnBatchId IS NULL AND returnDeductionBatchId IS NULL
 *
 * It groups them per merchant and creates ONE ReturnBatch per merchant
 * (status PENDING, so the cash-seller workspace immediately offers it as a
 * settlement card — same as scanner-created batches). Batch numbers follow
 * the live format "Returns-M<merchantId>-<YYYYMMDD-HHmm>" using the EARLIEST
 * order's creation time in Beirut wall-clock ("backdated"), plus a
 * "-BACKFILL" marker so repaired batches are unmistakable in the UI and can
 * never collide with a real scanner batch created at the same minute.
 *
 * Orders keep financialStatus RTS + the "R" orderId suffix (already applied
 * by the old flip) — only returnBatchId is set, so the deduction path in
 * POST /api/admin/merchants/[id]/cash-payouts treats them identically to
 * scanner batches (amountUsd − fee per order, $0 for "-Exchange" proofs).
 * No OrderHistory rows are written: each order already has its RTS history
 * entry from the original flip.
 *
 * Idempotent: re-running finds nothing new (orphans are exactly the
 * unbatched/unsettled rows).
 *
 * Usage:
 *   npx tsx scripts/backfill-rts-returns-into-batches.ts            # dry run
 *   npx tsx scripts/backfill-rts-returns-into-batches.ts --apply    # writes
 */

import { PrismaClient } from "@prisma/client";
import { beirutBatchTimestamp } from "../lib/sequences";

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`ERROR: ${msg}. Aborting — no writes performed.`);
    process.exit(1);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    apply
      ? "MODE: APPLY (will write ReturnBatch rows + link orders)"
      : "MODE: DRY RUN (pass --apply to write)",
  );

  // ── 1. Find the orphans ────────────────────────────────────────────────────
  const orphans = await prisma.order.findMany({
    where: {
      financialStatus: "RTS",
      location: "RETURN",
      returnBatchId: null,
      returnDeductionBatchId: null,
      isArchived: false,
    },
    select: {
      id: true,
      orderId: true,
      amountUsd: true,
      createdAt: true,
      merchantId: true,
      merchant: {
        select: { id: true, merchantId: true, merchantName: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\nFound ${orphans.length} orphan RTS return order(s).`);

  const unmerchanted = orphans.filter((o) => !o.merchantId);
  if (unmerchanted.length > 0) {
    console.log(
      `  SKIP ${unmerchanted.length} order(s) with no merchant attached: ${unmerchanted
        .map((o) => o.orderId)
        .join(", ")}`,
    );
  }

  // ── 2. Group per merchant ──────────────────────────────────────────────────
  const byMerchant = new Map<
    string,
    {
      merchantId: string; // numeric merchant id (for the batch-number label)
      merchantName: string;
      orders: typeof orphans;
    }
  >();
  for (const o of orphans) {
    if (!o.merchantId || !o.merchant) continue;
    const entry = byMerchant.get(o.merchantId) ?? {
      merchantId: String(o.merchant.merchantId),
      merchantName: o.merchant.merchantName,
      orders: [],
    };
    entry.orders.push(o);
    byMerchant.set(o.merchantId, entry);
  }

  console.log(`Grouped into ${byMerchant.size} merchant(s):`);
  for (const [dbId, group] of byMerchant) {
    const earliest = group.orders[0].createdAt;
    console.log(
      `  M${group.merchantId} ${group.merchantName} (${dbId}): ${group.orders.length} order(s), oldest ${earliest.toISOString()}`,
    );
  }

  if (!apply) {
    console.log(
      `\nDry run complete — ${byMerchant.size} batch(es) WOULD be created. Re-run with --apply.`,
    );
    return;
  }

  // ── 3. Create one PENDING ReturnBatch per merchant ─────────────────────────
  let created = 0;
  let linked = 0;
  for (const [dbId, group] of byMerchant) {
    assert(group.orders.length > 0, `empty group for merchant ${dbId}`);

    // Backdated base number from the oldest order, marked as a repair batch.
    const base = `Returns-M${group.merchantId}-${beirutBatchTimestamp(
      group.orders[0].createdAt,
    )}-BACKFILL`;

    // Guarantee uniqueness of the @unique batchNumber without a retry loop:
    // check what's taken and step the suffix forward.
    const taken = new Set(
      (
        await prisma.returnBatch.findMany({
          where: { batchNumber: { startsWith: base } },
          select: { batchNumber: true },
        })
      ).map((b) => b.batchNumber),
    );
    let batchNumber = taken.has(base) ? `${base}-2` : base;
    let suffix = 2;
    while (taken.has(batchNumber)) {
      suffix += 1;
      batchNumber = `${base}-${suffix}`;
    }

    const orderIds = group.orders.map((o) => o.id);

    const batch = await prisma.$transaction(async (tx) => {
      const b = await tx.returnBatch.create({
        data: {
          batchNumber,
          merchantId: dbId,
          totalOrders: orderIds.length,
          status: "PENDING",
        },
      });

      // CAS: only link rows that are STILL unbatched/unsettled, so a payout
      // settling any of them concurrently simply results in fewer links.
      const res = await tx.order.updateMany({
        where: {
          id: { in: orderIds },
          returnBatchId: null,
          returnDeductionBatchId: null,
        },
        data: { returnBatchId: b.id },
      });

      console.log(
        `  ✓ ${batchNumber}: created, linked ${res.count}/${orderIds.length} order(s)`,
      );
      created += 1;
      linked += res.count;
      return b;
    });

    void batch; // referenced only for the transaction wrapper
  }

  console.log(
    `\nDone: ${created} ReturnBatch(es) created, ${linked}/${orphans.length - unmerchanted.length} order(s) linked.`,
  );
  console.log(
    "Each batch is PENDING — it will appear as a settlement card in that seller's cash-payout workspace.",
  );
}

main()
  .catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
