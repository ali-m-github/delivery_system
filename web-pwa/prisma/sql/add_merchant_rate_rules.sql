-- Add MerchantRateRule table (zone-range rate rules with effective dates).
-- Safe, additive-only: creates the table and index if missing.
CREATE TABLE IF NOT EXISTS "MerchantRateRule" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "zoneFrom" INTEGER NOT NULL,
  "zoneTo" INTEGER NOT NULL,
  "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rateLbp" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MerchantRateRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MerchantRateRule_merchantId_effectiveFrom_idx"
  ON "MerchantRateRule"("merchantId", "effectiveFrom");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MerchantRateRule_merchantId_fkey'
  ) THEN
    ALTER TABLE "MerchantRateRule"
      ADD CONSTRAINT "MerchantRateRule_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
