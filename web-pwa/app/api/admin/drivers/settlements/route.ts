import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET() {
  try {
    // Fetch all drivers and their un-reconciled delivered orders
    const drivers = await prisma.user.findMany({
      where: { role: "DRIVER" },
      include: {
        driverProfile: {
          include: {
            deliveries: {
              where: {
                location: "DELIVERED",
                financialStatus: "WD", // Only orders where the driver is holding cash (With Driver)
              },
            },
          },
        },
      },
    });

    // Map through drivers to calculate their exact cash holdings
    const settlements = drivers.map((driver) => {
      const deliveries = driver.driverProfile?.deliveries ?? [];
      let totalUsd = 0;
      let totalLbp = 0;

      deliveries.forEach((order) => {
        totalUsd += order.collectedUsd || 0;
        totalLbp += order.collectedLbp || 0;
      });

      return {
        driverId: driver.id,
        driverName: driver.username,
        orderCount: deliveries.length,
        pendingOrders: deliveries.map((o) => o.id), // Store IDs for the bulk update later
        totalUsd,
        totalLbp,
      };
    });

    return NextResponse.json(settlements, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { driverId, orderIds } = await request.json();

    if (!driverId || !orderIds || orderIds.length === 0) {
      return NextResponse.json(
        { error: "Missing driver or orders payload" },
        { status: 400 },
      );
    }

    // Update all provided orders from UD to Settled
    const result = await prisma.order.updateMany({
      where: {
        id: { in: orderIds },
        driverId: driverId,
        location: "DELIVERED", // Strict safety check: only Delivered orders hold cash
        financialStatus: "WD",
      },
      data: {
        financialStatus: "Settled",
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: `Successfully settled ${result.count} orders.`,
        count: result.count,
      },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
