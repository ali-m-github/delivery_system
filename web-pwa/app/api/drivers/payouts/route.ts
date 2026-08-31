import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import {
  loadDriverRateTable,
  enrichPayoutOrdersWithCommission,
} from "@/lib/commission";
import { requireServerPermission } from "@/lib/server-permissions";

const prisma = new PrismaClient();

// GET /api/drivers/payouts — Fetch all global payout history with advanced filtering
export async function GET(request: Request) {
  const auth = await requireServerPermission(request, "DRIVERS_VIEW");
  if (auth instanceof Response) return auth;
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
        createdBy: {
          select: {
            id: true,
            username: true,
            email: true,
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
        paidStatements: {
          include: {
            treasuryBox: {
              select: { id: true, name: true },
            },
            merchant: {
              select: { merchantName: true },
            },
          },
        },
      },
      orderBy,
    });

    // Calculate per-order driver commission using the authoritative
    // precedence from lib/commission.ts. Rate tables are loaded ONCE PER
    // DRIVER (grouped) instead of per payout — this removes the N+1
    // rate-loading the old enrichment performed.
    const byDriver = new Map<string, (typeof payouts)[number][]>();
    for (const payout of payouts) {
      const group = byDriver.get(payout.driverId) ?? [];
      group.push(payout);
      byDriver.set(payout.driverId, group);
    }

    const tableByDriver = new Map<string, Awaited<ReturnType<typeof loadDriverRateTable>>>();
    await Promise.all(
      Array.from(byDriver.entries()).map(async ([driverId, driverPayouts]) => {
        const userId = driverPayouts[0]?.driver?.userId;
        tableByDriver.set(
          driverId,
          await loadDriverRateTable(prisma, driverId, userId),
        );
      }),
    );

    const enrichedPayouts = payouts.map((payout) => {
      const rateTable = tableByDriver.get(payout.driverId)!;
      return {
        ...payout,
        orders: enrichPayoutOrdersWithCommission(rateTable, payout.orders),
      };
    });

    return NextResponse.json(enrichedPayouts, { status: 200 });
  } catch (error) {
    console.error("GET /api/drivers/payouts Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
