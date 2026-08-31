import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  loadDriverRateTable,
  recalcPayoutTotals,
} from "@/lib/commission";
import { requireServerPermission } from "@/lib/server-permissions";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

// POST /api/drivers/payouts/items/[orderId] — Rollback a single order out of its payout batch
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const auth = await requireServerPermission(request, "DRIVERS_PAYOUT");
  if (auth instanceof Response) return auth;
  try {
    const resolvedParams = await params;
    const { orderId } = resolvedParams;

    // Fetch the order with its driver info (needed to build the commission
    // rate table for the recalculation below)
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, driverId: true, driverPayoutId: true },
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
    if (!driverId) {
      return NextResponse.json(
        { error: "Order has no assigned driver" },
        { status: 400 },
      );
    }

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

      // 2. Fetch remaining orders still linked to this payout (only the
      // financial fields the recalculation needs)
      const remainingOrders = await tx.order.findMany({
        where: { driverPayoutId },
        select: {
          id: true,
          amountUsd: true,
          amountLbp: true,
          collectedUsd: true,
          collectedLbp: true,
          zoneId: true,
          merchantId: true,
        },
      });

      if (remainingOrders.length === 0) {
        // 3a. No orders left — delete the empty payout record
        await tx.driverPayout.delete({
          where: { id: driverPayoutId },
        });
        return { deleted: true, payoutId: driverPayoutId };
      }

      // 3b. Orders remain — recalculate sums from the remaining orders via
      // the authoritative commission module (same figures as payout creation):
      // gross = collected > 0 else amount; commission = seller exception
      // (cash-seller wins) → zone → $0; net = gross − commission.
      const rateTable = await loadDriverRateTable(tx, driverId);
      const recalced = recalcPayoutTotals(rateTable, remainingOrders);

      await tx.driverPayout.update({
        where: { id: driverPayoutId },
        data: {
          totalUsd: recalced.totalUsd,
          totalLbp: recalced.totalLbp,
          commissionUsd: recalced.commissionUsd,
          netUsd: recalced.netUsd,
          totalCollected: recalced.totalCollected,
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
