import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { loadDriverRateTable, enrichPayoutOrdersWithCommission } from "@/lib/commission";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/jwt";

// GET /api/driver/my-payouts — Fetch payouts for the logged-in driver only
export async function GET(request: Request) {
  try {
    // ── Read & verify session cookie ──
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await verifySessionToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const userId = payload.id;

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
        createdBy: {
          select: { id: true, username: true, email: true },
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

    // Per-order commission via the authoritative module (seller exception ∪
    // cash-seller exception → zone rate → MISSING). An explicitly configured
    // $0 is a valid figure; a missing rate yields driverCommissionUsd: null
    // ("Rate not configured") — never a silent $0.
    const rateTable = await loadDriverRateTable(prisma, driverId, userId);

    const enrichedPayouts = payouts.map((payout) => ({
      ...payout,
      orders: enrichPayoutOrdersWithCommission(rateTable, payout.orders),
    }));

    return NextResponse.json(enrichedPayouts, { status: 200 });
  } catch (error) {
    console.error("GET /api/driver/my-payouts Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
