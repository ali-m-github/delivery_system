-- Two-Point Chain-of-Custody: PickupBatch table + Order.pickupBatchId link.
-- Mirrors exactly what `prisma db push` would generate, applied manually so the
-- orphaned ZoneMapping_backup_20261006 table is NOT dropped.
CREATE TABLE IF NOT EXISTS "PickupBatch" (
  "id" TEXT NOT NULL,
  "batchNumber" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "driverId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "totalOrders" INTEGER NOT NULL DEFAULT 0,
  "pickedUpCount" INTEGER NOT NULL DEFAULT 0,
  "receivedCount" INTEGER NOT NULL DEFAULT 0,
  "discrepancyNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PickupBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PickupBatch_batchNumber_key" ON "PickupBatch"("batchNumber");
CREATE INDEX IF NOT EXISTS "PickupBatch_merchantId_idx" ON "PickupBatch"("merchantId");
CREATE INDEX IF NOT EXISTS "PickupBatch_status_idx" ON "PickupBatch"("status");
CREATE INDEX IF NOT EXISTS "PickupBatch_driverId_idx" ON "PickupBatch"("driverId");

ALTER TABLE "PickupBatch" ADD CONSTRAINT "PickupBatch_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PickupBatch" ADD CONSTRAINT "PickupBatch_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "pickupBatchId" TEXT;
CREATE INDEX IF NOT EXISTS "Order_pickupBatchId_idx" ON "Order"("pickupBatchId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_pickupBatchId_fkey" FOREIGN KEY ("pickupBatchId") REFERENCES "PickupBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
