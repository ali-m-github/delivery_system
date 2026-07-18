import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// GET /api/admin/drivers/settlements — Fetch PENDING + historical (CLEARED/PAID) DriverPayouts
export async function GET() {
  try {
    // Fetch Active (Pending) Payouts
    const pendingPayouts = await prisma.driverPayout.findMany({
      where: { status: "PENDING" },
      include: {
        driver: {
          select: {
            id: true,
            driverId: true,
            firstName: true,
            lastName: true,
            carriedDebtUsd: true,
            carriedDebtLbp: true,
          },
        },
        orders: {
          select: {
            id: true,
            orderId: true,
            amountUsd: true,
            amountLbp: true,
            collectedUsd: true,
            collectedLbp: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Fetch Historical (Settled) Payouts — limited to recent 50
    const settledPayouts = await prisma.driverPayout.findMany({
      where: { status: { in: ["CLEARED", "PAID"] } },
      include: {
        driver: {
          select: {
            id: true,
            driverId: true,
            firstName: true,
            lastName: true,
            carriedDebtUsd: true,
            carriedDebtLbp: true,
          },
        },
        orders: {
          select: {
            id: true,
            orderId: true,
            amountUsd: true,
            amountLbp: true,
            collectedUsd: true,
            collectedLbp: true,
          },
        },
      },
      orderBy: { clearedAt: "desc" },
      take: 50,
    });

    // Map to clean settlement objects
    const mapPayout = (p: any) => ({
      payoutId: p.id,
      payoutReference: p.payoutReference || null,
      driverId: p.driverId,
      driverName: `${p.driver.firstName} ${p.driver.lastName}`,
      driverInternalId: p.driver.driverId,
      sequentialIndex: p.sequentialIndex,
      orderCount: p.orders.length,
      totalUsd: p.totalUsd,
      totalLbp: p.totalLbp,
      commissionUsd: p.commissionUsd,
      netUsd: p.netUsd,
      previousDebtUsd: p.previousDebtUsd,
      previousDebtLbp: p.previousDebtLbp,
      remainingUsd: p.remainingUsd,
      remainingLbp: p.remainingLbp,
      carriedDebtUsd: p.driver.carriedDebtUsd,
      carriedDebtLbp: p.driver.carriedDebtLbp,
      status: p.status,
      clearedAt: p.clearedAt,
      amountPaidUsd: p.amountPaidUsd,
      amountPaidLbp: p.amountPaidLbp,
      orders: p.orders,
    });

    const settlements = pendingPayouts.map(mapPayout);
    const history = settledPayouts.map(mapPayout);

    return NextResponse.json({ settlements, history }, { status: 200 });
  } catch (error: any) {
    console.error("GET settlements error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/admin/drivers/settlements — Partial or full settlement
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { payoutId, treasuryBoxId, amountPaidUsd, amountPaidLbp } = body;

    if (!payoutId) {
      return NextResponse.json({ error: "Missing payoutId" }, { status: 400 });
    }

    if (!treasuryBoxId) {
      return NextResponse.json(
        { error: "Missing treasuryBoxId — select a Treasury Box" },
        { status: 400 },
      );
    }

    const safeAmountPaidUsd = parseFloat(String(amountPaidUsd ?? 0)) || 0;
    const safeAmountPaidLbp = parseFloat(String(amountPaidLbp ?? 0)) || 0;

    if (safeAmountPaidUsd <= 0 && safeAmountPaidLbp <= 0) {
      return NextResponse.json(
        { error: "Amount paid must be greater than 0" },
        { status: 400 },
      );
    }

    // Execute full settlement in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch the payout to get net values
      const payout = await tx.driverPayout.findUnique({
        where: { id: payoutId },
      });

      if (!payout) {
        throw new Error("Payout not found");
      }

      if (payout.status !== "PENDING") {
        throw new Error("Payout is not in PENDING status");
      }

      // Calculate remaining deficit — negative means overpaid, 0 means exact
      const remainingUsd = payout.netUsd - safeAmountPaidUsd;
      const remainingLbp = payout.totalLbp - safeAmountPaidLbp;

      // Always mark as CLEARED — any deficit is carried as debt on the DriverProfile
      const newStatus = "CLEARED";

      // 2. Update the DriverPayout
      const updatedPayout = await tx.driverPayout.update({
        where: { id: payoutId },
        data: {
          amountPaidUsd: safeAmountPaidUsd,
          amountPaidLbp: safeAmountPaidLbp,
          remainingUsd,
          remainingLbp,
          status: newStatus,
          clearedAt: new Date(),
        },
      });

      // 3. Update DriverProfile: atomically increment carriedDebt on short-payment
      //    Only carry debt forward when there's a deficit (remaining > 0).
      //    Uses Prisma's atomic { increment } to prevent read-then-write races.
      if (remainingUsd > 0 || remainingLbp > 0) {
        await tx.driverProfile.update({
          where: { id: payout.driverId },
          data: {
            carriedDebtUsd: { increment: remainingUsd > 0 ? remainingUsd : 0 },
            carriedDebtLbp: { increment: remainingLbp > 0 ? remainingLbp : 0 },
          },
        });
      }

      // 4. Update orders tied to this payout: enforce WO (With Office)
      // Cash has physically moved from driver to office treasury
      await tx.order.updateMany({
        where: { driverPayoutId: payoutId },
        data: {
          financialStatus: "WO",
        },
      });

      // 5. Create TreasuryTransaction (type "IN" — money coming into treasury)
      await tx.treasuryTransaction.create({
        data: {
          boxId: treasuryBoxId,
          type: "IN",
          amountUsd: safeAmountPaidUsd,
          amountLbp: safeAmountPaidLbp,
          description: `Settlement for payout #${payout.sequentialIndex} — Driver ${payout.driverId}`,
          referenceId: payoutId,
        },
      });

      // 6. Update TreasuryBox balance
      const treasuryBox = await tx.treasuryBox.findUnique({
        where: { id: treasuryBoxId },
      });

      if (treasuryBox) {
        await tx.treasuryBox.update({
          where: { id: treasuryBoxId },
          data: {
            balanceUsd: treasuryBox.balanceUsd + safeAmountPaidUsd,
            balanceLbp: treasuryBox.balanceLbp + safeAmountPaidLbp,
          },
        });
      } else {
        throw new Error("Treasury box not found");
      }

      return {
        payout: updatedPayout,
        remainingUsd,
        remainingLbp,
        newStatus,
      };
    });

    return NextResponse.json(
      {
        success: true,
        message:
          result.newStatus === "CLEARED"
            ? "Settlement fully cleared."
            : `Partial settlement recorded. Remaining: $${result.remainingUsd.toFixed(2)} USD carried as debt.`,
        ...result,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("POST settlement error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
