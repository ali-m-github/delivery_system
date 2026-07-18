import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// GET /api/drivers/[id]/payouts — Fetch all pending DriverPayouts for a driver
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
        orders: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(payouts, { status: 200 });
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

    const body = await request.json();
    const { orderIds } = body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "orderIds must be a non-empty array" },
        { status: 400 },
      );
    }

    // Fetch the orders from the DB to prevent client-side spoofing
    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds },
        driverId,
        location: "DELIVERED",
        financialStatus: { in: ["WD", "UD"] },
      },
    });

    if (orders.length === 0) {
      return NextResponse.json(
        { error: "No valid delivered orders found for the provided IDs" },
        { status: 400 },
      );
    }

    // Calculate totals from DB values (server-side, not trusting client)
    const dbTotalUsd = orders.reduce((sum, o) => sum + (o.amountUsd ?? 0), 0);
    const dbTotalLbp = orders.reduce((sum, o) => sum + (o.amountLbp ?? 0), 0);

    // Sanitize numeric values to prevent Prisma type crashes (NaN / undefined)
    const safeTotalUsd = parseFloat(String(dbTotalUsd)) || 0;
    const safeTotalLbp = parseFloat(String(dbTotalLbp)) || 0;

    // ── Server-side commission recalculation ─────────────────────────────
    // The backend MUST NOT trust the frontend's math. Recalculate everything.
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      include: {
        driverSellerRates: true,
        zoneRates: true,
      },
    });

    if (!driver) {
      return NextResponse.json(
        { error: "Driver profile not found" },
        { status: 404 },
      );
    }

    let finalCommission = 0;

    orders.forEach((order) => {
      const orderMerchantId = String(order.merchantId ?? "");
      const orderZoneId = String(order.zoneId);

      // Tier 1: Seller Exception (driverSellerRates)
      const exception = driver.driverSellerRates.find(
        (rate) => String(rate.merchantId) === orderMerchantId,
      );

      if (exception) {
        finalCommission += Number(exception.rateUsd || 0);
      } else {
        // Tier 2: Zone Rate
        const zoneRate = driver.zoneRates.find(
          (rate) => String(rate.zoneId) === orderZoneId,
        );
        finalCommission += Number(zoneRate?.rate || 0);
      }
    });

    const safeCommissionUsd = parseFloat(String(finalCommission)) || 0;
    let safeNetUsd = safeTotalUsd - safeCommissionUsd;

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
          financialStatus: { in: ["WD", "UD"] },
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
