import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  loadDriverRateTable,
  recalcPayoutTotals,
  isPayoutMutable,
  MissingDriverRateError,
} from "@/lib/commission";
import {
  ConcurrencyConflictError,
  withConcurrencyRetries,
} from "@/lib/concurrency";
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

    // ── Prove the payout is mutable BEFORE touching anything (fix B) ────────
    // Rollback is only legal while the payout is still in its mutable state
    // (PENDING). Once a payout is PENDING_APPROVAL / SETTLED / CLEARED its
    // totals are historical money — settlement figures (amountPaid,
    // remaining, debt carryover) and/or treasury postings are already derived
    // from them. Rolling an order out of such a payout here would silently
    // diverge the ledger, so it is rejected. Use the sanctioned reversal
    // workflows (void while PENDING, admin orders-return, treasury reject).
    const payout = await prisma.driverPayout.findUnique({
      where: { id: driverPayoutId },
      select: { id: true, status: true, driverId: true },
    });
    if (!payout) {
      return NextResponse.json(
        {
          error: "Order references a driver payout that no longer exists",
        },
        { status: 409 },
      );
    }
    if (!isPayoutMutable(payout.status)) {
      return NextResponse.json(
        {
          error: `Cannot roll an order out of a driver payout in "${payout.status}" (a historical financial record). Use the payout void / returns workflow instead.`,
        },
        { status: 409 },
      );
    }

    // Execute the rollback as ONE atomic unit: state re-validation + detach
    // + recomputation/deletion. Retried on retryable concurrency errors;
    // each attempt re-proves the payout is still PENDING inside its tx.
    const result = await withConcurrencyRetries(() =>
      prisma.$transaction(async (tx) => {
        // Re-read inside the transaction: the pre-read above is only an
        // optimization, this is the authoritative mutability check.
        const payoutInTx = await tx.driverPayout.findUnique({
          where: { id: driverPayoutId },
          select: { id: true, status: true, driverId: true },
        });
        if (!payoutInTx) {
          throw new ConcurrencyConflictError(
            "Driver payout was deleted concurrently; retrying",
          );
        }
        if (!isPayoutMutable(payoutInTx.status)) {
          throw new ConcurrencyConflictError(
            `Driver payout is no longer mutable (status: ${payoutInTx.status}); concurrent settle/clear detected`,
          );
        }

        // 1. Detach the order from the payout and reset to ASSIGNED.
        // CAS: the WHERE clause also requires the link to still point at
        // THIS payout, so a concurrent detach loses the race instead of
        // corrupting state. UD (Unpaid/Undelivered) because the order is
        // back with the driver, not delivered — WD is only for delivered
        // orders pending payout.
        const detached = await tx.order.updateMany({
          where: { id: orderId, driverPayoutId },
          data: {
            driverPayoutId: null,
            location: "ASSIGNED",
            financialStatus: "UD",
          },
        });
        if (detached.count === 0) {
          throw new ConcurrencyConflictError(
            "Order is no longer linked to this payout; concurrent modification detected",
          );
        }

        // 2. Fetch remaining orders still linked to this payout (only the
        // financial fields the recalculation needs)
        const remainingOrders = await tx.order.findMany({
          where: { driverPayoutId },
          // Full order row (recalc reads the financial scalars) plus
          // human-readable labels for the fail-closed missing-rate error.
          include: {
            zone: { select: { name: true } },
            merchant: { select: { merchantName: true } },
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
        // (cash-seller wins) → zone rate, NO default; net = gross − commission.
        // Throws MissingDriverRateError if ANY remaining order has no
        // configured rate — the whole tx rolls back and nothing is saved.
        const rateTable = await loadDriverRateTable(tx, payoutInTx.driverId);
        const recalced = recalcPayoutTotals(rateTable, remainingOrders);

        // CAS on status so a concurrent settle/clear can't be clobbered by a
        // totals write.
        const updated = await tx.driverPayout.updateMany({
          where: { id: driverPayoutId, status: "PENDING" },
          data: {
            totalUsd: recalced.totalUsd,
            totalLbp: recalced.totalLbp,
            commissionUsd: recalced.commissionUsd,
            netUsd: recalced.netUsd,
            totalCollected: recalced.totalCollected,
          },
        });
        if (updated.count === 0) {
          throw new ConcurrencyConflictError(
            "Driver payout state changed concurrently; retrying",
          );
        }

        return {
          deleted: false,
          payoutId: driverPayoutId,
          remainingCount: remainingOrders.length,
        };
      })
    );

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    // A missing driver rate is a configuration error, not a 500: the
    // transaction was rolled back, nothing was saved. Surface the actionable
    // message (a $0 rate is a valid explicit override) so the employee can
    // configure the rate and retry.
    if (error instanceof MissingDriverRateError) {
      return NextResponse.json(
        { error: error.message, missingRateOrders: error.missingOrders },
        { status: 400 },
      );
    }
    // A concurrency conflict that exhausted its retries means the payout
    // left the mutable state (or the order was detached) while we ran —
    // surface it as a conflict, not a 500.
    if (error instanceof ConcurrencyConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("POST /api/drivers/payouts/items/[orderId] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
