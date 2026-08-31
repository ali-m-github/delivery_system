import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";
import { computeOrderProfit, buildDriverExceptionMaps } from "@/lib/profit";

// ============================================================
// GET /api/admin/profit
//
// Company profit overview per cash seller, plus a per-driver
// breakdown (the same profit, attributed to the delivering driver).
//
// NOTE: profit is not stored per order — it is derived from the
// persisted records (orders + merchant rates + driver seller-rate
// exceptions), so it can be re-computed for any date range at any
// time. This keeps the "record" available for the admin panel
// without an extra snapshot table.
//
// Profit is realized only on DELIVERED orders with financial status = PS
// (Paid to Seller). Return orders are excluded. For each order:
//   profit = merchant.defaultProfitRate
//   EXCEPT orders where the driver's seller rate exception equals
//   (defaultSellerRate + defaultProfitRate) => profit = 0 for that order
//   (the driver keeps the whole fee).
//
// Query params:
//   from, to      — date range filter on the order createdAt (YYYY-MM-DD)
//   month         — optional YYYY-MM; filters the whole month
//   merchantId    — optional; restrict to a single seller
// ============================================================
export async function GET(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_FINANCE");
  if (auth instanceof Response) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const month = searchParams.get("month");
    const merchantId = searchParams.get("merchantId");

    // Build date filter on order.createdAt (consistent with the rest of the app)
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split("-").map(Number);
      dateFilter.gte = new Date(Date.UTC(y, m - 1, 1));
      dateFilter.lte = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    } else {
      if (from) dateFilter.gte = new Date(`${from}T00:00:00.000Z`);
      if (to) dateFilter.lte = new Date(`${to}T23:59:59.999Z`);
    }

    // Delivered orders with fin status PS, cash sellers only. Returns (location
    // RETURN) are excluded by the DELIVERED filter.
    const orders = await prisma.order.findMany({
      where: {
        location: "DELIVERED",
        financialStatus: "PS",
        merchant: { isCashSeller: true },
        ...(merchantId ? { merchantId } : {}),
        ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      },
      select: {
        id: true,
        orderId: true,
        amountUsd: true,
        collectedUsd: true,
        createdAt: true,
        merchantId: true,
        driverId: true,
        merchant: {
          select: {
            id: true,
            merchantName: true,
            merchantId: true,
            defaultSellerRate: true,
            defaultProfitRate: true,
          },
        },
        driver: {
          select: {
            id: true,
            userId: true,
            driverId: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Pre-build the driver exception lookup maps for all involved merchants.
    const merchantIds = Array.from(
      new Set(orders.map((o) => o.merchantId).filter((v): v is string => !!v)),
    );
    const { byUserId, byProfileId } =
      await buildDriverExceptionMaps(merchantIds);

    // Group and compute profit per seller.
    interface SellerRow {
      merchantId: string;
      merchantName: string;
      merchantNo: number;
      orderCount: number;
      totalCollectedUsd: number;
      totalProfit: number;
      feePerOrder: number;
    }
    const sellerMap = new Map<string, SellerRow>();

    // Same profit, attributed per delivering driver (admin-only view).
    interface DriverRow {
      driverProfileId: string;
      driverName: string;
      driverCode: string;
      orderCount: number;
      totalCollectedUsd: number;
      totalProfit: number;
    }
    const driverMap = new Map<string, DriverRow>();

    for (const o of orders) {
      const mid = o.merchantId ?? "";
      if (!mid || !o.merchant) continue;

      const exception =
        byUserId.get(`${o.driver?.userId}:${mid}`) ??
        byProfileId.get(`${o.driverId}:${mid}`);
      const profit = computeOrderProfit(o.merchant, exception);

      let row = sellerMap.get(mid);
      if (!row) {
        const sellerRate = o.merchant.defaultSellerRate ?? 0;
        const profitRate = o.merchant.defaultProfitRate ?? 0;
        row = {
          merchantId: mid,
          merchantName: o.merchant.merchantName,
          merchantNo: o.merchant.merchantId,
          orderCount: 0,
          totalCollectedUsd: 0,
          totalProfit: 0,
          feePerOrder: sellerRate + profitRate,
        };
        sellerMap.set(mid, row);
      }
      row.orderCount += 1;
      row.totalCollectedUsd += o.collectedUsd ?? o.amountUsd ?? 0;
      row.totalProfit += profit;

      // Per-driver attribution of the same profit.
      const dKey = o.driverId ?? "unassigned";
      let drow = driverMap.get(dKey);
      if (!drow) {
        drow = {
          driverProfileId: o.driverId ?? "",
          driverName: o.driver
            ? `${o.driver.firstName} ${o.driver.lastName}`.trim()
            : "Unassigned",
          driverCode: o.driver?.driverId ?? "—",
          orderCount: 0,
          totalCollectedUsd: 0,
          totalProfit: 0,
        };
        driverMap.set(dKey, drow);
      }
      drow.orderCount += 1;
      drow.totalCollectedUsd += o.collectedUsd ?? o.amountUsd ?? 0;
      drow.totalProfit += profit;
    }

    const sellers = Array.from(sellerMap.values()).sort(
      (a, b) => b.totalProfit - a.totalProfit,
    );

    const drivers = Array.from(driverMap.values()).sort(
      (a, b) => b.totalProfit - a.totalProfit,
    );

    const summary = sellers.reduce(
      (acc, s) => {
        acc.orderCount += s.orderCount;
        acc.totalCollectedUsd += s.totalCollectedUsd;
        acc.totalProfit += s.totalProfit;
        return acc;
      },
      {
        orderCount: 0,
        totalCollectedUsd: 0,
        totalProfit: 0,
        sellerCount: 0,
        driverCount: 0,
      },
    );
    summary.sellerCount = sellers.length;
    summary.driverCount = drivers.length;

    return NextResponse.json({ summary, sellers, drivers }, { status: 200 });
  } catch (error) {
    console.error("Admin Profit GET Error:", error);
    return NextResponse.json(
      {
        error: "Failed to load profit overview",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
