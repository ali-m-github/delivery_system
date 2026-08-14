import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// System-wide defaults when no driver-specific rate is configured
export const DEFAULT_DRIVER_USD = 3.0;
export const DEFAULT_DRIVER_LBP = 0;

export interface DriverCommissionResult {
  usd: number;
  lbp: number;
  isFlatOverride: boolean;
}

/**
 * 3-Tier Override Hierarchy for driver commission calculation:
 *
 * Tier 1: Driver-Seller Flat Rate Exception (DriverSellerRate)
 *   — A custom flat rate set specifically for a driver↔merchant pair.
 *
 * Tier 2: Zone-Based Rate (DriverZoneRate)
 *   — Rate configured per driver per zone.
 *
 * Tier 3: System Default Fallback
 *   — Hard-coded default when no other rate is found.
 */
export async function getDriverCommission(
  driverId: string,
  merchantId: string | null | undefined,
  zoneId: string,
): Promise<DriverCommissionResult> {
  // Tier 1: Check for Seller-Specific Flat Rate Exception.
  // NOTE: A $0 exception is still a valid override — the mere existence of a
  // driver↔seller rate takes precedence over any zonal/system-default rate,
  // so we must NOT filter out zero-valued exceptions here.
  if (merchantId) {
    const sellerException = await prisma.driverSellerRate.findUnique({
      where: { driverId_merchantId: { driverId, merchantId } },
    });
    if (sellerException) {
      return {
        usd: sellerException.rateUsd,
        lbp: sellerException.rateLbp,
        isFlatOverride: true,
      };
    }
  }

  // Tier 2: Fall back to Zone-Based Rate
  const zoneRate = await prisma.driverZoneRate.findFirst({
    where: { driverId, zoneId },
  });
  if (zoneRate) {
    return { usd: zoneRate.rate, lbp: 0, isFlatOverride: false };
  }

  // Tier 3: System Default Fallback
  return {
    usd: DEFAULT_DRIVER_USD,
    lbp: DEFAULT_DRIVER_LBP,
    isFlatOverride: false,
  };
}

/**
 * Batch version — computes commissions for multiple orders assigned to the same driver.
 * Each order may belong to a different merchant/zone, so this iterates per-order.
 */
export async function getDriverCommissionsForOrders(
  driverId: string,
  orders: { merchantId?: string | null; zoneId: string }[],
): Promise<DriverCommissionResult[]> {
  const results: DriverCommissionResult[] = [];
  for (const order of orders) {
    const commission = await getDriverCommission(
      driverId,
      order.merchantId,
      order.zoneId,
    );
    results.push(commission);
  }
  return results;
}
