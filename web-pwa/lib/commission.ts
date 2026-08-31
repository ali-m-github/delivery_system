import { PrismaClient, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTHORITATIVE DRIVER COMMISSION MODULE
 * ─────────────────────────────────────────────────────────────────────────────
 * This module is the single source of truth for driver commission calculation,
 * payout order eligibility, and collected/gross amounts. It separates the three
 * concerns that were historically tangled across route handlers:
 *
 *   A. Commission per order  → {@link computeOrderCommission}
 *   B. Payout eligibility    → {@link isPayoutEligibleOrder} /
 *                              {@link PAID_OUT_ELIGIBLE_STATUSES}
 *   C. Collected/gross       → {@link grossUsd} / {@link grossLbp}
 *
 * Every ledger-writing path (payout creation, clear-to-office, payout
 * recalculation on order removal/return) and every display/enrichment path
 * (settlements, payout history, driver previews, print) MUST derive figures
 * through this module so that a payout's stored totals and its recomputed
 * totals can never diverge.
 *
 * ── Commission precedence (determined from the app's own data-fix script
 *    scripts/fix-10007447-payout.ts, which documents "the same 2-tier
 *    commission logic the app uses for payout totals", and from the
 *    self-declared authoritative path app/api/driver-payouts/route.ts) ──
 *
 *   Tier 1: Seller-exception flat rate
 *           DriverSellerRate (keyed by DriverProfile.id) ∪
 *           DriverCashSellerRate (keyed by the driver's User.id).
 *           Cash-seller entries are applied second and therefore WIN any
 *           conflict for the same merchant.
 *           A $0 exception is a VALID override — the mere existence of the
 *           row takes precedence over any zone rate; never filter it out.
 *
 *   Tier 2: Zone rate — DriverZoneRate (keyed by DriverProfile.id).
 *
 *   Tier 3: Fallback — {@link DEFAULT_DRIVER_USD} ($0). No silent per-order
 *           money is invented when a rate is not configured; unconfigured
 *           rates are an ops problem, not a reason to overpay drivers.
 *           (The historical $3 constant was the stale/incomplete branch: it
 *           existed in payout creation but not in the recalculation paths,
 *           which broke the invariant that removing an order from a payout
 *           must leave the remaining totals consistent.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * System-wide fallback when neither a seller exception nor a zone rate is
 * configured for an order. $0 by design — see precedence docs above.
 * Kept as a named export for legacy importers (previews, print page).
 */
export const DEFAULT_DRIVER_USD = 0.0;
export const DEFAULT_DRIVER_LBP = 0;

/**
 * The only financial statuses that make a delivered order payable to its
 * driver:
 *   - "WD" (With Driver): delivered, cash held by the driver, pending payout.
 *   - "UD" (Unpaid/Due):  delivered but not yet through the payout flow —
 *     this is the state the void flow restores a returned-from-payout order
 *     to ("Orders returned to Delivered tab"), so Generate Payout must accept
 *     it or voided orders could never be re-settled.
 * Any payout path (creation OR clear-to-office) MUST use this set; clearing
 * only accepted WD while creation accepted WD|UD, which left voided orders
 * permanently stuck in the Delivered tab.
 */
export const PAID_OUT_ELIGIBLE_STATUSES: string[] = ["WD", "UD"];

/**
 * A driver-facing rate table: the driver's full commission configuration in
 * memory. Build it ONCE per driver (via {@link loadDriverRateTable} on the
 * server or {@link buildRateTableFromRates} on the client) and answer any
 * number of per-order questions from it — no per-order DB queries.
 */
export interface DriverRateTable {
  /** DriverProfile id (used to key DriverSellerRate and DriverZoneRate). */
  profileId: string;
  /** Zone id → zone rate USD (Tier 2). */
  zoneRateMap: Map<string, number>;
  /**
   * Merchant id → seller-exception rate USD (Tier 1). Already merged:
   * DriverSellerRate first, then DriverCashSellerRate applied second so cash
   * entries win conflicts. $0 exceptions are preserved.
   */
  sellerExceptionMap: Map<string, number>;
  /**
   * Merchant id → LBP amount from the standard DriverSellerRate rows only.
   * Cash-seller overrides are USD-only, so LBP is zero whenever the cash
   * entry wins.
   */
  sellerLbpMap: Map<string, number>;
  /** Merchants covered by a DriverCashSellerRate (USD-only, win conflicts). */
  cashSellerMerchantIds: Set<string>;
}

/** Row shapes as returned by the Prisma models (only the fields we need). */
export interface RateTableSources {
  driverZoneRates: { zoneId: string; rate: number }[];
  driverSellerRates: { merchantId: string; rateUsd: number; rateLbp?: number }[];
  driverCashSellerRates: { merchantId: string; rateUsd: number }[];
}

/**
 * Pure (no I/O) builder of a rate table from already-loaded rate rows.
 * Client components use this directly with the rates their server page
 * already fetched; server routes should prefer {@link loadDriverRateTable}.
 */
export function buildRateTableFromRates(
  profileId: string,
  sources: RateTableSources,
): DriverRateTable {
  const zoneRateMap = new Map<string, number>(
    sources.driverZoneRates.map((zr) => [zr.zoneId, zr.rate]),
  );
  const sellerExceptionMap = new Map<string, number>();
  const sellerLbpMap = new Map<string, number>();
  for (const sr of sources.driverSellerRates) {
    sellerExceptionMap.set(String(sr.merchantId), sr.rateUsd);
    sellerLbpMap.set(String(sr.merchantId), sr.rateLbp ?? 0);
  }
  // Cash-seller entries are applied second so they win conflicts, matching
  // the historical (correct) behavior of every path that honored them.
  const cashSellerMerchantIds = new Set<string>();
  for (const cr of sources.driverCashSellerRates) {
    sellerExceptionMap.set(String(cr.merchantId), cr.rateUsd);
    cashSellerMerchantIds.add(String(cr.merchantId));
  }
  return { profileId, zoneRateMap, sellerExceptionMap, sellerLbpMap, cashSellerMerchantIds };
}

type PrismaClientLike = PrismaClient | Prisma.TransactionClient;

/**
 * Loads a driver's complete rate table with exactly 3 bulk queries
 * (zone rates, seller exceptions, cash-seller exceptions) — never per-order.
 * Accepts a plain client or an interactive-transaction client so it can be
 * called inside `$transaction` callbacks.
 */
export async function loadDriverRateTable(
  client: PrismaClientLike,
  profileId: string,
  userId?: string | null,
): Promise<DriverRateTable> {
  // When userId is not supplied (undefined), resolve it from the profile so
  // cash-seller exceptions (keyed by User.id) are never silently dropped.
  // An explicit null means "no user linked" and skips the cash query.
  const resolvedUserId =
    userId === undefined
      ? (await client.driverProfile.findUnique({
          where: { id: profileId },
          select: { userId: true },
        }))?.userId ?? null
      : userId;
  const [driverZoneRates, driverSellerRates, driverCashSellerRates] =
    await Promise.all([
      client.driverZoneRate.findMany({ where: { driverId: profileId } }),
      client.driverSellerRate.findMany({ where: { driverId: profileId } }),
      resolvedUserId
        ? client.driverCashSellerRate.findMany({ where: { driverId: resolvedUserId } })
        : Promise.resolve([]),
    ]);
  return buildRateTableFromRates(profileId, {
    driverZoneRates,
    driverSellerRates,
    driverCashSellerRates,
  });
}

/** Convenience overload using the shared singleton client. */
export async function loadDriverRateTableForProfile(
  profileId: string,
): Promise<DriverRateTable> {
  const profile = await prisma.driverProfile.findUnique({
    where: { id: profileId },
    select: { userId: true },
  });
  return loadDriverRateTable(prisma, profileId, profile?.userId);
}

export interface CommissionBreakdown {
  usd: number;
  lbp: number;
  /** Which tier produced the USD rate: "seller" | "cashSeller" | "zone" | "default". */
  tier: "seller" | "cashSeller" | "zone" | "default";
  /** True for Tier 1 (a flat per-merchant override, incl. $0). */
  isFlatOverride: boolean;
}

export interface CommissionOrderInput {
  merchantId?: string | null | number;
  zoneId: string;
}

/**
 * (A) Commission calculation for a single order against a rate table.
 * Precedence: seller exception (cash wins) → zone rate → $0 default.
 * LBP: DriverSellerRate carries a rateLbp; zone rates and cash-seller rates
 * are USD-only (their LBP is 0), matching every historical implementation.
 */
export function computeOrderCommission(
  table: DriverRateTable,
  order: CommissionOrderInput,
): CommissionBreakdown {
  if (order.merchantId) {
    const merchantKey = String(order.merchantId);
    const rate = table.sellerExceptionMap.get(merchantKey);
    if (rate !== undefined) {
      // Cash-seller rows are USD-only; standard seller rows may carry an LBP
      // amount, so look the LBP up from the standard (profile-keyed) map.
      const lbp = table.sellerLbpMap?.get(merchantKey) ?? 0;
      return {
        usd: rate,
        lbp,
        tier: table.cashSellerMerchantIds?.has(merchantKey) ? "cashSeller" : "seller",
        isFlatOverride: true,
      };
    }
  }
  const zoneRate = table.zoneRateMap.get(order.zoneId);
  if (zoneRate !== undefined) {
    return { usd: zoneRate, lbp: 0, tier: "zone", isFlatOverride: false };
  }
  return {
    usd: DEFAULT_DRIVER_USD,
    lbp: DEFAULT_DRIVER_LBP,
    tier: "default",
    isFlatOverride: false,
  };
}

export interface PayoutTotals {
  totalUsd: number;
  totalLbp: number;
  commissionUsd: number;
  netUsd: number;
  /** Equals totalUsd — DriverPayout.totalCollected tracks USD gross. */
  totalCollected: number;
}

export interface CommissionOrderRow extends CommissionOrderInput {
  amountUsd?: number | null;
  amountLbp?: number | null;
  collectedUsd?: number | null;
  collectedLbp?: number | null;
}

/**
 * (C) Collected/gross for a single order, per currency. The delivery flow
 * copies the order amount into `collected*` on delivery (and returns reset
 * them to 0); the schema default is 0, so `??` alone is unreliable — only a
 * POSITIVE collected amount is authoritative, otherwise fall back to the
 * order amount. This is the rule the settlements enrichment already used.
 */
/** Subset of an order row needed for gross/collected math (no zoneId). */
export type GrossOrderInput = Pick<
  CommissionOrderRow,
  "amountUsd" | "amountLbp" | "collectedUsd" | "collectedLbp"
>;

export function grossUsd(order: GrossOrderInput): number {
  return (order.collectedUsd ?? 0) > 0 ? (order.collectedUsd as number) : (order.amountUsd ?? 0);
}
export function grossLbp(order: GrossOrderInput): number {
  return (order.collectedLbp ?? 0) > 0 ? (order.collectedLbp as number) : (order.amountLbp ?? 0);
}

/**
 * Aggregates a payout batch: gross (per C), commission sum (per A) and net
 * (gross − commission). Pure and batch-capable — feed it the remaining
 * orders after a removal/return and the result is exactly what the ledger
 * must store.
 */
export function recalcPayoutTotals(
  table: DriverRateTable,
  orders: CommissionOrderRow[],
): PayoutTotals {
  let totalUsd = 0;
  let totalLbp = 0;
  let commissionUsd = 0;
  for (const o of orders) {
    totalUsd += grossUsd(o);
    totalLbp += grossLbp(o);
    commissionUsd += computeOrderCommission(table, o).usd;
  }
  return {
    totalUsd,
    totalLbp,
    commissionUsd,
    netUsd: totalUsd - commissionUsd,
    totalCollected: totalUsd,
  };
}

/**
 * (B) Payout eligibility for a single order. An order is payable to its
 * driver only when it is physically DELIVERED and in a payable financial
 * status (WD or UD — see {@link PAID_OUT_ELIGIBLE_STATUSES}).
 */
export function isPayoutEligibleOrder(order: {
  location?: string | null;
  financialStatus?: string | null;
}): boolean {
  return (
    order.location === "DELIVERED" &&
    PAID_OUT_ELIGIBLE_STATUSES.includes(order.financialStatus as string)
  );
}

export interface PayoutOrderEnrichment {
  zoneId: string;
  merchantId?: string | null | number;
  amountUsd?: number | null;
  amountLbp?: number | null;
  collectedUsd?: number | null;
  collectedLbp?: number | null;
}

/**
 * Batch enrichment helper for display paths: computes per-order
 * `driverCommissionUsd` (A) plus normalized `collectedUsd`/`collectedLbp`
 * (C) for one driver's payout orders.
 *
 * Call it ONCE per driver (group payouts by driver first) rather than per
 * payout — it reuses the per-driver rate table, eliminating the N+1
 * rate-loading that the old per-payout enrichment performed.
 */
export function enrichPayoutOrdersWithCommission<
  T extends PayoutOrderEnrichment & Record<string, unknown>,
>(table: DriverRateTable, orders: T[]): T[] {
  return orders.map((order) => {
    const { usd } = computeOrderCommission(table, order);
    return {
      ...order,
      collectedUsd: grossUsd(order),
      collectedLbp: grossLbp(order),
      driverCommissionUsd: usd,
    };
  });
}

/** Legacy result shape (kept for any remaining consumers / scripts). */
export interface DriverCommissionResult {
  usd: number;
  lbp: number;
  isFlatOverride: boolean;
}

/**
 * Single-order async convenience: loads the driver's full rate table (3 bulk
 * queries, incl. the cash-seller union the old implementation was missing)
 * and returns the Tier 1 → Tier 2 → Tier 3 result. Do NOT call this per
 * order in a loop — use {@link loadDriverRateTable} + {@link
 * computeOrderCommission} instead.
 */
export async function getDriverCommission(
  driverId: string,
  merchantId: string | null | undefined,
  zoneId: string,
): Promise<DriverCommissionResult> {
  const table = await loadDriverRateTableForProfile(driverId);
  const result = computeOrderCommission(table, { merchantId, zoneId });
  return { usd: result.usd, lbp: result.lbp, isFlatOverride: result.isFlatOverride };
}

/**
 * Batch version — computes commissions for multiple orders assigned to the
 * same driver. One rate-table load, then pure per-order lookups (no N+1).
 */
export async function getDriverCommissionsForOrders(
  driverId: string,
  orders: { merchantId?: string | null; zoneId: string }[],
): Promise<DriverCommissionResult[]> {
  const table = await loadDriverRateTableForProfile(driverId);
  return orders.map((order) => {
    const result = computeOrderCommission(table, order);
    return { usd: result.usd, lbp: result.lbp, isFlatOverride: result.isFlatOverride };
  });
}
