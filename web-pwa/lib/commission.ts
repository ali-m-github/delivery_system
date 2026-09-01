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
 *   No fallback. If an order matches NEITHER a seller exception nor a zone
 *           rate, the driver's configuration is INCOMPLETE — a
 *           configuration error, not a reason to invent money. There is no
 *           $0 default and no $3 default: ledger paths fail closed with a
 *           {@link MissingDriverRateError} (the whole operation is
 *           rejected/rolled back, nothing is persisted), and display paths
 *           show "Rate not configured" instead of a fake $0 figure.
 *           (The historical $3 constant was the stale/incomplete branch: it
 *           existed in payout creation but not in the recalculation paths,
 *           which broke the invariant that removing an order from a payout
 *           must leave the remaining totals consistent. The later "$0
 *           default" had the same flaw in reverse — it silently underpaid
 *           drivers instead of surfacing the missing configuration.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

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
 * ─────────────────────────────────────────────────────────────────────────────
 * PAYOUT LIFECYCLE MUTABILITY — single source of truth
 * ─────────────────────────────────────────────────────────────────────────────
 * DriverPayout.status observed in the codebase (no enum in the schema):
 *
 *   PENDING           → freshly created (generate payout / clear-to-office
 *                        drafts). Orders are still mutable; totals are still
 *                        recomputable. This is the ONLY mutable state.
 *   PENDING_APPROVAL  → Phase-1 "settle" posted: amountPaid/remaining/debt
 *                        carryover and statement deductions already derived.
 *   SETTLED           → Phase-2 "approve" posted: orders flipped WD→WO and
 *                        treasury IN transaction posted atomically.
 *   CLEARED           → legacy direct-clear path: orders already WO, payout
 *                        reference/clearedAt fixed.
 *
 * Anything not in MUTABLE_PAYOUT_STATUSES is a HISTORICAL financial record:
 * settlement figures (amountPaid, remaining, carriedDebt) and/or treasury
 * postings are already derived from its stored totals. Generic order editing
 * must NOT detach or recompute such payouts — use the sanctioned reversal
 * workflows instead (void while PENDING, admin orders return, treasury
 * rejection).
 *
 * All guards fail CLOSED: an unknown status is treated as historical.
 */
export const MUTABLE_PAYOUT_STATUSES: string[] = ["PENDING"];

/**
 * Fail-closed mutability check: only statuses in {@link MUTABLE_PAYOUT_STATUSES}
 * are mutable. Null/undefined (payout not found) is NOT mutable.
 */
export function isPayoutMutable(status: string | null | undefined): boolean {
  return !!status && MUTABLE_PAYOUT_STATUSES.includes(status);
}

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

/**
 * Result of a per-order commission lookup. Deliberately a discriminated
 * union so callers MUST handle the missing-rate case explicitly at compile
 * time — there is no default number to fall back to:
 *
 *   - `ok: true`  → a rate IS configured. An explicitly-configured $0 is a
 *                   VALID result and must never be treated as missing.
 *   - `ok: false` → no seller exception AND no zone rate: a configuration
 *                   error. Ledger paths must throw {@link
 *                   MissingDriverRateError} (via {@link validateDriverRates}
 *                   / {@link recalcPayoutTotals}); display paths must
 *                   render "Rate not configured".
 */
export type CommissionBreakdown =
  | {
      ok: true;
      usd: number;
      lbp: number;
      /** Which tier produced the USD rate: "seller" | "cashSeller" | "zone". */
      tier: "seller" | "cashSeller" | "zone";
      /** True for Tier 1 (a flat per-merchant override, incl. $0). */
      isFlatOverride: boolean;
    }
  | {
      ok: false;
      tier: "missing";
    };

export interface CommissionOrderInput {
  merchantId?: string | null | number;
  zoneId: string;
}

/**
 * One order for which the driver has NO configured rate (neither a seller
 * exception nor a zone rate). Carries just enough context to name it in an
 * employee-facing error.
 */
export interface MissingRateOrder {
  /** Row id (DriverPayoutItem id) when the caller has one. */
  id?: string;
  /** Public order id (or other label) when the caller has one. */
  label?: string;
  merchantId: string | null;
  zoneId: string;
  merchantName?: string;
  zoneName?: string;
}

/**
 * Fail-closed error: at least one order in a batch has no configured driver
 * commission rate. Ledger-writing paths throw this — inside the
 * `$transaction` when applicable, so the ENTIRE operation rolls back (no
 * partial payout / statement / lifecycle change is persisted) — and surface
 * it as a 4xx response carrying the actionable message. Display/preview
 * paths must never throw; they must render "Rate not configured" instead.
 */
export class MissingDriverRateError extends Error {
  readonly driverProfileId: string;
  readonly missingOrders: MissingRateOrder[];

  constructor(driverProfileId: string, missingOrders: MissingRateOrder[]) {
    const count = missingOrders.length;
    const orderList = missingOrders
      .map((o) => {
        const which = [
          o.merchantId ? `seller ${o.merchantName ?? o.merchantId}` : "seller not set",
          o.zoneId ? `zone ${o.zoneName ?? o.zoneId}` : "zone not set",
        ].join(", ");
        return `${o.id ?? o.label ?? "an order"} (${which})`;
      })
      .join("; ");
    super(
      `Driver commission rate not configured: driver ${driverProfileId} has ` +
        `no seller-exception or zone rate for ${count} order(s): ${orderList}. ` +
        `Configure the missing rate(s) first — a $0 rate is a valid explicit ` +
        `override — then retry. Nothing was saved.`,
    );
    this.name = "MissingDriverRateError";
    this.driverProfileId = driverProfileId;
    this.missingOrders = missingOrders;
  }
}

/**
 * (A) Commission calculation for a single order against a rate table.
 * Precedence: seller exception (cash wins) → zone rate → MISSING (no
 * configured rate is a configuration error, not a $0 default).
 * LBP: DriverSellerRate carries a rateLbp; zone rates and cash-seller rates
 * are USD-only (their LBP is 0), matching every historical implementation.
 * Returns `ok: false` (with no numeric result) when neither tier is
 * configured. An explicitly-configured $0 rate still returns `ok: true`.
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
        ok: true,
        usd: rate,
        lbp,
        tier: table.cashSellerMerchantIds?.has(merchantKey) ? "cashSeller" : "seller",
        isFlatOverride: true,
      };
    }
  }
  const zoneRate = table.zoneRateMap.get(order.zoneId);
  if (zoneRate !== undefined) {
    return { ok: true, usd: zoneRate, lbp: 0, tier: "zone", isFlatOverride: false };
  }
  // No seller exception and no zone rate → configuration error. There is no
  // numeric fallback (neither $0 nor the historical $3): inventing one would
  // silently corrupt payouts. Ledger paths must fail closed via
  // validateDriverRates(); display paths render "Rate not configured".
  return { ok: false, tier: "missing" };
}

/**
 * Pure helper: the orders in `orders` for which the rate table has neither a
 * seller exception nor a zone rate. An explicitly-configured $0 IS a
 * configured rate and is never reported here (no truthiness on the rate
 * value, ever).
 */
export function findMissingRateOrders<T extends CommissionOrderRow>(
  table: DriverRateTable,
  orders: T[],
): MissingRateOrder[] {
  const missing: MissingRateOrder[] = [];
  for (const o of orders) {
    if (computeOrderCommission(table, o).ok === false) {
      const row = o as CommissionOrderRow & {
        id?: string | null;
        orderId?: string | null;
        merchantName?: string | null;
        zoneName?: string | null;
        merchant?: { merchantName?: string | null } | null;
        zone?: { name?: string | null } | null;
      };
      missing.push({
        id: row.id ?? undefined,
        label: row.orderId ?? undefined,
        merchantId: o.merchantId == null ? null : String(o.merchantId),
        zoneId: o.zoneId,
        merchantName:
          row.merchantName ??
          (typeof row.merchant?.merchantName === "string"
            ? row.merchant.merchantName
            : undefined),
        zoneName:
          row.zoneName ??
          (typeof row.zone?.name === "string" ? row.zone.name : undefined),
      });
    }
  }
  return missing;
}

/**
 * Fail-closed batch validation for ledger-writing paths: EVERY included
 * order must have a configured rate. If ANY is missing, throws a single
 * {@link MissingDriverRateError} aggregating ALL of them, so one
 * unconfigured order fails the WHOLE payout / removal / settlement (no
 * partial results). Call it inside the `$transaction` when applicable so
 * the throw rolls everything back.
 *
 * An explicitly-configured $0 rate PASSES this check — only the absence of a
 * rate row/match fails.
 */
export function validateDriverRates(
  table: DriverRateTable,
  orders: CommissionOrderRow[],
): void {
  const missing = findMissingRateOrders(table, orders);
  if (missing.length > 0) {
    throw new MissingDriverRateError(table.profileId, missing);
  }
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
 *
 * FAILS CLOSED: validates that EVERY order has a configured rate and throws
 * {@link MissingDriverRateError} (aggregating all missing ones) BEFORE
 * computing anything. When called inside `$transaction`, that throw rolls
 * back the entire operation — no partial payout / statement / lifecycle
 * change is ever persisted.
 */
export function recalcPayoutTotals(
  table: DriverRateTable,
  orders: CommissionOrderRow[],
): PayoutTotals {
  validateDriverRates(table, orders);
  let totalUsd = 0;
  let totalLbp = 0;
  let commissionUsd = 0;
  for (const o of orders) {
    const breakdown = computeOrderCommission(table, o);
    totalUsd += grossUsd(o);
    totalLbp += grossLbp(o);
    // validateDriverRates above guarantees `ok: true` for every order.
    commissionUsd += breakdown.ok ? breakdown.usd : 0;
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
 * Display paths MUST NOT throw on missing rates: `driverCommissionUsd` is
 * `null` exactly when the driver has no configured rate for that order
 * (neither seller exception nor zone rate). An explicitly-configured $0
 * rate yields `driverCommissionUsd: 0`, which UIs must render as a real $0
 * figure — distinguishable from the `null` "Rate not configured" case.
 *
 * Call it ONCE per driver (group payouts by driver first) rather than per
 * payout — it reuses the per-driver rate table, eliminating the N+1
 * rate-loading that the old per-payout enrichment performed.
 */
export function enrichPayoutOrdersWithCommission<
  T extends PayoutOrderEnrichment & Record<string, unknown>,
>(
  table: DriverRateTable,
  orders: T[],
): Array<
  T & {
    collectedUsd: number;
    collectedLbp: number;
    driverCommissionUsd: number | null;
  }
> {
  return orders.map((order) => {
    const breakdown = computeOrderCommission(table, order);
    return {
      ...order,
      collectedUsd: grossUsd(order),
      collectedLbp: grossLbp(order),
      driverCommissionUsd: breakdown.ok ? breakdown.usd : null,
    };
  });
}

/** Result shape for the async convenience helpers below. */
export interface DriverCommissionResult {
  usd: number;
  lbp: number;
  isFlatOverride: boolean;
}

/** Throws the fail-closed error for an order with no configured rate. */
function missingRateResult(
  table: DriverRateTable,
  order: CommissionOrderInput,
): never {
  throw new MissingDriverRateError(table.profileId, [
    {
      merchantId: order.merchantId == null ? null : String(order.merchantId),
      zoneId: order.zoneId,
    },
  ]);
}

/**
 * Single-order async convenience: loads the driver's full rate table (3 bulk
 * queries, incl. the cash-seller union the old implementation was missing)
 * and returns the Tier 1 → Tier 2 result. Do NOT call this per order in a
 * loop — use {@link loadDriverRateTable} + {@link computeOrderCommission}
 * instead.
 *
 * FAILS CLOSED: throws {@link MissingDriverRateError} when the driver has no
 * configured rate for the order — there is no default to fall back to.
 */
export async function getDriverCommission(
  driverId: string,
  merchantId: string | null | undefined,
  zoneId: string,
): Promise<DriverCommissionResult> {
  const table = await loadDriverRateTableForProfile(driverId);
  const result = computeOrderCommission(table, { merchantId, zoneId });
  if (!result.ok) return missingRateResult(table, { merchantId, zoneId });
  return { usd: result.usd, lbp: result.lbp, isFlatOverride: result.isFlatOverride };
}

/**
 * Batch version — computes commissions for multiple orders assigned to the
 * same driver. One rate-table load, then pure per-order lookups (no N+1).
 *
 * FAILS CLOSED: throws one aggregated {@link MissingDriverRateError} if ANY
 * order in the batch has no configured rate (nothing is computed for a
 * partially-configured batch).
 */
export async function getDriverCommissionsForOrders(
  driverId: string,
  orders: { merchantId?: string | null; zoneId: string }[],
): Promise<DriverCommissionResult[]> {
  const table = await loadDriverRateTableForProfile(driverId);
  validateDriverRates(table, orders);
  return orders.map((order) => {
    const result = computeOrderCommission(table, order);
    // Unreachable: validateDriverRates already threw for any missing rate.
    if (!result.ok) return missingRateResult(table, order);
    return { usd: result.usd, lbp: result.lbp, isFlatOverride: result.isFlatOverride };
  });
}
