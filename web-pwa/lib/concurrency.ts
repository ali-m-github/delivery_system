import { Prisma } from "@prisma/client";

/**
 * Raised when a CAS (compare-and-swap) update matched 0 rows, i.e. another
 * request changed the row between our read and our write. Callers catch it
 * and re-run the whole unit of work.
 */
export class ConcurrencyConflictError extends Error {
  constructor(message = "Concurrent modification detected") {
    super(message);
    this.name = "ConcurrencyConflictError";
  }
}

/**
 * True for errors that are safe to retry the whole transaction for:
 *  - P2002: unique constraint violation (lost a race on a generated identifier)
 *  - P2034: transaction isolation level / serialization rollback (deadlock)
 *  - ConcurrencyConflictError: our own CAS guard failed
 *
 * We do NOT retry P2025 (record not found) or validation errors: those mean
 * the input is genuinely wrong, not that a concurrent request interfered.
 */
export function isRetryableConcurrencyError(err: unknown): boolean {
  if (err instanceof ConcurrencyConflictError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === "P2002" || err.code === "P2034";
  }
  return false;
}

/**
 * Run an async transactional unit of work, retrying on retryable concurrency
 * errors (unique violations / serialization rollbacks / CAS conflicts).
 *
 * Each attempt must be a fully self-contained transaction: the callback
 * receives a FRESH transaction client and must re-read every row it relies on.
 *
 * @param run       async fn that performs one attempt (it opens its own tx)
 * @param attempts  total attempts, default 3
 */
export async function withConcurrencyRetries<T>(
  run: () => Promise<T>,
  attempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run();
    } catch (err) {
      lastError = err;
      if (!isRetryableConcurrencyError(err) || attempt === attempts) {
        throw err;
      }
      // small backoff so simultaneous claimants desynchronize
      await new Promise((r) => setTimeout(r, 15 * attempt));
    }
  }
  // unreachable, but satisfies TypeScript
  throw lastError;
}
