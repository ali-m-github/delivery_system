import type { PrismaClient, Prisma } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Allocate the next treasury transaction reference number.
 *
 * Uses a PostgreSQL SEQUENCE (`treasury_transaction_reference_seq`) so the
 * value is:
 *   - O(1) (no O(N) scan of TreasuryTransaction),
 *   - atomic (nextval() is serialized by the sequence engine itself),
 *   - safe under deletion (gaps are allowed; values are never reused),
 *   - gap-free in the common case.
 *
 * The sequence must exist and be seeded (see scripts/migrate-treasury-integrity.sql).
 * Calling this inside a Prisma interactive transaction runs it on the same
 * underlying PostgreSQL transaction.
 */
export async function nextTreasuryReference(tx: DbClient): Promise<string> {
  const rows = (await tx.$queryRaw`SELECT nextval('treasury_transaction_reference_seq') AS n`) as unknown as {
    n: number | bigint;
  }[];
  return String(rows[0].n);
}

/**
 * Allocate the next merchant pickup-batch number in the form "PKB-1001".
 *
 * Mirrors `generateMerchantOrderId` in app/api/merchant/orders/route.ts: the
 * value is derived from the highest existing batchNumber, so deletions never
 * reuse a number. `PickupBatch.batchNumber` is @unique, so two concurrent
 * requests that read the same max collide on insert — callers must retry
 * (see the P2002 loop in app/api/merchant/pickup-batches/route.ts).
 */
export async function nextPickupBatchNumber(tx: DbClient): Promise<string> {
  const rows = (await tx.$queryRaw`
    SELECT COALESCE(MAX((substring("batchNumber" from '^PKB-([0-9]+)$'))::int), 1000) AS n
    FROM "PickupBatch"
  `) as unknown as { n: number | bigint }[];
  return `PKB-${Number(rows[0].n) + 1}`;
}
