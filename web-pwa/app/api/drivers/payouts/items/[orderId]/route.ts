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

    // Calculate commission for this order using 3-tier logic:
    // Tier 1: Seller exception rate, Tier 2: Zone rate, Tier 3: $0
    const orderMerchantId = String(order.merchantId ?? "");
    const orderZoneId = String(order.zoneId);
    const zoneRate = order.driver?.zoneRates?.find(
      (zr: { zoneId: string; rate: number }) => zr.zoneId === orderZoneId,
    );
    const orderCommission = zoneRate?.rate ?? 0;

    // Execute the rollback in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Detach the order from the payout and reset to ASSIGNED
      // Use UD (Unpaid/Undelivered) because the order is back with the driver,
      // not delivered. WD is only for delivered orders pending payout.
      await tx.order.update({
        where: { id: orderId },
        data: {
          driverPayoutId: null,
          location: "ASSIGNED",
          financialStatus: "UD",
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

      // Recalculate commission using 3-tier logic: seller exception > zone rate > $0
      const zoneRates = await tx.driverZoneRate.findMany({
        where: { driverId: driverId || undefined },
      });
      const zoneRateMap = new Map(zoneRates.map((zr) => [zr.zoneId, zr.rate]));

      // Also fetch seller exception rates for the driver
      const driverProfile = await tx.driverProfile.findUnique({
        where: { id: driverId || undefined },
        select: { userId: true },
      });

      const sellerRates = driverProfile?.userId
        ? await tx.driverSellerRate.findMany({
            where: { driverId: driverId || undefined },
          })
        : [];

      const sellerExceptionMap = new Map<string, number>();
      // A $0 seller exception is still a valid override of the zonal rate.
      for (const sr of sellerRates) {
        sellerExceptionMap.set(sr.merchantId, sr.rateUsd);
      }

      const newCommissionUsd = remainingOrders.reduce((sum, o) => {
        const merchantId = String(o.merchantId ?? "");
        const exceptionRate = merchantId
          ? sellerExceptionMap.get(merchantId)
          : undefined;
        const commission =
          exceptionRate !== undefined
            ? exceptionRate
            : (zoneRateMap.get(o.zoneId) ?? 0);
        return sum + commission;
      }, 0);
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
