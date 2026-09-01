import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  loadDriverRateTable,
  recalcPayoutTotals,
  PAID_OUT_ELIGIBLE_STATUSES,
  MissingDriverRateError,
} from "@/lib/commission";
import { getSessionUserId } from "@/helpers/auth";
import { withConcurrencyRetries } from "@/lib/concurrency";
import { requireServerPermission } from "@/lib/server-permissions";

/**
 * Raised when one or more requested order IDs are missing or ineligible for a
 * driver payout batch. Carries the rejected IDs so the client receives a
 * precise, actionable error instead of a generic 500.
 */
class InvalidPayoutOrdersError extends Error {
  readonly rejectedIds: string[];

  constructor(rejectedIds: string[]) {
    super(
      `The following order ID(s) are not eligible for a payout (must belong to the driver, be DELIVERED, and have financial status WD or UD): ${rejectedIds.join(", ")}`,
    );
    this.name = "InvalidPayoutOrdersError";
    this.rejectedIds = rejectedIds;
  }
}

// POST /api/driver-payouts — Clear WD orders to WO (With Office)
export async function POST(request: Request) {
  const auth = await requireServerPermission(request, "DRIVERS_PAYOUT");
  if (auth instanceof Response) return auth;
  try {
    const body = await request.json();
    // NOTE: only IDs are accepted from the client. The client may also send
    // totalCollectedUsd/totalCollectedLbp/commissionUsd/netUsd for display
    // convenience, but they are deliberately NOT destructured here — all
    // financial figures are re-derived from the database inside the
    // transaction below. Client-computed money is never the source of truth.
    const { driverId: identifier, orderIds } = body;

    if (
      !identifier ||
      !orderIds ||
      !Array.isArray(orderIds) ||
      orderIds.length === 0
    ) {
      return NextResponse.json(
        { error: "driverId and orderIds (non-empty array) are required" },
        { status: 400 },
      );
    }

    // Resolve human-readable driverId (e.g., "d001") to CUID
    const profile = await prisma.driverProfile.findFirst({
      where: {
        driverId: {
          equals: identifier,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });

    if (!profile) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }

    const driverId = profile.id;

    // Attribute this payout to the authenticated user who created it
    const createdById = await getSessionUserId(request);

    // Deduplicate the requested IDs so a hostile client cannot double-count an
    // order by repeating its id in the array.
    if (orderIds.some((id) => typeof id !== "string")) {
      return NextResponse.json(
        { error: "orderIds must be an array of strings" },
        { status: 400 },
      );
    }
    const requestedIds: string[] = Array.from(new Set(orderIds));

    // The per-driver @@unique([driverId, sequentialIndex]) constraint makes a
    // max+1 race impossible: if two concurrent clear-batches both read the
    // same max, the loser's INSERT gets P2002 and this whole attempt is
    // retried with a fresh max (see lib/concurrency.ts).
    const result = await withConcurrencyRetries(() =>
      prisma.$transaction(async (tx) => {
      // All financial validation and totals computation happen INSIDE the
      // transaction, on rows locked for the duration of the batch. This is the
      // authoritative path: client-supplied money values are never read.
      // Eligibility (concern B, unified in lib/commission.ts): DELIVERED and
      // financial status WD or UD. UD is the state the void flow restores
      // returned-from-payout orders to, so it must be re-settleable here.
      // Eligible = this driver's, DELIVERED, WD/UD, and NOT already claimed
      // by any other payout. The driverPayoutId check keeps the totals
      // computed below consistent with the links written by the updateMany.
      const orders = await tx.order.findMany({
        where: {
          id: { in: requestedIds },
          driverId,
          location: "DELIVERED",
          financialStatus: { in: PAID_OUT_ELIGIBLE_STATUSES },
          driverPayoutId: null,
        },
        // Human-readable labels for the fail-closed missing-rate error
        // (zone/seller names) when recalcPayoutTotals throws.
        include: {
          zone: { select: { name: true } },
          merchant: { select: { merchantName: true } },
        },
        orderBy: { id: "asc" },
      });

      // Reject the whole batch if ANY requested ID is missing or ineligible
      // (wrong driver, not DELIVERED, or no longer WD/UD). Never create a
      // partial financial record from a partial match.
      if (orders.length !== requestedIds.length) {
        const validIds = new Set(orders.map((o) => o.id));
        const rejectedIds = requestedIds.filter((id) => !validIds.has(id));
        throw new InvalidPayoutOrdersError(rejectedIds);
      }

      // ── Server-derived financials (client values are NEVER trusted) ─────
      // Gross (concern C): positive collected* wins, else order amount.
      // Commission (concern A): seller exception (cash wins) → zone rate, NO
      // default. Throws MissingDriverRateError if ANY order has no configured
      // rate — the whole tx rolls back and nothing is created.
      //
      // The full commission rate table (3 bulk queries) is loaded INSIDE the
      // serializable transaction so the rates recalcPayoutTotals uses are
      // consistent with the order rows it reads — a concurrent rate change
      // cannot slip between the two reads (a write-skew anomaly SSI aborts
      // with P2034, retried via withConcurrencyRetries).
      const driverProfile = await tx.driverProfile.findUnique({
        where: { id: driverId },
        select: { userId: true },
      });
      const rateTable = await loadDriverRateTable(
        tx,
        driverId,
        driverProfile?.userId,
      );
      const totals = recalcPayoutTotals(rateTable, orders);
      const { totalUsd, totalLbp, commissionUsd, netUsd } = totals;

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
          totalUsd,
          totalLbp,
          commissionUsd,
          netUsd,
          totalCollected: totalUsd,
          status: "CLEARED",
          clearedAt: new Date(),
          createdById: createdById ?? undefined,
        },
      });

      // Update orders: change financialStatus to WO and link driverPayoutId.
      // The WHERE clause re-checks the lifecycle state so a concurrent status
      // change cannot be silently swept into this batch, and re-checks
      // driverPayoutId IS NULL so an order already claimed by another payout
      // can never be double-booked (mirrors /api/drivers/[id]/payouts).
      await tx.order.updateMany({
        where: {
          id: { in: requestedIds },
          driverId,
          location: "DELIVERED",
          financialStatus: { in: PAID_OUT_ELIGIBLE_STATUSES },
          driverPayoutId: null,
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
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidPayoutOrdersError) {
      // The transaction was rolled back; nothing was created.
      return NextResponse.json(
        { error: error.message, rejectedOrderIds: error.rejectedIds },
        { status: 400 },
      );
    }
    if (error instanceof MissingDriverRateError) {
      // The transaction was rolled back; nothing was created. Surface the
      // actionable missing-rate message so the employee can configure the
      // driver's rate (a $0 rate is a valid override) and retry.
      return NextResponse.json(
        { error: error.message, missingRateOrders: error.missingOrders },
        { status: 400 },
      );
    }
    console.error("POST /api/driver-payouts Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
