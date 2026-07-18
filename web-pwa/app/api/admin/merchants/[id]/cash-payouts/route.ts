import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ============================================================
// GET /api/admin/merchants/[id]/cash-payouts
// Fetch unpaid eligible orders, pending unresolved returns,
// and historical CashPayoutBatch records for a given merchant.
// ============================================================
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
      select: { defaultSellerRate: true },
    });
    const defaultRate = merchant?.defaultSellerRate ?? 4.0;

    // Build date filter for createdAt
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(`${to}T23:59:59.999Z`);

    // 1. Unpaid Eligible Orders (not yet batched, not excluded, location WAREHOUSE, ASSIGNED, or DELIVERED)
    const rawOrders = await prisma.order.findMany({
      where: {
        merchantId,
        cashPayoutBatchId: null,
        cashPayoutExcluded: false,
        location: { in: ["WAREHOUSE", "ASSIGNED", "DELIVERED"] },
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

    // Resolve per-order effective seller rate (check both DriverSellerRate and DriverCashSellerRate)
    const unpaidOrders = await Promise.all(
      rawOrders.map(async (order) => {
        let sellerRate = defaultRate;
        if (order.driverId) {
          // Check DriverSellerRate first (references DriverProfile.id)
          const exception = await prisma.driverSellerRate.findUnique({
            where: {
              driverId_merchantId: { driverId: order.driverId, merchantId },
            },
          });
          if (exception && exception.rateUsd > 0) {
            sellerRate = exception.rateUsd;
          } else {
            // Check DriverCashSellerRate (references User.id)
            const profile = await prisma.driverProfile.findUnique({
              where: { id: order.driverId },
              select: { userId: true },
            });
            if (profile) {
              const cashRate = await prisma.driverCashSellerRate.findUnique({
                where: {
                  driverId_merchantId: {
                    driverId: profile.userId,
                    merchantId,
                  },
                },
              });
              if (cashRate && cashRate.rateUsd > 0) {
                sellerRate = cashRate.rateUsd;
              }
            }
          }
        }
        return { ...order, sellerRate };
      }),
    );

    // 2. Pending Unresolved Returns (not yet deducted, location RETURN, fin status Re only)
    // Exclude RTS (Returned to Seller) — those are already resolved.
    const rawReturns = await prisma.order.findMany({
      where: {
        merchantId,
        returnDeductionBatchId: null,
        location: "RETURN",
        financialStatus: "Re",
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

    const pendingReturns = await Promise.all(
      rawReturns.map(async (order) => {
        let sellerRate = defaultRate;
        if (order.driverId) {
          const exception = await prisma.driverSellerRate.findUnique({
            where: {
              driverId_merchantId: { driverId: order.driverId, merchantId },
            },
          });
          if (exception && exception.rateUsd > 0) {
            sellerRate = exception.rateUsd;
          } else {
            const profile = await prisma.driverProfile.findUnique({
              where: { id: order.driverId },
              select: { userId: true },
            });
            if (profile) {
              const cashRate = await prisma.driverCashSellerRate.findUnique({
                where: {
                  driverId_merchantId: {
                    driverId: profile.userId,
                    merchantId,
                  },
                },
              });
              if (cashRate && cashRate.rateUsd > 0) {
                sellerRate = cashRate.rateUsd;
              }
            }
          }
        }
        return { ...order, sellerRate };
      }),
    );

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
      { unpaidOrders, pendingReturns, batches },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("CashPayouts GET Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    );
  }
}

// ============================================================
// POST /api/admin/merchants/[id]/cash-payouts
// Execute a batch cash advance payout with rolling return
// deductions and manual adjustments in a single atomic
// Prisma transaction.
// ============================================================
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
        select: { defaultSellerRate: true, defaultCompanyRate: true },
      });

      if (!merchant) {
        throw new Error("Merchant not found");
      }

      const defaultSellerRate =
        sellerRateOverride ?? merchant.defaultSellerRate ?? 4.0;

      const companyRate = merchant.defaultCompanyRate ?? 3.0;

      // Helper: resolve the effective seller rate for a given driver.
      // Checks DriverSellerRate (driver↔merchant exception) and
      // DriverCashSellerRate (cash seller rate) before falling back.
      const resolveSellerRate = async (
        driverProfileId: string | null,
      ): Promise<number> => {
        if (driverProfileId) {
          // Check DriverSellerRate exception first
          const exception = await tx.driverSellerRate.findUnique({
            where: {
              driverId_merchantId: { driverId: driverProfileId, merchantId },
            },
          });
          if (exception && exception.rateUsd > 0) {
            return exception.rateUsd;
          }

          // Check DriverCashSellerRate (references User.id, so fetch userId from DriverProfile)
          const profile = await tx.driverProfile.findUnique({
            where: { id: driverProfileId },
            select: { userId: true },
          });
          if (profile) {
            const cashRate = await tx.driverCashSellerRate.findUnique({
              where: {
                driverId_merchantId: { driverId: profile.userId, merchantId },
              },
            });
            if (cashRate && cashRate.rateUsd > 0) {
              return cashRate.rateUsd;
            }
          }
        }
        return defaultSellerRate;
      };

      // 2. Fetch target orders and calculate grossAdvance + companyProfit
      const advanceOrders = orderIds.length
        ? await tx.order.findMany({
            where: {
              id: { in: orderIds },
              merchantId,
              cashPayoutBatchId: null,
            },
            select: { id: true, amountUsd: true, driverId: true },
          })
        : [];

      let grossAdvance = 0;
      let companyProfit = 0;

      for (const o of advanceOrders) {
        const effectiveRate = await resolveSellerRate(o.driverId);
        grossAdvance += (o.amountUsd ?? 0) - effectiveRate;
        companyProfit += effectiveRate - companyRate;
      }

      // 3. Fetch return orders and calculate deductedReturns
      const returnOrders = returnIds.length
        ? await tx.order.findMany({
            where: {
              id: { in: returnIds },
              merchantId,
              returnDeductionBatchId: null,
            },
            select: { id: true, amountUsd: true, driverId: true },
          })
        : [];

      let deductedReturns = 0;

      for (const o of returnOrders) {
        const effectiveRate = await resolveSellerRate(o.driverId);
        deductedReturns += (o.amountUsd ?? 0) - effectiveRate;
      }

      // 4. Sum manual adjustments
      const totalAdjustments = (
        adjustments as { description: string; amountUsd: number }[]
      ).reduce((sum, adj) => sum + (adj.amountUsd ?? 0), 0);

      // 5. Calculate net paid (grossAdvance - deductedReturns + adjustments)
      const netPaid = grossAdvance - deductedReturns + totalAdjustments;

      // 6. Generate unique batch reference
      const batchReference = `CPB-${Date.now()}`;

      // 7. Create the CashPayoutBatch record
      const cashPayoutBatch = await tx.cashPayoutBatch.create({
        data: {
          merchantId,
          batchReference,
          grossAdvance,
          deductedReturns,
          netPaid,
          companyProfit,
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
        await tx.order.updateMany({
          where: {
            id: { in: returnIds },
            merchantId,
            returnDeductionBatchId: null,
          },
          data: {
            returnDeductionBatchId: cashPayoutBatch.id,
            financialStatus: "RTS",
          },
        });
      }

      return cashPayoutBatch;
    });

    return NextResponse.json(batch, { status: 201 });
  } catch (error: any) {
    console.error("CashPayouts POST Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    );
  }
}
