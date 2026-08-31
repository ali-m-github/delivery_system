-- ============================================================================
-- migrate-treasury-integrity.sql
--
-- Adds database-level integrity guarantees for payout / treasury processing:
--
--   1. UNIQUE "TreasuryTransaction"("reference")            -> TX reference IDs
--   2. UNIQUE "DriverPayout"("payoutReference")             -> D001-001 style IDs
--   3. UNIQUE "DriverPayout"("driverId","sequentialIndex")  -> per-driver sequence
--   4. UNIQUE "MerchantPayout"("sequentialIndex")           -> statement numbers
--   5. SEQUENCE treasury_transaction_reference_seq          -> O(1) atomic refs
--
-- SAFETY:
--   * Everything runs in ONE transaction; if the preflight or any DDL fails,
--     nothing is applied (DDL is transactional in PostgreSQL).
--   * Before creating any unique index we ABORT (RAISE EXCEPTION) if duplicate
--     rows already exist, so a live database can never be left in a
--     half-migrated or broken state. Nullable columns: multiple NULLs are
--     allowed by PostgreSQL unique indexes, so NULLs are excluded from checks.
--   * The script is IDEMPOTENT: CREATE ... IF NOT EXISTS + setval() only
--     advances the sequence to max(current value, existing max reference), so
--     re-running it never loses values.
--
-- Run:  psql "$DATABASE_URL" -f scripts/migrate-treasury-integrity.sql
--       (back up the database first, e.g. scripts/db_backup.sh)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0) PREFLIGHT: abort if any duplicate rows exist
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT "reference" FROM "TreasuryTransaction"
    WHERE "reference" IS NOT NULL
    GROUP BY "reference" HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Preflight failed: % duplicate TreasuryTransaction.reference value(s) exist. Resolve duplicates before migrating.', dup_count;
  END IF;

  SELECT count(*) INTO dup_count FROM (
    SELECT "payoutReference" FROM "DriverPayout"
    WHERE "payoutReference" IS NOT NULL
    GROUP BY "payoutReference" HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Preflight failed: % duplicate DriverPayout.payoutReference value(s) exist. Resolve duplicates before migrating.', dup_count;
  END IF;

  SELECT count(*) INTO dup_count FROM (
    SELECT "driverId", "sequentialIndex" FROM "DriverPayout"
    GROUP BY "driverId", "sequentialIndex" HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Preflight failed: % duplicate DriverPayout (driverId, sequentialIndex) group(s) exist. Resolve duplicates before migrating.', dup_count;
  END IF;

  SELECT count(*) INTO dup_count FROM (
    SELECT "sequentialIndex" FROM "MerchantPayout"
    GROUP BY "sequentialIndex" HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Preflight failed: % duplicate MerchantPayout.sequentialIndex value(s) exist. Resolve duplicates before migrating.', dup_count;
  END IF;

  RAISE NOTICE 'Preflight OK: no duplicates found.';
END
$$;

-- ----------------------------------------------------------------------------
-- 1) Unique indexes (match the names Prisma's @unique / @@unique would create,
--    so `prisma db push` sees them as already in place)
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "TreasuryTransaction_reference_key"
  ON "TreasuryTransaction" ("reference");

CREATE UNIQUE INDEX IF NOT EXISTS "DriverPayout_payoutReference_key"
  ON "DriverPayout" ("payoutReference");

CREATE UNIQUE INDEX IF NOT EXISTS "DriverPayout_driverId_sequentialIndex_key"
  ON "DriverPayout" ("driverId", "sequentialIndex");

CREATE UNIQUE INDEX IF NOT EXISTS "MerchantPayout_sequentialIndex_key"
  ON "MerchantPayout" ("sequentialIndex");

-- ----------------------------------------------------------------------------
-- 2) Sequence for treasury transaction references (numeric, e.g. 44, 45, ...)
--    setval(..., true) marks the value as already used, so the first nextval()
--    returns max + 1. Only advances; never resets below the existing max.
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS treasury_transaction_reference_seq;

-- Seed the sequence to one past the largest existing numeric reference.
-- GREATEST keeps a re-run from ever resetting the sequence downward (a
-- sequence only advances; new references created since a prior run must win).
-- last_value is read via a subquery (a sequence is a table); a freshly
-- created sequence has last_value = NULL, so COALESCE it to 0.
SELECT setval(
  'treasury_transaction_reference_seq',
  GREATEST(
    COALESCE((SELECT last_value FROM treasury_transaction_reference_seq), 0),
    COALESCE(
      (SELECT MAX("reference"::bigint) FROM "TreasuryTransaction"
       WHERE "reference" ~ '^[0-9]+$'),
      0
    )
  ),
  true
);

COMMIT;

-- Verify (informational, runs after commit)
SELECT count(*) AS treasury_tx_refs FROM "TreasuryTransaction" WHERE "reference" IS NOT NULL;
SELECT last_value FROM treasury_transaction_reference_seq;
