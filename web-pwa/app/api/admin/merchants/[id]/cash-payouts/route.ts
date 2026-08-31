import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computeOrderProfit, resolveDriverSellerException } from "@/lib/profit";
import { orderIdForFinancialStatus } from "@/lib/order-id";
import { requireServerPermission } from "@/lib/server-permissions";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

// ============================================================
// GET /api/admin/merchants/[id]/cash-payouts
// Fetch unpaid eligible orders, pending unresolved returns,
// and historical CashPayoutBatch records for a given merchant.
// ============================================================
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "MANAGE_FINANCE");
  if (auth instanceof Response) return auth;
  try {
    const resolvedParams = await params;
    const merchantId = resolvedParams.id;

    // Parse optional date range filters from query string
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") || null;
    const to = searchParams.get("to") || null;

    // Fetch merchant defaults for rate resolution
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { defaultSellerRate: true, defaultProfitRate: true },
    });
    // Effective per-order fee = seller rate + profit rate
    const defaultFee =
      (merchant?.defaultSellerRate ?? 4.0) + (merchant?.defaultProfitRate ?? 0);

    // Build date filter for createdAt
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(`${to}T23:59:59.999Z`);

    // 1. Unpaid Eligible Orders (not yet batched, not excluded).
    //    Any location qualifies — including RETURNs — because the seller has
    //    already been paid the advance; payments are sometimes recorded in the
    //    system days later. Only orders already claimed by a cash payout batch
    //    (as an advance or as a return deduction) are excluded.
    const unpaidOrders = await prisma.order.findMany({
      where: {
        merchantId,
        cashPayoutBatchId: null,
        returnDeductionBatchId: null,
        cashPayoutExcluded: false,
        isArchived: false,
        // Exclude exchange-generated proof orders (orderId ends with "-Exchange").
        // These duplicate the main order's price but were already paid out as part
        // of the original order, so they must never appear as eligible for a new
        // cash seller advance.
        NOT: { orderId: { endsWith: "-Exchange" } },
        ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      },
      select: {
        id: true,
        orderId: true,
        amountUsd: true,
        collectedUsd: true,
        zoneId: true,
        driverId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const unpaidOrdersWithRate = unpaidOrders.map((order) => ({
      ...order,
      sellerRate: defaultFee,
    }));

    // 2. Pending Unresolved Returns/Exchanges (not yet deducted, location RETURN,
    //    fin status Re for returns and EX for exchanges).
    //    Exclude RTS (Returned to Seller) — those are already resolved.
    const pendingReturns = await prisma.order.findMany({
      where: {
        merchantId,
        returnDeductionBatchId: null,
        location: "RETURN",
        financialStatus: { in: ["Re", "EX"] },
      },
      select: {
        id: true,
        orderId: true,
        amountUsd: true,
        driverId: true,
        financialStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const pendingReturnsWithRate = pendingReturns.map((order) => ({
      ...order,
      sellerRate: defaultFee,
    }));

    // 3. Historical Batches (all CashPayoutBatch records for this merchant)
    const batches = await prisma.cashPayoutBatch.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      include: {
        orders: {
          select: {
            id: true,
            orderId: true,
            amountUsd: true,
            collectedUsd: true,
            location: true,
            createdAt: true,
          },
        },
        resolvedReturns: {
          select: {
            id: true,
            orderId: true,
            amountUsd: true,
            createdAt: true,
          },
        },
        adjustments: {
          select: {
            id: true,
            description: true,
            amountUsd: true,
            amountLbp: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return NextResponse.json(
      {
        unpaidOrders: unpaidOrdersWithRate,
        pendingReturns: pendingReturnsWithRate,
        batches,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("CashPayouts GET Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// ============================================================
// POST /api/admin/merchants/[id]/cash-payouts
// Execute a batch cash advance payout with rolling return
// deductions and manual adjustments in a single atomic
// Prisma transaction.
//
// Profit model: per order the fee charged is (sellerRate + profitRate).
// The company profit is profitRate unless the driver's seller rate
// exception equals the fee — in that case profit is zero for that order
// (the driver keeps the whole fee) but the order is still deducted at fee.
// ============================================================
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "MANAGE_FINANCE");
  if (auth instanceof Response) return auth;
  try {
    const resolvedParams = await params;
    const merchantId = resolvedParams.id;

    const body = await request.json();
    const {
      orderIds = [],
      returnIds = [],
      sellerRateOverride,
      adjustments = [],
    }: {
      orderIds?: string[];
      returnIds?: string[];
      sellerRateOverride?: number;
      adjustments?: { description: string; amountUsd: number }[];
    } = body;

    // --- Run the entire batch creation inside an atomic transaction ---
    const batch = await prisma.$transaction(async (tx) => {
      // 1. Fetch the Merchant to retrieve default rates
      const merchant = await tx.merchant.findUnique({
        where: { id: merchantId },
        select: {
          merchantId: true,
          defaultSellerRate: true,
          defaultProfitRate: true,
        },
      });

      if (!merchant) {
        throw new Error("Merchant not found");
      }

      const sellerRate =
        sellerRateOverride ?? merchant.defaultSellerRate ?? 4.0;
      const profitRate = merchant.defaultProfitRate ?? 0;
      const fee = sellerRate + profitRate;

      // 2. Fetch target orders and calculate grossAdvance + profit
      const advanceOrders = orderIds.length
        ? await tx.order.findMany({
            where: {
              id: { in: orderIds },
              merchantId,
              cashPayoutBatchId: null,
            },
            select: {
              id: true,
              orderId: true,
              amountUsd: true,
              driverId: true,
              createdAt: true,
            },
          })
        : [];

      let grossAdvance = 0;
      let profit = 0;

      for (const o of advanceOrders) {
        const driverException = await resolveDriverSellerException(
          o.driverId,
          merchantId,
        );
        grossAdvance += (o.amountUsd ?? 0) - fee;
        profit += computeOrderProfit(
          { defaultSellerRate: sellerRate, defaultProfitRate: profitRate },
          driverException,
        );
      }

      // 3. Fetch return orders and calculate deductedReturns (same per-order fee)
      const returnOrders = returnIds.length
        ? await tx.order.findMany({
            where: {
              id: { in: returnIds },
              merchantId,
              returnDeductionBatchId: null,
            },
            select: {
              id: true,
              orderId: true,
              amountUsd: true,
              driverId: true,
              createdAt: true,
            },
          })
        : [];

      let deductedReturns = 0;

      for (const o of returnOrders) {
        deductedReturns += (o.amountUsd ?? 0) - fee;
      }

      // 4. Sum manual adjustments
      const totalAdjustments = (
        adjustments as { description: string; amountUsd: number }[]
      ).reduce((sum, adj) => sum + (adj.amountUsd ?? 0), 0);

      // 5. Calculate net paid (grossAdvance - deductedReturns + adjustments)
      const netPaid = grossAdvance - deductedReturns + totalAdjustments;

      // 6. Generate meaningful batch reference: {merchantId}-{DDMMYYYY}
      // The date reflects the ORDERS' date (latest order createdAt in the
      // batch), NOT the date the payout was recorded — so a payout created
      // late still references the day the orders were placed.
      // Add sequence suffix only if another payout already claims the same
      // seller+date (unique constraint).
      const allOrderDates = [
        ...advanceOrders.map((o) => o.createdAt),
        ...returnOrders.map((o) => o.createdAt),
      ].filter((d): d is Date => d instanceof Date);
      const batchDate = allOrderDates.length
        ? new Date(Math.max(...allOrderDates.map((d) => d.getTime())))
        : new Date();
      const day = String(batchDate.getDate()).padStart(2, "0");
      const month = String(batchDate.getMonth() + 1).padStart(2, "0");
      const year = batchDate.getFullYear();
      const dateKey = `${merchant.merchantId}-${day}${month}${year}`;
      const existingToday = await tx.cashPayoutBatch.count({
        where: {
          merchantId,
          batchReference: { startsWith: dateKey },
        },
      });
      const batchReference =
        existingToday === 0 ? dateKey : `${dateKey}-${existingToday + 1}`;

      // 7. Create the CashPayoutBatch record
      const cashPayoutBatch = await tx.cashPayoutBatch.create({
        data: {
          merchantId,
          batchReference,
          grossAdvance,
          deductedReturns,
          netPaid,
          profit,
        },
      });

      // 8. Create PayoutAdjustment records linked to the new batch
      if (
        (adjustments as { description: string; amountUsd: number }[]).length
      ) {
        await tx.payoutAdjustment.createMany({
          data: (
            adjustments as { description: string; amountUsd: number }[]
          ).map((adj) => ({
            batchId: cashPayoutBatch.id,
            description: adj.description,
            amountUsd: adj.amountUsd ?? 0,
          })),
        });
      }

      // 9. Update all advance orders — link to the new batch
      if (orderIds.length) {
        await tx.order.updateMany({
          where: {
            id: { in: orderIds },
            merchantId,
            cashPayoutBatchId: null,
          },
          data: {
            cashPayoutBatchId: cashPayoutBatch.id,
          },
        });
      }

      // 10. Update all return orders — link to batch + mark RTS (Returned to Seller)
      if (returnIds.length) {
        await Promise.all(
          returnOrders.map((o) =>
            tx.order.update({
              where: { id: o.id },
              data: {
                orderId: orderIdForFinancialStatus(o.orderId, "RTS"),
                returnDeductionBatchId: cashPayoutBatch.id,
                financialStatus: "RTS",
              },
            }),
          ),
        );
      }

      return cashPayoutBatch;
    });

    return NextResponse.json(batch, { status: 201 });
  } catch (error: unknown) {
    console.error("CashPayouts POST Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
