import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  loadDriverRateTable,
  recalcPayoutTotals,
  isPayoutMutable,
  MissingDriverRateError,
} from "@/lib/commission";
import { requireServerPermission } from "@/lib/server-permissions";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

export async function PATCH(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_ORDERS");
  if (auth instanceof Response) return auth;
  try {
    const { orderIds, targetZoneId } = await request.json();

    if (!Array.isArray(orderIds) || orderIds.length === 0 || !targetZoneId) {
      return NextResponse.json(
        { error: "Invalid order IDs or target zone." },
        { status: 400 },
      );
    }

    const ids = orderIds.map((id: string) => String(id));

    // ── Payout integrity (fix C) ────────────────────────────────────────────
    // zoneId feeds the commission calculation. Re-zoning an order that is on
    // a payout changes its stored commission, so:
    //  • HISTORICAL payouts (PENDING_APPROVAL / SETTLED / CLEARED / unknown):
    //    rejected — their totals are ledger money already settled/posted.
    //    Use the sanctioned reversal workflows instead.
    //  • PENDING payouts: allowed, but their totals are recomputed through
    //    the authoritative commission module in the SAME transaction as the
    //    zone write, so stored totals can never diverge from the orders. If a
    //    remaining order has no configured rate (a configuration error — no
    //    $0 default), the WHOLE operation is rolled back with an actionable
    //    MissingDriverRateError (400).
    const affected = await prisma.order.findMany({
      where: { id: { in: ids }, driverPayoutId: { not: null } },
      select: { id: true, driverPayoutId: true },
    });
    if (affected.length > 0) {
      const payoutIds = [...new Set(affected.map((o) => o.driverPayoutId!))];
      const payouts = await prisma.driverPayout.findMany({
        where: { id: { in: payoutIds } },
        select: { id: true, status: true, driverId: true },
      });
      const historical = payouts.filter((p) => !isPayoutMutable(p.status));
      if (historical.length > 0) {
        return NextResponse.json(
          {
            error: `Some orders belong to driver payouts in historical state (${historical.map((p) => p.status).join(", ")}). Re-zone via the payout/returns workflow instead.`,
          },
          { status: 409 },
        );
      }

      return await prisma.$transaction(async (tx) => {
        const res = await tx.order.updateMany({
          where: { id: { in: ids } },
          data: { zoneId: String(targetZoneId) },
        });

        // Recompute every affected PENDING payout from its (now updated)
        // orders through the authoritative commission module.
        for (const payout of payouts) {
          const remainingOrders = await tx.order.findMany({
            where: { driverPayoutId: payout.id },
            // Full order row (recalc reads the financial scalars) plus
            // human-readable labels for the fail-closed missing-rate error
            // (re-zoning can expose a missing rate in the TARGET zone).
            include: {
              zone: { select: { name: true } },
              merchant: { select: { merchantName: true } },
            },
          });
          if (remainingOrders.length === 0) {
            // The zone write can't remove orders, so this is unreachable —
            // guard anyway and keep the payout row consistent.
            await tx.driverPayout.delete({ where: { id: payout.id } });
            continue;
          }
          const rateTable = await loadDriverRateTable(tx, payout.driverId);
          const recalced = recalcPayoutTotals(rateTable, remainingOrders);
          // CAS on status so a concurrent settle/clear can't be clobbered.
          const upd = await tx.driverPayout.updateMany({
            where: { id: payout.id, status: "PENDING" },
            data: {
              totalUsd: recalced.totalUsd,
              totalLbp: recalced.totalLbp,
              commissionUsd: recalced.commissionUsd,
              netUsd: recalced.netUsd,
              totalCollected: recalced.totalCollected,
            },
          });
          if (upd.count === 0) {
            throw new Error(
              "A driver payout changed state concurrently; the transaction was rolled back. Refresh and retry.",
            );
          }
        }

        return NextResponse.json(
          { success: true, count: res.count },
          { status: 200 },
        );
      });
    }

    const updated = await prisma.order.updateMany({
      where: { id: { in: ids } },
      data: { zoneId: String(targetZoneId) },
    });

    return NextResponse.json(
      { success: true, count: updated.count },
      { status: 200 },
    );
  } catch (error: any) {
    // A missing driver rate is a configuration error, not a 500: the
    // transaction was rolled back, nothing was re-zoned or recalculated.
    if (error instanceof MissingDriverRateError) {
      return NextResponse.json(
        { error: error.message, missingRateOrders: error.missingOrders },
        { status: 400 },
      );
    }
    console.error("[PATCH /api/admin/orders/bulk-zone] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
