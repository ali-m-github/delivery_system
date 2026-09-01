import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";
import { orderIdForFinancialStatus } from "@/lib/order-id";
import {
  loadDriverRateTable,
  recalcPayoutTotals,
  isPayoutMutable,
  findMissingRateOrders,
  MissingDriverRateError,
  MissingRateOrder,
} from "@/lib/commission";
import {
  ConcurrencyConflictError,
  withConcurrencyRetries,
} from "@/lib/concurrency";

// ─── PATCH /api/admin/orders/return ──────────────────────────────────────────
// Permission-gated endpoint that returns a DELIVERED order (financialStatus WO
// or WD) to the warehouse (RETURN/Re) — or to any other target status supplied
// by the caller. This is the counterpart to the driver-payout/clearing flow:
// it lets staff roll a delivered order back into the returns pipeline.
//
// Required permission: ACTION_ORDER_RETURN (ADMIN bypasses via hasPermission).
//
// Payout integrity (fail-closed):
//  • Orders linked to HISTORICAL payouts (PENDING_APPROVAL / SETTLED / CLEARED
//    / unknown) can never be returned through this endpoint — their payout
//    totals are ledger money. The WHOLE batch is rejected (409).
//  • Orders linked to PENDING payouts are unlinked atomically, and each
//    affected payout is recalculated through the authoritative commission
//    module in the SAME transaction. If a remaining order has no configured
//    rate (neither a seller exception nor a zone rate — a configuration
//    error; there is NO $0 default), the WHOLE operation is rolled back and
//    the employee gets an actionable MissingDriverRateError (400): nothing is
//    partially returned and no payout total changes.
//
// Request body:
//   {
//     orderIds: string[],        // required
//     location?: string,         // target location, default "RETURN"
//     financialStatus?: string,  // target financialStatus, default "Re"
//   }

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
    const leavingDelivered = targetLocation !== "DELIVERED";

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

    // ── Payout integrity (fail-closed, before any write) ───────────────────
    // Only a PENDING → non-DELIVERED transition touches payout money.
    if (leavingDelivered) {
      const linkedOrders = existingOrders.filter((o) => o.driverPayoutId);
      if (linkedOrders.length > 0) {
        const payoutIds = [
          ...new Set(linkedOrders.map((o) => o.driverPayoutId!)),
        ];
        const payouts = await prisma.driverPayout.findMany({
          where: { id: { in: payoutIds } },
          select: { id: true, status: true, driverId: true },
        });

        // (1) HISTORICAL payouts can never lose orders through this endpoint —
        // their totals are ledger money. Reject the WHOLE batch.
        const historical = payouts.filter((p) => !isPayoutMutable(p.status));
        if (historical.length > 0) {
          const blocked = linkedOrders
            .filter((o) => historical.some((p) => p.id === o.driverPayoutId))
            .map((o) => o.orderId);
          return NextResponse.json(
            {
              error: `${blocked.length} order(s) belong to driver payouts in historical state (${[
                ...new Set(historical.map((p) => p.status)),
              ].join(", ")}): ${blocked.join(
                ", ",
              )}. Return them via the payout void / returns workflow instead.`,
            },
            { status: 409 },
          );
        }

        // (2) FAST pre-validation of the POST-removal rate configuration for
        // every affected PENDING payout. Removing orders can leave a payout
        // whose remaining orders have NO configured rate (neither seller
        // exception nor zone rate) — a configuration error. Fail fast with an
        // actionable 400 aggregating ALL missing orders, before writing
        // anything. The in-transaction recalculation below re-proves this
        // atomically (the pre-check can never let an invalid state through).
        const missingByPayout = new Map<string, MissingRateOrder[]>();
        await Promise.all(
          payouts.map(async (payout) => {
            const removedHere = linkedOrders
              .filter((o) => o.driverPayoutId === payout.id)
              .map((o) => o.id);
            const remaining = await prisma.order.findMany({
              where: {
                driverPayoutId: payout.id,
                id: { notIn: removedHere },
              },
              // Full row (rate check reads zoneId/merchantId) plus
              // human-readable labels for the missing-rate error.
              include: {
                zone: { select: { name: true } },
                merchant: { select: { merchantName: true } },
              },
            });
            if (remaining.length === 0) return;
            const rateTable = await loadDriverRateTable(
              prisma,
              payout.driverId,
            );
            const missing = findMissingRateOrders(rateTable, remaining);
            if (missing.length > 0) missingByPayout.set(payout.id, missing);
          }),
        );
        if (missingByPayout.size > 0) {
          const allMissing = [...missingByPayout.values()].flat();
          const message = payouts
            .filter((p) => missingByPayout.has(p.id))
            .map(
              (p) =>
                new MissingDriverRateError(
                  p.driverId,
                  missingByPayout.get(p.id)!,
                ).message,
            )
            .join(" ");
          return NextResponse.json(
            { error: message, missingRateOrders: allMissing },
            { status: 400 },
          );
        }
      }
    }

    // ── Atomic return + payout reconciliation ──────────────────────────────
    // Every order update, payout unlink, payout recalculation/deletion and
    // history entry is ONE transaction, so a failure can never leave an order
    // returned while its payout still carries stale totals (or vice versa).
    // CAS: each order update requires the pre-read state to still hold, and
    // each payout write requires status PENDING — a concurrent settle/clear
    // loses the race instead of corrupting state.
    const results = await withConcurrencyRetries(() =>
      prisma.$transaction(async (tx) => {
        const written: { id: string; orderId: string }[] = [];

        for (const o of existingOrders) {
          // Per-order CAS: only proceed if the row still matches the state we
          // validated (same location/financialStatus/payout link).
          const updated = await tx.order.updateMany({
            where: {
              id: o.id,
              location: o.location,
              financialStatus: o.financialStatus,
              driverPayoutId: o.driverPayoutId,
            },
            data: {
              orderId: orderIdForFinancialStatus(
                o.orderId,
                targetFinancialStatus,
              ),
              location: targetLocation,
              financialStatus: targetFinancialStatus,
              // Leaving the delivered state: unlink from the pending driver
              // payout and clear delivery/collection fields so the order can
              // be re-queued.
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
          if (updated.count === 0) {
            throw new ConcurrencyConflictError(
              `Order ${o.orderId} changed concurrently; retrying`,
            );
          }

          written.push({ id: o.id, orderId: o.orderId });

          const notes: string[] = [];
          if (o.driverPayoutId)
            notes.push("unlinked from driver payout (recalculated)");
          if (o.merchantPayoutId)
            notes.push("NOTE: still linked to merchant payout — verify finances");

          await tx.orderHistory.create({
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
        }

        // Recalculate (or delete) each affected PENDING payout from its
        // remaining orders through the authoritative commission module — the
        // exact same figures payout creation wrote (gross = collected > 0 else
        // amount; commission = seller exception (cash wins) → zone rate, NO
        // default; net = gross − fee). recalcPayoutTotals throws
        // MissingDriverRateError if any remaining order has no configured
        // rate, which rolls back the ENTIRE operation (nothing was returned).
        if (leavingDelivered) {
          const payoutIds = [
            ...new Set(
              existingOrders
                .filter((o) => o.driverPayoutId)
                .map((o) => o.driverPayoutId!),
            ),
          ];
          for (const payoutId of payoutIds) {
            const payout = await tx.driverPayout.findUnique({
              where: { id: payoutId },
              select: { id: true, status: true, driverId: true },
            });
            if (!payout) {
              // Vanished concurrently (e.g. deleted by an empty-payout
              // cleanup) — fail closed and let the retry re-evaluate.
              throw new ConcurrencyConflictError(
                "A driver payout was deleted concurrently; retrying",
              );
            }
            if (!isPayoutMutable(payout.status)) {
              throw new ConcurrencyConflictError(
                `Driver payout ${payoutId} is no longer mutable (status: ${payout.status}); concurrent settle/clear detected`,
              );
            }

            const remainingOrders = await tx.order.findMany({
              where: { driverPayoutId: payout.id },
              // Full order row (recalc reads the financial scalars) plus
              // human-readable labels for the fail-closed missing-rate error.
              include: {
                zone: { select: { name: true } },
                merchant: { select: { merchantName: true } },
              },
            });

            if (remainingOrders.length === 0) {
              // No orders left — delete the empty payout (CAS on PENDING so a
              // concurrent settle/clear can't be clobbered).
              const del = await tx.driverPayout.deleteMany({
                where: { id: payout.id, status: "PENDING" },
              });
              if (del.count === 0) {
                throw new ConcurrencyConflictError(
                  "Driver payout state changed concurrently; retrying",
                );
              }
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
              throw new ConcurrencyConflictError(
                "Driver payout state changed concurrently; retrying",
              );
            }
          }
        }

        return written;
      })
    );

    return NextResponse.json({
      success: true,
      count: results.length,
      targetLocation,
      targetFinancialStatus,
      missing: missingIds,
    });
  } catch (error: any) {
    // A missing driver rate is a configuration error, not a 500: the
    // transaction was rolled back, nothing was returned or recalculated.
    // Surface the actionable message (a $0 rate is a valid explicit override)
    // so the employee can configure the rate and retry.
    if (error instanceof MissingDriverRateError) {
      return NextResponse.json(
        { error: error.message, missingRateOrders: error.missingOrders },
        { status: 400 },
      );
    }
    // A concurrency conflict that exhausted its retries means an order or its
    // payout changed state while we ran — surface it as a conflict, not a 500.
    if (error instanceof ConcurrencyConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[PATCH /api/admin/orders/return] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
