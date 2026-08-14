import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// ─── PATCH /api/admin/orders/return ──────────────────────────────────────────
// Permission-gated endpoint that returns a DELIVERED order (financialStatus WO
// or WD) to the warehouse (RETURN/Re) — or to any other target status supplied
// by the caller. This is the counterpart to the driver-payout/clearing flow:
// it lets staff roll a delivered order back into the returns pipeline.
//
// Required permission: ACTION_ORDER_RETURN (ADMIN bypasses via hasPermission).
//
// Request body:
//   {
//     orderIds: string[],        // required
//     location?: string,         // target location, default "RETURN"
//     financialStatus?: string,  // target financialStatus, default "Re"
//   }

/**
 * Recalculates a PENDING driver payout after an order is unlinked (or deletes
 * the payout entirely when it has no remaining orders). Mirrors the cleanup in
 * PATCH /api/orders so a returned order never leaves a stale payout behind.
 */
async function recalcDriverPayout(payoutId: string) {
  const payout = await prisma.driverPayout.findUnique({
    where: { id: payoutId },
    select: { id: true, status: true, driverId: true },
  });
  if (!payout || payout.status !== "PENDING") return;

  const remainingOrders = await prisma.order.findMany({
    where: { driverPayoutId: payout.id },
    select: {
      id: true,
      amountUsd: true,
      amountLbp: true,
      zoneId: true,
      merchantId: true,
    },
  });

  // No orders left — delete the empty payout.
  if (remainingOrders.length === 0) {
    await prisma.driverPayout.delete({ where: { id: payout.id } });
    return;
  }

  const newTotalUsd = remainingOrders.reduce(
    (sum, o) => sum + (o.amountUsd ?? 0),
    0,
  );
  const newTotalLbp = remainingOrders.reduce(
    (sum, o) => sum + (o.amountLbp ?? 0),
    0,
  );

  // Recalculate commission using 3-tier logic (zone rates + seller exceptions).
  const zoneRates = await prisma.driverZoneRate.findMany({
    where: { driverId: payout.driverId || undefined },
  });
  const zoneRateMap = new Map(zoneRates.map((zr) => [zr.zoneId, zr.rate]));

  const driverProfile = await prisma.driverProfile.findUnique({
    where: { id: payout.driverId || undefined },
    select: { userId: true },
  });
  const sellerRates = driverProfile?.userId
    ? await prisma.driverSellerRate.findMany({
        where: { driverId: payout.driverId || undefined },
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

  await prisma.driverPayout.update({
    where: { id: payout.id },
    data: {
      totalUsd: newTotalUsd,
      totalLbp: newTotalLbp,
      commissionUsd: newCommissionUsd,
      netUsd: newNetUsd,
      totalCollected: newTotalUsd,
    },
  });
}

export async function PATCH(request: Request) {
  const guard = await requireServerPermission(request, "ACTION_ORDER_RETURN");
  if (guard instanceof Response) return guard;
  const { user } = guard;

  try {
    const body = await request.json();
    const { orderIds, location, financialStatus } = body as {
      orderIds?: string[];
      location?: string;
      financialStatus?: string;
    };

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "orderIds array is required" },
        { status: 400 },
      );
    }

    // Target status — defaults to a warehouse return (RETURN / Re). The caller
    // may override with "any other status" (e.g. WAREHOUSE/UD, ASSIGNED/UD).
    const targetLocation = location || "RETURN";
    const targetFinancialStatus = financialStatus || "Re";

    // ── Fetch the existing orders to validate they are delivered WO/WD ──
    const existingOrders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        orderId: true,
        location: true,
        financialStatus: true,
        driverId: true,
        driverPayoutId: true,
        merchantPayoutId: true,
      },
    });

    const foundIds = new Set(existingOrders.map((o) => o.id));
    const missingIds = orderIds.filter((id) => !foundIds.has(id));

    // Source validation: only DELIVERED orders in WO or WD are eligible here.
    const ineligible = existingOrders.filter(
      (o) =>
        o.location !== "DELIVERED" || !["WO", "WD"].includes(o.financialStatus),
    );
    if (ineligible.length > 0) {
      return NextResponse.json(
        {
          error: `${ineligible.length} order(s) are not delivered WO/WD and cannot be returned. Found: ${ineligible
            .map((o) => `${o.orderId} (${o.location}/${o.financialStatus})`)
            .join(", ")}`,
        },
        { status: 400 },
      );
    }

    // ── Perform per-order updates + history logging ──────────────────────
    const results = await Promise.all(
      existingOrders.map(async (o) => {
        // Leaving the delivered state: unlink from any pending driver payout
        // and clear delivery/collection fields so the order can be re-queued.
        const leavingDelivered = targetLocation !== "DELIVERED";
        const wasInPayout = !!o.driverPayoutId;

        await prisma.order.update({
          where: { id: o.id },
          data: {
            location: targetLocation,
            financialStatus: targetFinancialStatus,
            ...(leavingDelivered && {
              driverPayoutId: null,
              deliveredAt: null,
              collectedUsd: 0,
              collectedLbp: 0,
            }),
            // Order returned to the bare warehouse => unassign the driver.
            ...(targetLocation === "WAREHOUSE" && { driverId: null }),
          },
        });

        // Recalculate (or delete) the pending payout the order was removed from.
        if (wasInPayout && leavingDelivered) {
          await recalcDriverPayout(o.driverPayoutId!);
        }

        const notes: string[] = [];
        if (wasInPayout)
          notes.push("unlinked from driver payout (recalculated)");
        if (o.merchantPayoutId)
          notes.push("NOTE: still linked to merchant payout — verify finances");

        await prisma.orderHistory.create({
          data: {
            orderId: o.id,
            action: `Returned delivered order (${o.financialStatus}) to ${targetLocation}/${targetFinancialStatus}${
              notes.length > 0 ? ` — ${notes.join(", ")}` : ""
            }`,
            location: targetLocation,
            driverId: o.driverId,
            userId: user.id,
          },
        });

        return { id: o.id, orderId: o.orderId };
      }),
    );

    return NextResponse.json({
      success: true,
      count: results.length,
      targetLocation,
      targetFinancialStatus,
      missing: missingIds,
    });
  } catch (error: any) {
    console.error("[PATCH /api/admin/orders/return] Error:", error.message);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    );
  }
}
