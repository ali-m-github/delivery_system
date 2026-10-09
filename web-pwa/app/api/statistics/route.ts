import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// ============================================================
// GET /api/statistics
//
// Aggregated delivery / merchant statistics for the Statistics page.
//
// Authorization: ADMIN (bypass inside hasPermission) or any user holding the
// VIEW_STATISTICS permission via a PermissionGroup or customPermissions.
//
// Query params:
//   merchantId  — optional; restrict every metric to a single seller
//   range       — optional preset: "7d" | "1m" | "3m" | "6m" (default "1m")
//   startDate   — optional ISO date (YYYY-MM-DD); custom interval start
//   endDate     — optional ISO date (YYYY-MM-DD); custom interval end
//                 (when either custom date is present, both are required and
//                 the `range` preset is ignored)
//
// Status matching (verified against the live schema / order routes):
//   delivered  → location = "DELIVERED" (financialStatus WD/WO are derived
//                from it; the location survives payout settlement)
//   returned   → location = "RETURN" (covers both RWD "Return With Driver"
//                and Re "Returned to warehouse")
//
// Exchange proof orders (orderId ends with "-Exchange", created by
// lib/exchange.ts when a delivered order's exchange item comes back) are
// excluded from EVERY metric: they are synthetic $0 artifacts sitting in
// location RETURN, not real orders — the actual (new) order was delivered.
// Counting them would inflate totals/returns and drag avgOrderPrice toward 0.
// Same exclusion convention as the cash-payout routes.
//
// avgDeliveryTimeHours: deliveredAt − createdAt (createdAt is the warehouse
// receipt time — imports backdate it via dateReceived). When deliveredAt is
// missing (legacy rows predating the timestamp column), fall back to the
// latest "Marked as Delivered" OrderHistory entry.
// ============================================================

