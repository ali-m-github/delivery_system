import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import prisma from "@/lib/prisma";

// GET /api/driver/my-payouts — Fetch payouts for the logged-in driver only
export async function GET(request: Request) {
  try {
    // ── Read & verify session cookie ──
    const cookieStore = await cookies();
    const token = cookieStore.get("session")?.value;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let userId: string;
    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET);
      const { payload } = await jwtVerify(token, secret);
      userId = payload.id as string;
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // ── Resolve driver profile ──
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!driverProfile) {
      return NextResponse.json(
        { error: "Driver profile not found" },
        { status: 404 },
      );
    }

    const driverId = driverProfile.id;

    // ── Parse query params ──
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "";
    const startDate = searchParams.get("startDate") || "";
    const endDate = searchParams.get("endDate") || "";
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortDir = searchParams.get("sortDir") || "desc";

    // ── Build where clause ──
    const andConditions: any[] = [{ driverId }];

    if (status) {
      andConditions.push({ status });
    }

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

    const where =
      andConditions.length > 0 ? { AND: andConditions } : { driverId };

    // ── Sort order ──
    const orderBy: any = {
      [sortBy]: sortDir,
    };

    // ── Fetch payouts ──
    const payouts = await prisma.driverPayout.findMany({
      where,
      include: {
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
    const [zoneRates, sellerRates] = await Promise.all([
      prisma.driverZoneRate.findMany({ where: { driverId } }),
      prisma.driverSellerRate.findMany({ where: { driverId } }),
    ]);

    const zoneRateMap = new Map(zoneRates.map((zr) => [zr.zoneId, zr.rate]));
    const sellerExceptionMap = new Map<string, number>();
    for (const sr of sellerRates) {
      if (sr.rateUsd > 0) sellerExceptionMap.set(sr.merchantId, sr.rateUsd);
    }

    const enrichedPayouts = payouts.map((payout) => {
      const ordersWithCommission = payout.orders.map((order) => {
        const orderMerchantId = String(order.merchantId ?? "");
        const orderZoneId = String(order.zoneId);

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
    });

    return NextResponse.json(enrichedPayouts, { status: 200 });
  } catch (error) {
    console.error("GET /api/driver/my-payouts Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
