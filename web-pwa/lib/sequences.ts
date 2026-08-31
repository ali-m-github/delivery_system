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
