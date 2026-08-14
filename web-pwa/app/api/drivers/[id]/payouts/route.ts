import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_DRIVER_USD } from "@/lib/commission";
import { getSessionUserId } from "@/helpers/auth";

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

    // Enrich each order with its per-order driver commission (3-tier logic),
    // honoring $0 seller exceptions.
    const driverProfileRef = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { userId: true },
    });
    const [zoneRates, sellerRates, cashSellerRates] = await Promise.all([
      prisma.driverZoneRate.findMany({ where: { driverId } }),
      prisma.driverSellerRate.findMany({ where: { driverId } }),
      driverProfileRef?.userId
        ? prisma.driverCashSellerRate.findMany({
            where: { driverId: driverProfileRef.userId },
          })
        : Promise.resolve([]),
    ]);
    const zoneRateMap = new Map(zoneRates.map((zr) => [zr.zoneId, zr.rate]));
    const sellerExceptionMap = new Map<string, number>();
    for (const sr of sellerRates) {
      sellerExceptionMap.set(sr.merchantId, sr.rateUsd);
    }
    for (const cr of cashSellerRates) {
      sellerExceptionMap.set(cr.merchantId, cr.rateUsd);
    }

    const enrichedPayouts = payouts.map((payout) => ({
      ...payout,
      orders: payout.orders.map((order) => {
        const orderMerchantId = String(order.merchantId ?? "");
        const orderZoneId = String(order.zoneId);
        const exceptionRate = orderMerchantId
          ? sellerExceptionMap.get(orderMerchantId)
          : undefined;
        const driverCommissionUsd =
          exceptionRate !== undefined
            ? exceptionRate
            : (zoneRateMap.get(orderZoneId) ?? DEFAULT_DRIVER_USD);
        return { ...order, driverCommissionUsd };
      }),
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

    // Attribute this payout to the authenticated user who created it
    const createdById = await getSessionUserId(request);

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

    // Build the seller-exception map (merchantId → rateUsd), merging BOTH the
    // DriverSellerRate exceptions AND the cash-seller exceptions
    // (DriverCashSellerRate, keyed by the linked User). Cash-seller rates take
    // precedence. A $0 exception is still a valid override — it must override
    // the zonal/default rate rather than falling through to it.
    const sellerExceptionMap = new Map<string, number>();
    for (const sr of driver.driverSellerRates) {
      sellerExceptionMap.set(String(sr.merchantId), Number(sr.rateUsd || 0));
    }
    if (driver.userId) {
      const cashSellerRates = await prisma.driverCashSellerRate.findMany({
        where: { driverId: driver.userId },
      });
      for (const cr of cashSellerRates) {
        sellerExceptionMap.set(String(cr.merchantId), Number(cr.rateUsd || 0));
      }
    }

    let finalCommission = 0;

    orders.forEach((order) => {
      const orderMerchantId = String(order.merchantId ?? "");
      const orderZoneId = String(order.zoneId);

      // Tier 1: Seller Exception (DriverSellerRate + DriverCashSellerRate)
      const exception = orderMerchantId
        ? sellerExceptionMap.get(orderMerchantId)
        : undefined;

      if (exception !== undefined) {
        finalCommission += exception;
      } else {
        // Tier 2: Zone Rate
        const zoneRate = driver.zoneRates.find(
          (rate) => String(rate.zoneId) === orderZoneId,
        );
        // Tier 3: System default fallback
        finalCommission += zoneRate
          ? Number(zoneRate.rate || 0)
          : DEFAULT_DRIVER_USD;
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
