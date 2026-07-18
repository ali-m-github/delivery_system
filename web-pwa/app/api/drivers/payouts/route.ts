import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// GET /api/drivers/payouts — Fetch all global payout history with advanced filtering
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "ALL";
    const startDate = searchParams.get("startDate") || "";
    const endDate = searchParams.get("endDate") || "";
    const sortBy = searchParams.get("sortBy") || "createdAt"; // createdAt | totalUsd
    const sortDir = searchParams.get("sortDir") || "desc"; // asc | desc
    const minAmount = searchParams.get("minAmount") || "";

    // ── Build AND conditions ──
    const andConditions: any[] = [];

    // Status filter
    if (status !== "ALL") {
      andConditions.push({ status });
    }

    // Date range filter (merge gte/lte on createdAt)
    const dateFilter: any = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    if (Object.keys(dateFilter).length > 0) {
      andConditions.push({ createdAt: dateFilter });
    }

    // Minimum USD amount filter
    if (minAmount) {
      const minVal = parseFloat(minAmount);
      if (!isNaN(minVal)) {
        andConditions.push({ totalUsd: { gte: minVal } });
      }
    }

    // Search filter — driver name, driver internal ID, or payout sequential index
    if (search) {
      const seqIndex = parseInt(search);
      const isNumeric = !isNaN(seqIndex);

      const orConditions: any[] = [
        {
          driver: {
            firstName: { contains: search, mode: "insensitive" },
          },
        },
        {
          driver: {
            lastName: { contains: search, mode: "insensitive" },
          },
        },
        {
          driver: {
            driverId: { contains: search, mode: "insensitive" },
          },
        },
      ];

      if (isNumeric) {
        orConditions.push({ sequentialIndex: seqIndex });
      }

      andConditions.push({ OR: orConditions });
    }

    const where = andConditions.length > 0 ? { AND: andConditions } : {};

    // ── Sort order ──
    const orderBy: any = {
      [sortBy]: sortDir,
    };

    const payouts = await prisma.driverPayout.findMany({
      where,
      include: {
        driver: {
          select: {
            id: true,
            driverId: true,
            firstName: true,
            lastName: true,
            carriedDebtUsd: true,
            carriedDebtLbp: true,
            userId: true,
          },
        },
        orders: {
          include: {
            zone: {
              select: { name: true },
            },
            merchant: {
              select: { merchantName: true },
            },
          },
        },
      },
      orderBy,
    });

    // Calculate per-order driver commission using the same 3-tier logic
    const enrichedPayouts = await Promise.all(
      payouts.map(async (payout) => {
        const driverId = payout.driverId;
        const userId = payout.driver.userId;

        // Fetch driver zone rates, seller exception rates, and cash seller rates
        const [zoneRates, sellerRates, cashSellerRates] = await Promise.all([
          prisma.driverZoneRate.findMany({ where: { driverId } }),
          prisma.driverSellerRate.findMany({ where: { driverId } }),
          userId
            ? prisma.driverCashSellerRate.findMany({
                where: { driverId: userId },
              })
            : Promise.resolve([]),
        ]);

        const zoneRateMap = new Map(
          zoneRates.map((zr) => [zr.zoneId, zr.rate]),
        );
        const sellerExceptionMap = new Map<string, number>();
        for (const sr of sellerRates) {
          if (sr.rateUsd > 0) sellerExceptionMap.set(sr.merchantId, sr.rateUsd);
        }
        for (const cr of cashSellerRates) {
          if (cr.rateUsd > 0) sellerExceptionMap.set(cr.merchantId, cr.rateUsd);
        }

        const ordersWithCommission = payout.orders.map((order) => {
          const orderMerchantId = String(order.merchantId ?? "");
          const orderZoneId = String(order.zoneId);

          // Tier 1: Seller Exception
          const exceptionRate = orderMerchantId
            ? sellerExceptionMap.get(orderMerchantId)
            : undefined;
          const driverCommissionUsd =
            exceptionRate !== undefined
              ? exceptionRate
              : (zoneRateMap.get(orderZoneId) ?? 0);

          return {
            ...order,
            driverCommissionUsd,
          };
        });

        return {
          ...payout,
          orders: ordersWithCommission,
        };
      }),
    );

    return NextResponse.json(enrichedPayouts, { status: 200 });
  } catch (error) {
    console.error("GET /api/drivers/payouts Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