const RANGE_PRESET_DAYS: Record<string, number> = {
  "7d": 7,
  "1m": 30,
  "3m": 90,
  "6m": 180,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

interface DailyBreakdownEntry {
  date: string;
  total: number;
  delivered: number;
  withDriver: number;
  inWarehouse: number;
  returned: number;
}

export async function GET(request: Request) {
  // ADMIN passes via the hasPermission bypass; staff need VIEW_STATISTICS.
  const auth = await requireServerPermission(request, "VIEW_STATISTICS");
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const merchantId = searchParams.get("merchantId");
    const range = searchParams.get("range");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    // ── Resolve the time window (UTC, consistent with /api/admin/profit) ──
    let start: Date;
    let end: Date;

    if (startDate || endDate) {
      // Custom interval: both bounds required and must parse as dates.
      if (!startDate || !endDate) {
        return NextResponse.json(
          { error: "Both startDate and endDate are required for a custom interval" },
          { status: 400 },
        );
      }
      start = new Date(`${startDate}T00:00:00.000Z`);
      end = new Date(`${endDate}T23:59:59.999Z`);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return NextResponse.json(
          { error: "startDate/endDate must be valid ISO date strings" },
          { status: 400 },
        );
      }
      if (start > end) {
        return NextResponse.json(
          { error: "startDate must not be after endDate" },
          { status: 400 },
        );
      }
    } else {
      const presetKey = range ?? "1m";
      const days = RANGE_PRESET_DAYS[presetKey];
      if (!days) {
        return NextResponse.json(
          { error: `Invalid range "${range}" — expected one of: ${Object.keys(RANGE_PRESET_DAYS).join(", ")}` },
          { status: 400 },
        );
      }
      end = new Date();
      start = new Date(end.getTime() - days * DAY_MS);
    }

    // ── Base filter shared by every query below ────────────────────────────
    const baseWhere: Prisma.OrderWhereInput = {
      createdAt: { gte: start, lte: end },
      NOT: { orderId: { endsWith: "-Exchange" } },
    };
    if (merchantId) baseWhere.merchantId = merchantId;

    // ── Counts, price average, and per-order delivery timestamps ───────────
    // deliveredRows doubles as the deliveredOrders count and the input for
    // avgDeliveryTimeHours; history is only fetched for rows missing
    // deliveredAt (the nested filter keeps the payload tiny).
    const [
      totalOrders,
      returnedOrders,
      priceAgg,
      deliveredRows,
    ] = await Promise.all([
      prisma.order.count({ where: baseWhere }),
      prisma.order.count({ where: { ...baseWhere, location: "RETURN" } }),
      prisma.order.aggregate({
        where: baseWhere,
        _avg: { amountUsd: true },
      }),
      prisma.order.findMany({
        where: { ...baseWhere, location: "DELIVERED" },
        select: {
          createdAt: true,
          deliveredAt: true,
          history: {
            where: { action: { contains: "Delivered", mode: "insensitive" } },
            select: { createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      }),
    ]);

    const deliveredOrders = deliveredRows.length;

    // ── avgDeliveryTimeHours ───────────────────────────────────────────────
    // warehouse receipt (createdAt) → deliveredAt, falling back to the last
    // "Marked as Delivered" history entry. Negative durations (data-entry
    // backdating mistakes) are excluded from the average.
    let deliveryHoursSum = 0;
    let deliveryHoursCount = 0;
    for (const row of deliveredRows) {
      const deliveredAt =
        row.deliveredAt ?? row.history[0]?.createdAt ?? null;
      if (!deliveredAt) continue;
      const hours = (deliveredAt.getTime() - row.createdAt.getTime()) / (60 * 60 * 1000);
      if (!Number.isFinite(hours) || hours < 0) continue;
      deliveryHoursSum += hours;
      deliveryHoursCount += 1;
    }
    const avgDeliveryTimeHours =
      deliveryHoursCount > 0 ? round(deliveryHoursSum / deliveryHoursCount, 1) : 0;

    // ── avgOrderPrice (declared COD; amountUsd is the declared price) ─────
    const avgOrderPrice = round(priceAgg._avg.amountUsd ?? 0, 2);

    // ── returnRate ─────────────────────────────────────────────────────────
    const returnRate =
      totalOrders > 0 ? round((returnedOrders / totalOrders) * 100, 1) : 0;

    // ── avgOrdersPerDay (inclusive day count of the resolved window) ──────
    const daysInRange = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / DAY_MS),
    );
    const avgOrdersPerDay = round(totalOrders / daysInRange, 2);

    // ── dailyBreakdown (per-day status counts, UTC day buckets) ────────────
    // Location categories mirror the order lifecycle (see app/api/orders/route.ts
    // and the LOCATION_LABELS map in app/orders/page.tsx):
    //   delivered   → DELIVERED
    //   withDriver  → WITH_DRIVER + ASSIGNED + ASSIGNED_TR — the exact "With
    //                 Driver" union the orders list filter uses
    //   returned    → RETURN (RWD + Re; exchange proof orders are already
    //                 excluded by baseWhere)
    //   inWarehouse → everything else, i.e. WAREHOUSE (received / awaiting
    //                 dispatch) and CP (pickup)
    // Every day in the resolved window is emitted (zero-filled) so the chart
    // has a stable, chronologically sorted x-axis.
    const dailyRows = await prisma.order.findMany({
      where: baseWhere,
      select: { createdAt: true, location: true },
    });

    const dayMap = new Map<string, DailyBreakdownEntry>();
    for (const row of dailyRows) {
      const key = row.createdAt.toISOString().slice(0, 10);
      const entry =
        dayMap.get(key) ??
        {
          date: key,
          total: 0,
          delivered: 0,
          withDriver: 0,
          inWarehouse: 0,
          returned: 0,
        };
      entry.total += 1;
      switch (row.location) {
        case "DELIVERED":
          entry.delivered += 1;
          break;
        case "WITH_DRIVER":
        case "ASSIGNED":
        case "ASSIGNED_TR":
          entry.withDriver += 1;
          break;
        case "RETURN":
          entry.returned += 1;
          break;
        default:
          // WAREHOUSE, CP, and any legacy warehouse-side value
          entry.inWarehouse += 1;
          break;
      }
      dayMap.set(key, entry);
    }

    const dailyBreakdown: DailyBreakdownEntry[] = [];
    const firstDayUtc = Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
    );
    for (let t = firstDayUtc; t <= end.getTime(); t += DAY_MS) {
      const key = new Date(t).toISOString().slice(0, 10);
      dailyBreakdown.push(
        dayMap.get(key) ?? {
          date: key,
          total: 0,
          delivered: 0,
          withDriver: 0,
          inWarehouse: 0,
          returned: 0,
        },
      );
    }

    // ── merchantLeaderboard (only for the cross-merchant view) ────────────
    let merchantLeaderboard:
      | {
          merchantId: string;
          merchantNo: number;
          merchantName: string;
          totalOrders: number;
          deliveredOrders: number;
          returnedOrders: number;
          returnRate: number;
        }[]
      | null = null;

    if (!merchantId) {
      const scopedWhere: Prisma.OrderWhereInput = {
        ...baseWhere,
        merchantId: { not: null },
      };

      const [byMerchant, byMerchantDelivered, byMerchantReturned] =
        await Promise.all([
          prisma.order.groupBy({
            by: ["merchantId"],
            where: scopedWhere,
            _count: { _all: true },
          }),
          prisma.order.groupBy({
            by: ["merchantId"],
            where: { ...scopedWhere, location: "DELIVERED" },
            _count: { _all: true },
          }),
          prisma.order.groupBy({
            by: ["merchantId"],
            where: { ...scopedWhere, location: "RETURN" },
            _count: { _all: true },
          }),
        ]);

      const deliveredByMerchant = new Map(
        byMerchantDelivered.map((g) => [g.merchantId as string, g._count._all]),
      );
      const returnedByMerchant = new Map(
        byMerchantReturned.map((g) => [g.merchantId as string, g._count._all]),
      );

      const top = byMerchant
        .sort((a, b) => b._count._all - a._count._all)
        .slice(0, 10);

      const names = await prisma.merchant.findMany({
        where: { id: { in: top.map((g) => g.merchantId as string) } },
        select: { id: true, merchantId: true, merchantName: true },
      });
      const nameById = new Map(names.map((m) => [m.id, m]));

      merchantLeaderboard = top.map((g) => {
        const id = g.merchantId as string;
        const total = g._count._all;
        const returned = returnedByMerchant.get(id) ?? 0;
        return {
          merchantId: id,
          merchantNo: nameById.get(id)?.merchantId ?? 0,
          merchantName: nameById.get(id)?.merchantName ?? "Unknown",
          totalOrders: total,
          deliveredOrders: deliveredByMerchant.get(id) ?? 0,
          returnedOrders: returned,
          returnRate: total > 0 ? round((returned / total) * 100, 1) : 0,
        };
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          totalOrders,
          deliveredOrders,
          returnedOrders,
          returnRate,
          avgDeliveryTimeHours,
          avgOrderPrice,
          avgOrdersPerDay,
          dailyBreakdown,
          merchantLeaderboard,
          meta: {
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            days: daysInRange,
            merchantId: merchantId ?? null,
          },
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[GET /api/statistics] Error:", error);
    return NextResponse.json(
      { error: "Failed to compute statistics" },
      { status: 500 },
    );
  }
}
