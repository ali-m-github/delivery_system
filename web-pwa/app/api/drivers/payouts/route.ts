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
          },
        },
        orders: {
          include: {
            zone: {
              select: { name: true },
            },
          },
        },
      },
      orderBy,
    });

    return NextResponse.json(payouts, { status: 200 });
  } catch (error) {
    console.error("GET /api/drivers/payouts Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
