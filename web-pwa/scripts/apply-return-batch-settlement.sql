-- Return Batch Pipeline (Phase 2): link ReturnBatch to the CashPayoutBatch that settled it.
-- Mirrors exactly what `prisma db push` would generate, applied manually so the
-- orphaned backup tables are NOT dropped. Idempotent: safe to re-run.
ALTER TABLE "ReturnBatch" ADD COLUMN IF NOT EXISTS "cashPayoutBatchId" INTEGER;

CREATE INDEX IF NOT EXISTS "ReturnBatch_status_idx" ON "ReturnBatch"("status");
CREATE INDEX IF NOT EXISTS "ReturnBatch_cashPayoutBatchId_idx" ON "ReturnBatch"("cashPayoutBatchId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ReturnBatch_cashPayoutBatchId_fkey'
  ) THEN
    ALTER TABLE "ReturnBatch"
      ADD CONSTRAINT "ReturnBatch_cashPayoutBatchId_fkey"
      FOREIGN KEY ("cashPayoutBatchId") REFERENCES "CashPayoutBatch"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
