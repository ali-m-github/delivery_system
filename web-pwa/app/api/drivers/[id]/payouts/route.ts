import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import {
  loadDriverRateTable,
  recalcPayoutTotals,
  enrichPayoutOrdersWithCommission,
  PAID_OUT_ELIGIBLE_STATUSES,
} from "@/lib/commission";
import { requireAuthenticatedSession } from "@/lib/server-permissions";

const prisma = new PrismaClient();

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
      select: { id: true, userId: true },
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
    let safeNetUsd = parseFloat(String(totals.netUsd)) || 0;

    // Fetch driver's carried debt to inject into this payout
    const driverProfile = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { carriedDebtUsd: true, carriedDebtLbp: true },
    });

    const carriedDebtUsd = driverProfile?.carriedDebtUsd ?? 0;
    const carriedDebtLbp = driverProfile?.carriedDebtLbp ?? 0;

    // Inject carried debt into the net amount the driver owes
    safeNetUsd += carriedDebtUsd;

    // Count existing payouts for this driver to generate sequential index
    const priorCount = await prisma.driverPayout.count({ where: { driverId } });
    const seqIndex = priorCount + 1;

    // Generate human-readable payoutReference: driverId (e.g. D001) - sequence (e.g. 001)
    const driverProfileForRef = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { driverId: true },
    });
    const payoutReference = `${driverProfileForRef!.driverId}-${String(seqIndex).padStart(3, "0")}`;

    // Create the payout record and update orders in a transaction
    const payout = await prisma.$transaction(async (tx) => {
      const payoutRecord = await tx.driverPayout.create({
        data: {
          driverId,
          sequentialIndex: seqIndex,
          payoutReference,
          totalUsd: safeTotalUsd,
          totalLbp: safeTotalLbp,
          commissionUsd: safeCommissionUsd,
          netUsd: safeNetUsd,
          totalCollected: safeTotalUsd,
          previousDebtUsd: carriedDebtUsd,
          previousDebtLbp: carriedDebtLbp,
          status: "PENDING",
          createdById: createdById ?? undefined,
        },
      });

      // Link orders to this payout batch — keep financialStatus as "WD" (With Driver).
      // Status must NOT change here. It only transitions to "WO" (With Office)
      // when cash is physically received during the settlement step.
      await tx.order.updateMany({
        where: {
          id: { in: orderIds },
          driverId,
          location: "DELIVERED",
          financialStatus: { in: PAID_OUT_ELIGIBLE_STATUSES },
        },
        data: {
          driverPayoutId: payoutRecord.id,
          // financialStatus remains "WD" — enforced in settlement route
        },
      });

      // Zero out the driver's carried debt since it's now encapsulated in this payout
      if (carriedDebtUsd > 0 || carriedDebtLbp > 0) {
        await tx.driverProfile.update({
          where: { id: driverId },
          data: {
            carriedDebtUsd: 0,
            carriedDebtLbp: 0,
          },
        });
      }

      return tx.driverPayout.findUnique({
        where: { id: payoutRecord.id },
        include: { orders: true },
      });
    });

    return NextResponse.json(payout, { status: 201 });
  } catch (error) {
    console.error("POST /api/drivers/[id]/payouts Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
