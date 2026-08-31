import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  loadDriverRateTable,
  recalcPayoutTotals,
  enrichPayoutOrdersWithCommission,
  PAID_OUT_ELIGIBLE_STATUSES,
} from "@/lib/commission";
import { requireAuthenticatedSession } from "@/lib/server-permissions";
import {
  withConcurrencyRetries,
  ConcurrencyConflictError,
} from "@/lib/concurrency";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

// GET /api/drivers/[id]/payouts — Fetch all pending DriverPayouts for a driver
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthenticatedSession(request);
  if (auth instanceof Response) return auth;
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
      select: { id: true },
    });

    if (!profile) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
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
    // precedence from lib/commission.ts: seller exception → zone → $0),
    // honoring $0 seller exceptions. One rate-table load for the driver.
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

// POST /api/drivers/[id]/payouts — Create a new payout batch from delivered orders
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthenticatedSession(request);
  if (auth instanceof Response) return auth;
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

    const driverId = profile.id;

    // Self-service scoping: a DRIVER may only create payout batches for their
    // own profile. Other roles (staff/admin) are unrestricted.
    if (auth.user.role === "DRIVER" && profile.userId !== auth.user.id) {
      return NextResponse.json(
        { error: "Drivers may only create payouts for their own account" },
        { status: 403 },
      );
    }

    // Attribute this payout to the authenticated user who created it
    const createdById = auth.user.id;

    const body = await request.json();
    const { orderIds } = body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "orderIds must be a non-empty array" },
        { status: 400 },
      );
    }

    // Fetch the orders from the DB to prevent client-side spoofing.
    // Eligibility (concern B, unified in lib/commission.ts): DELIVERED and
    // financial status WD or UD.
    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds },
        driverId,
        location: "DELIVERED",
        financialStatus: { in: PAID_OUT_ELIGIBLE_STATUSES },
      },
    });

    if (orders.length === 0) {
      return NextResponse.json(
        { error: "No valid delivered orders found for the provided IDs" },
        { status: 400 },
      );
    }

    // ── Server-side financial recalculation ──────────────────────────────
    // The backend MUST NOT trust the frontend's math. Recalculate everything
    // through the authoritative commission module: gross (collected > 0 else
    // amount), commission (seller exception → zone → $0), net = gross − fee.
    const rateTable = await loadDriverRateTable(prisma, driverId, profile.userId);
    const totals = recalcPayoutTotals(rateTable, orders);

    // Sanitize numeric values to prevent Prisma type crashes (NaN / undefined)
    const safeTotalUsd = parseFloat(String(totals.totalUsd)) || 0;
    const safeTotalLbp = parseFloat(String(totals.totalLbp)) || 0;
    const safeCommissionUsd = parseFloat(String(totals.commissionUsd)) || 0;
    const safeNetUsd = parseFloat(String(totals.netUsd)) || 0;

    // Carried debt, the sequential index and the payout reference are all
    // generated INSIDE the transaction (below): reading/claiming them outside
    // let concurrent creations reuse the same index or double-inject debt.
    // The DB constraints (@@unique([driverId, sequentialIndex]) and
    // @unique payoutReference) make collisions impossible; a P2002 from a
    // lost race aborts the attempt and the whole unit of work is retried
    // with a fresh read.
    const payout = await withConcurrencyRetries(() =>
      prisma.$transaction(async (tx) => {
        // 1. Read the driver's carried debt fresh, inside the transaction.
        const debt = await tx.driverProfile.findUnique({
          where: { id: driverId },
          select: { carriedDebtUsd: true, carriedDebtLbp: true },
        });
        const carriedDebtUsd = debt?.carriedDebtUsd ?? 0;
        const carriedDebtLbp = debt?.carriedDebtLbp ?? 0;

        // Inject carried debt into the net amount the driver owes
        const netUsd = safeNetUsd + carriedDebtUsd;

        // 2. Next sequential index: max existing + 1 (gaps left by voided
        //    payouts are allowed; count+1 would reuse indices after voids).
        const last = await tx.driverPayout.findFirst({
          where: { driverId },
          orderBy: { sequentialIndex: "desc" },
          select: { sequentialIndex: true },
        });
        const seqIndex = (last?.sequentialIndex ?? 0) + 1;

        // Human-readable reference: driverId (e.g. D001) - sequence (e.g. 001).
        // Uniqueness is enforced by the DB (@unique payoutReference).
        const payoutReference = `${profile!.driverId}-${String(seqIndex).padStart(3, "0")}`;

        // 3. Atomically CONSUME the carried debt (compare-and-swap): zero it
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

        // 4. Create the payout record.
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
            createdById: createdById ?? undefined,
          },
        });

        // 5. Claim the orders for this payout batch — keep financialStatus as
        //    "WD" (With Driver). Status must NOT change here; it only
        //    transitions to "WO" (With Office) when cash is physically
        //    received during settlement. Only UNCLAIMED eligible orders are
        //    linked (driverPayoutId: null) so a concurrent payout cannot
        //    double-book the same order into two batches.
        const claimedOrders = await tx.order.updateMany({
          where: {
            id: { in: orderIds },
            driverId,
            location: "DELIVERED",
            financialStatus: { in: PAID_OUT_ELIGIBLE_STATUSES },
            driverPayoutId: null,
          },
          data: {
            driverPayoutId: payoutRecord.id,
            // financialStatus remains "WD" — enforced in settlement route
          },
        });

        if (claimedOrders.count !== orders.length) {
          throw new Error(
            "One or more orders are already part of another payout batch or are no longer eligible.",
          );
        }

        return tx.driverPayout.findUnique({
          where: { id: payoutRecord.id },
          include: { orders: true },
        });
      })
    );

    return NextResponse.json(payout, { status: 201 });
  } catch (error) {
    console.error("POST /api/drivers/[id]/payouts Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
