import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  loadDriverRateTable,
  recalcPayoutTotals,
  enrichPayoutOrdersWithCommission,
  PAID_OUT_ELIGIBLE_STATUSES,
  MissingDriverRateError,
} from "@/lib/commission";
import {
  requireAuthenticatedSession,
  requireServerPermission,
} from "@/lib/server-permissions";
import {
  withConcurrencyRetries,
  ConcurrencyConflictError,
} from "@/lib/concurrency";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

/**
 * Raised when one or more requested order IDs are missing or ineligible for a
 * driver payout batch. Carries the rejected IDs so the client receives a
 * precise, actionable error instead of a generic 500. The transaction is
 * rolled back: NOTHING is created for a mixed valid/invalid request.
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

// GET /api/drivers/[id]/payouts — Fetch pending DriverPayouts for a driver.
//
// Authorization (identity is resolved from the session, never from the URL):
//   - DRIVER: may only read their OWN profile — the session user is resolved
//     to their actual DriverProfile and compared against the target profile.
//   - ADMIN / staff: require the existing driver-view permission DRIVERS_VIEW
//     (ADMIN bypasses via hasPermission — same model as /api/drivers/payouts
//     and /api/admin/drivers/settlements).
//   - MERCHANT and any other role without DRIVERS_VIEW: 403. A valid session
//     alone must never grant access to driver payout history.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthenticatedSession(request);
  if (auth instanceof Response) return auth;
  const { user } = auth;
  try {
    const resolvedParams = await params;
    const identifier = resolvedParams.id;

    // Resolve human-readable driverId (e.g., "d001") to CUID
    const profile = await prisma.driverProfile.findFirst({
      where: {
        driverId: {
          equals: identifier,
          mode: "insensitive",
        },
      },
      select: { id: true, userId: true },
    });

    if (!profile) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }

    // Driver self-scoping: a DRIVER may only ever see their own payout data.
    // The requested identifier is NEVER trusted as proof of identity.
    if (user.role === "DRIVER") {
      if (profile.userId !== user.id) {
        return NextResponse.json(
          { error: "Drivers may only view their own payouts" },
          { status: 403 },
        );
      }
    } else {
      // Any other role (staff/admin) needs the driver-view permission.
      const staffAuth = await requireServerPermission(
        request,
        "DRIVERS_VIEW",
      );
      if (staffAuth instanceof Response) return staffAuth;
    }

    const driverId = profile.id;

    const payouts = await prisma.driverPayout.findMany({
      where: {
        driverId,
        status: "PENDING",
      },
      include: {
        createdBy: {
          select: { id: true, username: true, email: true },
        },
        orders: {
          include: {
            merchant: {
              select: { merchantName: true },
            },
            zone: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Enrich each order with its per-order driver commission (authoritative
    // precedence from lib/commission.ts: seller exception (cash wins) → zone
    // rate → missing). An explicitly configured $0 is a valid figure; a
    // missing rate yields driverCommissionUsd: null ("Rate not configured").
    // One rate-table load for the driver.
    const rateTable = await loadDriverRateTable(prisma, driverId);

    const enrichedPayouts = payouts.map((payout) => ({
      ...payout,
      orders: enrichPayoutOrdersWithCommission(rateTable, payout.orders),
    }));

    return NextResponse.json(enrichedPayouts, { status: 200 });
  } catch (error) {
    console.error("GET /api/drivers/[id]/payouts Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// POST /api/drivers/[id]/payouts — Create a new PENDING payout batch.
//
// Authorization:
//   - ADMIN / staff: require DRIVERS_PAYOUT (payout-creation permission; ADMIN
//     bypasses via hasPermission). MERCHANT / USER / EMPLOYEE without the
//     permission are rejected.
//   - DRIVER: self-service only — the target DriverProfile must belong to the
//     authenticated user (resolved from the session, never the URL).
//
// Financial integrity:
//   - Only order IDs are accepted. Client-supplied totals or commissions are
//     IGNORED — all figures are re-derived from the database.
//   - The definitive eligibility check (owns the driver, DELIVERED, WD/UD,
//     unclaimed) runs INSIDE a serializable transaction; if ANY requested ID
//     fails, the ENTIRE batch is rejected and nothing is created.
//   - Order claiming re-checks `driverPayoutId: null` on a conditional
//     updateMany so a concurrent payout cannot double-claim an order.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthenticatedSession(request);
  if (auth instanceof Response) return auth;
  const { user } = auth;
  try {
    const resolvedParams = await params;
    const identifier = resolvedParams.id;

    // Resolve human-readable driverId (e.g., "d001") to CUID
    const profile = await prisma.driverProfile.findFirst({
      where: {
        driverId: {
          equals: identifier,
          mode: "insensitive",
        },
      },
      select: { id: true, userId: true, driverId: true },
    });

    if (!profile) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }

    // Self-service scoping: a DRIVER may only create payout batches for their
    // own profile. The comparison is against the profile resolved from the
    // session user, never against the requested identifier.
    if (user.role === "DRIVER") {
      if (profile.userId !== user.id) {
        return NextResponse.json(
          { error: "Drivers may only create payouts for their own account" },
          { status: 403 },
        );
      }
    } else {
      // Staff/admin payout management is controlled by DRIVERS_PAYOUT.
      const staffAuth = await requireServerPermission(
        request,
        "DRIVERS_PAYOUT",
      );
      if (staffAuth instanceof Response) return staffAuth;
    }

    const driverId = profile.id;
    const driverCode = profile.driverId;

    // Attribute this payout to the authenticated user who created it
    const createdById = user.id;

    const body = (await request
      .json()
      .catch(() => null)) as Record<string, unknown> | null;
    const orderIds = body?.orderIds;

    // Reject missing, empty, or non-string IDs up front.
    if (
      !Array.isArray(orderIds) ||
      orderIds.length === 0 ||
      orderIds.some((id) => typeof id !== "string")
    ) {
      return NextResponse.json(
        { error: "orderIds must be a non-empty array of strings" },
        { status: 400 },
      );
    }

    // Deduplicate the requested IDs so a hostile client cannot double-count an
    // order by repeating its id in the array.
    const requestedIds: string[] = Array.from(new Set(orderIds as string[]));

    // Load the driver's commission rate table once (3 bulk queries), outside
    // the transaction. Precedence: seller exception (cash-seller wins) → zone
    // rate → MISSING (a configuration error — there is no $0 default; see
    // lib/commission.ts). recalcPayoutTotals below throws
    // MissingDriverRateError inside the transaction when any order has no
    // configured rate, which rolls back the ENTIRE batch (nothing is created).
    const rateTable = await loadDriverRateTable(
      prisma,
      driverId,
      profile.userId,
    );

    // Carried debt, the sequential index, the payout reference and the
    // eligibility/claim check all happen INSIDE one serializable transaction:
    // reading/claiming outside let concurrent creations reuse the same index,
    // double-inject debt, or double-book an order into two batches. The DB
    // constraints (@@unique([driverId, sequentialIndex]) and @unique
    // payoutReference) make collisions impossible; a P2002/P2034 from a lost
    // race aborts the attempt and the whole unit of work is retried with a
    // fresh read (see lib/concurrency.ts).
    const payout = await withConcurrencyRetries(() =>
      prisma.$transaction(
        async (tx) => {
          // 1. DEFINITIVE eligibility check, inside the transaction, on the
          //    target driver's unclaimed eligible orders only:
          //    this driver's, DELIVERED, financial status WD/UD, and NOT
          //    already claimed by any payout (driverPayoutId: null).
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

          // Reject the WHOLE batch if ANY requested ID is missing, belongs to
          // another driver, is already claimed, or is no longer eligible.
          // Never create a partial financial record from a partial match.
          if (orders.length !== requestedIds.length) {
            const validIds = new Set(orders.map((o) => o.id));
            const rejectedIds = requestedIds.filter(
              (id) => !validIds.has(id),
            );
            throw new InvalidPayoutOrdersError(rejectedIds);
          }

          // 2. Server-side financial recalculation — the backend MUST NOT
          //    trust the frontend's math (gross: collected > 0 else amount;
          //    commission: seller exception (cash wins) → zone rate, NO
          //    default; net = gross − fee). Throws MissingDriverRateError if
          //    ANY order has no configured rate — the whole tx rolls back.
          const totals = recalcPayoutTotals(rateTable, orders);
          const safeTotalUsd = parseFloat(String(totals.totalUsd)) || 0;
          const safeTotalLbp = parseFloat(String(totals.totalLbp)) || 0;
          const safeCommissionUsd = parseFloat(String(totals.commissionUsd)) || 0;
          const safeNetUsd = parseFloat(String(totals.netUsd)) || 0;

          // 3. Read the driver's carried debt fresh, inside the transaction.
          const debt = await tx.driverProfile.findUnique({
            where: { id: driverId },
            select: { carriedDebtUsd: true, carriedDebtLbp: true },
          });
          const carriedDebtUsd = debt?.carriedDebtUsd ?? 0;
          const carriedDebtLbp = debt?.carriedDebtLbp ?? 0;

          // Inject carried debt into the net amount the driver owes
          const netUsd = safeNetUsd + carriedDebtUsd;

          // 4. Next sequential index: max existing + 1 (gaps left by voided
          //    payouts are allowed; count+1 would reuse indices after voids).
          const last = await tx.driverPayout.findFirst({
            where: { driverId },
            orderBy: { sequentialIndex: "desc" },
            select: { sequentialIndex: true },
          });
          const seqIndex = (last?.sequentialIndex ?? 0) + 1;

          // Human-readable reference: driverId (e.g. D001) - sequence (e.g. 001).
          // Uniqueness is enforced by the DB (@unique payoutReference).
          const payoutReference = `${driverCode}-${String(seqIndex).padStart(3, "0")}`;

          // 5. Atomically CONSUME the carried debt (compare-and-swap): zero it
          //    only if it still equals the value we just read. A concurrent
          //    payout that consumed it first makes this match 0 rows, so this
          //    attempt rolls back and retries — the second payout then injects
          //    whatever debt remains. Either way the debt is injected exactly once.
          if (carriedDebtUsd > 0 || carriedDebtLbp > 0) {
            const consumed = await tx.driverProfile.updateMany({
              where: {
                id: driverId,
                carriedDebtUsd: carriedDebtUsd,
                carriedDebtLbp: carriedDebtLbp,
              },
              data: { carriedDebtUsd: 0, carriedDebtLbp: 0 },
            });
            if (consumed.count !== 1) {
              throw new ConcurrencyConflictError(
                "Driver's carried debt changed during payout creation",
              );
            }
          }

          // 6. Create the payout record.
          const payoutRecord = await tx.driverPayout.create({
            data: {
              driverId,
              sequentialIndex: seqIndex,
              payoutReference,
              totalUsd: safeTotalUsd,
              totalLbp: safeTotalLbp,
              commissionUsd: safeCommissionUsd,
              netUsd,
              totalCollected: safeTotalUsd,
              previousDebtUsd: carriedDebtUsd,
              previousDebtLbp: carriedDebtLbp,
              status: "PENDING",
              createdById,
            },
          });

          // 7. Claim the orders for this payout batch — keep financialStatus
          //    unchanged (WD/UD); it only transitions to "WO" (With Office)
          //    when cash is physically received during settlement. Only
          //    UNCLAIMED eligible orders are linked (driverPayoutId: null) so
          //    a concurrent payout cannot double-book the same order.
          const claimedOrders = await tx.order.updateMany({
            where: {
              id: { in: requestedIds },
              driverId,
              location: "DELIVERED",
              financialStatus: { in: PAID_OUT_ELIGIBLE_STATUSES },
              driverPayoutId: null,
            },
            data: {
              driverPayoutId: payoutRecord.id,
              // financialStatus intentionally unchanged
            },
          });

          if (claimedOrders.count !== requestedIds.length) {
            // Eligibility changed between the step-1 read and this claim
            // (a concurrent payout won). Roll back and retry the whole unit.
            throw new ConcurrencyConflictError(
              "One or more orders changed eligibility during payout creation.",
            );
          }

          return tx.driverPayout.findUnique({
            where: { id: payoutRecord.id },
            include: { orders: true },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      ),
    );

    return NextResponse.json(payout, { status: 201 });
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
    console.error("POST /api/drivers/[id]/payouts Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
