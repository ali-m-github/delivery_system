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
        // These carry no price of their own (the COD value belongs to the main
        // order, already paid out as part of the original advance), so they must
        // never appear as eligible for a new cash seller advance.
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

    // 2. Pending Unresolved Returns/Exchanges that were NOT handed over through
    //    a Return Batch (legacy/manual returns only — location RETURN, fin
    //    status Re for returns and EX for exchanges). Batched returns are
    //    served as ReturnBatch cards below (section 2b).
    const pendingReturns = await prisma.order.findMany({
      where: {
        merchantId,
        returnDeductionBatchId: null,
        returnBatchId: null,
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

    // "-Exchange" proof orders (orderId ends with "-Exchange") are just the
    // item coming back to the merchant — they carry no price of their own, so
    // they must be listed with a NULL price and a $0 deduction. This also
    // covers legacy rows created before the fix (which still hold the main
    // order's amountUsd).
    const pendingReturnsWithRate = pendingReturns.map((order) => ({
      ...order,
      amountUsd: order.orderId.endsWith("-Exchange") ? null : order.amountUsd,
      sellerRate: defaultFee,
    }));

    // 2b. Pending Return Batches (Universal Staff Scanner → Return to Seller).
    //     Unsettled batches are offered as single selectable cards; selecting a
    //     batch settles ALL of its orders at once. The per-batch deduction
    //     total is computed here with the exact same formula the POST uses
    //     (amountUsd - fee, $0 for "-Exchange" proof orders) so the UI total
    //     and the settled amount can never diverge.
    const returnBatches = await prisma.returnBatch.findMany({
      where: { merchantId, status: { not: "SETTLED" } },
      select: {
        id: true,
        batchNumber: true,
        status: true,
        totalOrders: true,
        createdAt: true,
        orders: {
          select: {
            id: true,
            orderId: true,
            amountUsd: true,
            financialStatus: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const pendingReturnBatches = returnBatches.map((batch) => {
      let totalDeduction = 0;
      for (const o of batch.orders) {
        if (o.orderId.endsWith("-Exchange")) continue;
        totalDeduction += (o.amountUsd ?? 0) - defaultFee;
      }
      return {
        ...batch,
        orders: batch.orders.map((o) => ({
          ...o,
          amountUsd: o.orderId.endsWith("-Exchange") ? null : o.amountUsd,
        })),
        totalDeduction,
        sellerRate: defaultFee,
      };
    });

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
        pendingReturnBatches,
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
      returnBatchIds = [],
      sellerRateOverride,
      adjustments = [],
    }: {
      orderIds?: string[];
      returnIds?: string[];
      returnBatchIds?: string[];
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
        // "-Exchange" proof orders carry no price and must never be advanced
        // (defensive guard — the UI excludes them from eligibility).
        if (o.orderId.endsWith("-Exchange")) continue;
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

      // 3. Fetch return orders and calculate deductedReturns (same per-order
      //    fee). Returns arrive either as individual IDs (legacy unbatched
      //    returns) or via Return Batch IDs (Universal Staff Scanner handoffs —
      //    selecting a batch settles ALL of its orders at once).
      const selectedBatches = returnBatchIds.length
        ? await tx.returnBatch.findMany({
            where: {
              id: { in: returnBatchIds },
              merchantId,
              status: { not: "SETTLED" },
            },
            select: { id: true, orders: { select: { id: true } } },
          })
        : [];
      const batchOrderIds = selectedBatches.flatMap((b) =>
        b.orders.map((o) => o.id),
      );

      const returnOrders =
        returnIds.length || batchOrderIds.length
          ? await tx.order.findMany({
              where: {
                id: { in: Array.from(new Set([...returnIds, ...batchOrderIds])) },
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
        // "-Exchange" proof orders are just the item coming back to the
        // merchant — they carry no price (null), so they deduct $0. This also
        // covers legacy rows that still hold the main order's amountUsd.
        if (o.orderId.endsWith("-Exchange")) continue;
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
      if (returnOrders.length) {
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

      // 11. Settle the selected Return Batches — link them to this payout so
      //     the merchant/admin views can show settlement status.
      if (selectedBatches.length) {
        await tx.returnBatch.updateMany({
          where: { id: { in: selectedBatches.map((b) => b.id) } },
          data: { status: "SETTLED", cashPayoutBatchId: cashPayoutBatch.id },
        });
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
