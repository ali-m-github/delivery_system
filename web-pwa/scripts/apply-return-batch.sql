-- Universal Staff Scanner (Phase 1): ReturnBatch table + Order.returnBatchId link.
-- Mirrors exactly what `prisma db push` would generate, applied manually so the
-- orphaned backup tables are NOT dropped. Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS "ReturnBatch" (
  "id" TEXT NOT NULL,
  "batchNumber" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "totalOrders" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReturnBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReturnBatch_batchNumber_key" ON "ReturnBatch"("batchNumber");
CREATE INDEX IF NOT EXISTS "ReturnBatch_merchantId_idx" ON "ReturnBatch"("merchantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ReturnBatch_merchantId_fkey'
  ) THEN
    ALTER TABLE "ReturnBatch"
      ADD CONSTRAINT "ReturnBatch_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "returnBatchId" TEXT;
CREATE INDEX IF NOT EXISTS "Order_returnBatchId_idx" ON "Order"("returnBatchId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Order_returnBatchId_fkey'
  ) THEN
    ALTER TABLE "Order"
      ADD CONSTRAINT "Order_returnBatchId_fkey"
      FOREIGN KEY ("returnBatchId") REFERENCES "ReturnBatch"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
