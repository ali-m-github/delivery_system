import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// POST /api/driver-payouts — Clear WD orders to WO (With Office)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      driverId,
      orderIds,
      totalCollectedUsd,
      totalCollectedLbp,
      commissionUsd,
      netUsd,
    } = body;

    if (
      !driverId ||
      !orderIds ||
      !Array.isArray(orderIds) ||
      orderIds.length === 0
    ) {
      return NextResponse.json(
        { error: "driverId and orderIds (non-empty array) are required" },
        { status: 400 },
      );
    }

    // Validate orders belong to the driver, are delivered, and in WD status
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
        {
          error: "No valid WD (With Driver) orders found for the provided IDs",
        },
        { status: 400 },
      );
    }

    // Recalculate totals server-side from actual DB values (collectedUsd || amountUsd)
    const dbTotalUsd = orders.reduce(
      (sum, o) => sum + (o.collectedUsd || o.amountUsd || 0),
      0,
    );
    const dbTotalLbp = orders.reduce(
      (sum, o) => sum + (o.collectedLbp || o.amountLbp || 0),
      0,
    );

    // Fetch driver zone rates for server-side commission fallback
    const zoneRates = await prisma.driverZoneRate.findMany({
      where: { driverId },
    });
    const rateMap = new Map(zoneRates.map((zr) => [zr.zoneId, zr.rate]));

    const dbCommission = orders.reduce(
      (sum, o) => sum + (rateMap.get(o.zoneId) ?? 0),
      0,
    );

    // Sanitize values
    const safeTotalUsd =
      parseFloat(String(totalCollectedUsd ?? dbTotalUsd)) || 0;
    const safeTotalLbp =
      parseFloat(String(totalCollectedLbp ?? dbTotalLbp)) || 0;
    const safeCommission =
      typeof commissionUsd === "number" && commissionUsd >= 0
        ? parseFloat(String(commissionUsd)) || 0
        : dbCommission;
    const safeNetUsd =
      typeof netUsd === "number"
        ? parseFloat(String(netUsd)) || 0
        : safeTotalUsd - safeCommission;

    const result = await prisma.$transaction(async (tx) => {
      // Fetch the highest sequentialIndex for this driver
      const lastPayout = await tx.driverPayout.findFirst({
        where: { driverId },
        orderBy: { sequentialIndex: "desc" },
        select: { sequentialIndex: true },
      });
      const nextIndex = (lastPayout?.sequentialIndex ?? 0) + 1;

      // Create the DriverPayout ledger record
      const payout = await tx.driverPayout.create({
        data: {
          driverId,
          sequentialIndex: nextIndex,
          totalUsd: safeTotalUsd,
          totalLbp: safeTotalLbp,
          commissionUsd: safeCommission,
          netUsd: safeNetUsd,
          totalCollected: safeTotalUsd,
          status: "CLEARED",
          clearedAt: new Date(),
        },
      });

      // Update orders: change financialStatus to WO and link driverPayoutId
      await tx.order.updateMany({
        where: {
          id: { in: orderIds },
          driverId,
          location: "DELIVERED",
          financialStatus: "WD",
        },
        data: {
          driverPayoutId: payout.id,
          financialStatus: "WO",
        },
      });

      return tx.driverPayout.findUnique({
        where: { id: payout.id },
        include: { orders: true },
      });
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("POST /api/driver-payouts Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
