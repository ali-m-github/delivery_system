import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// POST /api/drivers/payouts/items/[orderId] — Rollback a single order out of its payout batch
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    const resolvedParams = await params;
    const { orderId } = resolvedParams;

    // Fetch the order with its zone and driver info to calculate commission
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        driver: {
          include: {
            zoneRates: true,
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (!order.driverPayoutId) {
      return NextResponse.json(
        { error: "Order is not linked to any payout" },
        { status: 400 },
      );
    }

    const driverPayoutId = order.driverPayoutId;
    const driverId = order.driverId;

    // Calculate the commission for this order using the driver's zone rate
    const zoneRate = order.driver?.zoneRates?.find(
      (zr: { zoneId: string; rate: number }) => zr.zoneId === order.zoneId,
    );
    const orderCommission = zoneRate?.rate ?? 0;
    const orderAmountUsd = order.amountUsd ?? 0;

    // Execute the rollback in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Detach the order from the payout and reset to ASSIGNED
      await tx.order.update({
        where: { id: orderId },
        data: {
          driverPayoutId: null,
          location: "ASSIGNED",
          financialStatus: "WD",
        },
      });

      // 2. Fetch remaining orders still linked to this payout
      const remainingOrders = await tx.order.findMany({
        where: { driverPayoutId },
      });

      if (remainingOrders.length === 0) {
        // 3a. No orders left — delete the empty payout record
        await tx.driverPayout.delete({
          where: { id: driverPayoutId },
        });
        return { deleted: true, payoutId: driverPayoutId };
      }

      // 3b. Orders remain — recalculate sums from the remaining orders
      const newTotalUsd = remainingOrders.reduce(
        (sum, o) => sum + (o.amountUsd ?? 0),
        0,
      );
      const newTotalLbp = remainingOrders.reduce(
        (sum, o) => sum + (o.amountLbp ?? 0),
        0,
      );
      const newTotalCollected = newTotalUsd;

      // Recalculate commission from zone rates for remaining orders
      const zoneRates = await tx.driverZoneRate.findMany({
        where: { driverId: driverId || undefined },
      });
      const rateMap = new Map(zoneRates.map((zr) => [zr.zoneId, zr.rate]));
      const newCommissionUsd = remainingOrders.reduce(
        (sum, o) => sum + (rateMap.get(o.zoneId) ?? 0),
        0,
      );
      const newNetUsd = newTotalUsd - newCommissionUsd;

      await tx.driverPayout.update({
        where: { id: driverPayoutId },
        data: {
          totalUsd: newTotalUsd,
          totalLbp: newTotalLbp,
          commissionUsd: newCommissionUsd,
          netUsd: newNetUsd,
          totalCollected: newTotalCollected,
        },
      });

      return {
        deleted: false,
        payoutId: driverPayoutId,
        remainingCount: remainingOrders.length,
      };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("POST /api/drivers/payouts/items/[orderId] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
