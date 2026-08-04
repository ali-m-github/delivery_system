-- ============================================================
-- Migration: rename company rate -> profit rate
--
-- 1) Merchant.defaultCompanyRate -> Merchant.defaultProfitRate
--    Backfill so the total fee stays the same:
--      old: fee = defaultSellerRate (e.g. 4), profit = sellerRate - companyRate (4-3=1)
--      new: fee = defaultSellerRate + defaultProfitRate
--    => defaultSellerRate = old defaultCompanyRate (3)
--       defaultProfitRate = old defaultSellerRate - old defaultCompanyRate (1)
--    (PostgreSQL evaluates all SET expressions against the OLD row values.)
-- 2) CashPayoutBatch.companyProfit -> CashPayoutBatch.profit
-- 3) MerchantPayout gains profitUsd (profit earned on delivered / PS orders)
-- ============================================================

ALTER TABLE "Merchant" RENAME COLUMN "defaultCompanyRate" TO "defaultProfitRate";

UPDATE "Merchant"
SET "defaultSellerRate" = "defaultProfitRate",
    "defaultProfitRate" = "defaultSellerRate" - "defaultProfitRate"
WHERE "isCashSeller" = true
  AND "defaultProfitRate" IS NOT NULL
  AND "defaultSellerRate" IS NOT NULL;

ALTER TABLE "CashPayoutBatch" RENAME COLUMN "companyProfit" TO "profit";

ALTER TABLE "MerchantPayout" ADD COLUMN "profitUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
