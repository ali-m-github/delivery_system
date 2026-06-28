import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// GET /api/drivers/[id]/payouts — Fetch all pending DriverPayouts for a driver
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await params;
    const driverId = resolvedParams.id;

    const payouts = await prisma.driverPayout.findMany({
      where: {
        driverId,
        status: "PENDING",
      },
      include: {
        orders: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(payouts, { status: 200 });
  } catch (error) {
    console.error("GET /api/drivers/[id]/payouts Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// POST /api/drivers/[id]/payouts — Create a new payout batch from delivered orders
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await params;
    const driverId = resolvedParams.id;

    const body = await request.json();
    const { orderIds, totalUsd, totalLbp, commissionUsd, netUsd } = body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "orderIds must be a non-empty array" },
        { status: 400 },
      );
    }

    // Fetch the orders from the DB to prevent client-side spoofing
    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds },
        driverId,
        location: "DELIVERED",
        financialStatus: "WD",
      },
    });

    if (orders.length === 0) {
      return NextResponse.json(
        { error: "No valid delivered orders found for the provided IDs" },
        { status: 400 },
      );
    }

    // Calculate totals from DB values (server-side, not trusting client)
    const dbTotalUsd = orders.reduce((sum, o) => sum + (o.amountUsd || 0), 0);
    const dbTotalLbp = orders.reduce((sum, o) => sum + (o.amountLbp || 0), 0);

    // Sanitize numeric values to prevent Prisma type crashes (NaN / undefined)
    const safeTotalUsd = parseFloat(String(dbTotalUsd)) || 0;
    const safeTotalLbp = parseFloat(String(dbTotalLbp)) || 0;

    // Use client-provided commission and net, or fall back to zone-based calculation
    const safeCommissionUsd =
      typeof commissionUsd === "number" && commissionUsd >= 0
        ? parseFloat(String(commissionUsd)) || 0
        : await (async () => {
            // Fetch driver's zone rates for server-side fallback
            const zoneRates = await prisma.driverZoneRate.findMany({
              where: { driverId },
            });
            const rateMap = new Map(
              zoneRates.map((zr) => [zr.zoneId, zr.rate]),
            );
            return orders.reduce(
              (sum, o) => sum + (rateMap.get(o.zoneId) ?? 0),
              0,
            );
          })();

    const safeNetUsd =
      typeof netUsd === "number"
        ? parseFloat(String(netUsd)) || 0
        : safeTotalUsd - safeCommissionUsd;

    // Count existing payouts for this driver to generate sequential index
    const priorCount = await prisma.driverPayout.count({ where: { driverId } });

    // Create the payout record and update orders in a transaction
    const payout = await prisma.$transaction(async (tx) => {
      const payoutRecord = await tx.driverPayout.create({
        data: {
          driverId,
          sequentialIndex: priorCount + 1,
          totalUsd: safeTotalUsd,
          totalLbp: safeTotalLbp,
          commissionUsd: safeCommissionUsd,
          netUsd: safeNetUsd,
          totalCollected: safeTotalUsd,
          status: "PENDING",
        },
      });

      // Update all provided orders to link to this payout and mark as PP (Pending Payout)
      await tx.order.updateMany({
        where: {
          id: { in: orderIds },
          driverId,
          location: "DELIVERED",
          financialStatus: "WD",
        },
        data: {
          driverPayoutId: payoutRecord.id,
          financialStatus: "PP",
        },
      });

      return tx.driverPayout.findUnique({
        where: { id: payoutRecord.id },
        include: { orders: true },
      });
    });

    return NextResponse.json(payout, { status: 201 });
  } catch (error) {
    console.error("POST /api/drivers/[id]/payouts Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
