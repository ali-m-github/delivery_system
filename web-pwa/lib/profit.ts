import prisma from "@/lib/prisma";

// ============================================================
// Cash seller profit helpers
//
// Model (per order):
//   fee   = defaultSellerRate + defaultProfitRate   (amount deducted from seller)
//   profit = defaultProfitRate
//   BUT if the driver's seller rate exception equals the fee
//   (defaultSellerRate + defaultProfitRate), the company earns no
//   profit on that order (the driver keeps the whole fee). The order
//   is still deducted normally at `fee`.
//
// ── INTENDED BEHAVIOR (not a bug) ─────────────────────────────
// A seller with, e.g., defaultSellerRate = $3 and defaultProfitRate
// = $1 charges a flat fee of $4 per order. If the assigned driver has
// a seller-rate exception (DriverSellerRate / DriverCashSellerRate)
// of exactly $4 for that seller, the driver keeps the ENTIRE $4 fee
// and the company earns $0 profit on that order — even though the
// seller's profit rate is $1. The statement still deducts the full
// $4 fee from the seller; only the company's profit is $0.
//
// This is why a statement can show $0 profit despite a seller having a
// configured profit rate: check the driver's flat-rate exception for
// that seller before assuming a calculation error.
// ============================================================

export interface ProfitMerchant {
  defaultSellerRate: number | null;
  defaultProfitRate: number | null;
}

/**
 * Compute the company profit for a single order.
 *
 * @param merchant          The cash seller merchant (rates).
 * @param driverException   The driver's seller rate exception (USD) for this
 *                          merchant, or null when the driver has no exception.
 * @returns                 The profit in USD for this order (>= 0).
 */
export function computeOrderProfit(
  merchant: ProfitMerchant,
  driverException: number | null | undefined,
): number {
  const sellerRate = merchant.defaultSellerRate ?? 0;
  const profitRate = merchant.defaultProfitRate ?? 0;
  const fee = sellerRate + profitRate;

  // Driver exception == cash seller rate + profit => no profit for the company.
  if (
    driverException != null &&
    driverException > 0 &&
    Math.abs(driverException - fee) < 1e-6
  ) {
    return 0;
  }

  return profitRate;
}

/**
 * Resolve a driver's seller rate exception for a merchant.
 *
 * Checks BOTH driver exception models (a driver may have either set):
 *  - DriverCashSellerRate  (keyed by User.id)
 *  - DriverSellerRate      (keyed by DriverProfile.id)
 *
 * @returns the exception rate in USD, or null when none is set.
 */
export async function resolveDriverSellerException(
  driverProfileId: string | null,
  merchantId: string,
): Promise<number | null> {
  if (!driverProfileId) return null;

  const profile = await prisma.driverProfile.findUnique({
    where: { id: driverProfileId },
    select: { id: true, userId: true },
  });
  if (!profile) return null;

  // DriverCashSellerRate references User.id
  const cashRate = await prisma.driverCashSellerRate.findUnique({
    where: { driverId_merchantId: { driverId: profile.userId, merchantId } },
  });
  if (cashRate && cashRate.rateUsd > 0) return cashRate.rateUsd;

  // DriverSellerRate references DriverProfile.id
  const sellerRate = await prisma.driverSellerRate.findUnique({
    where: { driverId_merchantId: { driverId: profile.id, merchantId } },
  });
  if (sellerRate && sellerRate.rateUsd > 0) return sellerRate.rateUsd;

  return null;
}

/**
 * Build lookup maps for all driver seller exceptions so profit can be
 * computed in bulk (used by the admin Profit overview).
 *
 * @param merchantIds  The set of merchant ids to consider (for the fee check).
 * @returns {
 *   byUserId:  Map<`${userId}:${merchantId}`, rateUsd>  (DriverCashSellerRate)
 *   byProfile: Map<`${driverProfileId}:${merchantId}`, rateUsd> (DriverSellerRate)
 * }
 */
export async function buildDriverExceptionMaps(merchantIds: string[]): Promise<{
  byUserId: Map<string, number>;
  byProfileId: Map<string, number>;
}> {
  const byUserId = new Map<string, number>();
  const byProfileId = new Map<string, number>();

  if (merchantIds.length === 0) return { byUserId, byProfileId };

  const [cashRates, sellerRates] = await Promise.all([
    prisma.driverCashSellerRate.findMany({
      where: { merchantId: { in: merchantIds } },
      select: { driverId: true, merchantId: true, rateUsd: true },
    }),
    prisma.driverSellerRate.findMany({
      where: { merchantId: { in: merchantIds } },
      select: { driverId: true, merchantId: true, rateUsd: true },
    }),
  ]);

  for (const r of cashRates) {
    if (r.rateUsd > 0) byUserId.set(`${r.driverId}:${r.merchantId}`, r.rateUsd);
  }
  for (const r of sellerRates) {
    if (r.rateUsd > 0)
      byProfileId.set(`${r.driverId}:${r.merchantId}`, r.rateUsd);
  }

  return { byUserId, byProfileId };
}
