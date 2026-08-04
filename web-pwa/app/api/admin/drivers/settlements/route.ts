import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { requireServerPermission } from "@/lib/server-permissions";

const prisma = new PrismaClient();

// Enrich orders with per-order driver commission (3-tier logic)
async function enrichOrdersWithCommission(payouts: any[]) {
  return Promise.all(
    payouts.map(async (payout) => {
      const driverId = payout.driverId;
      const userId = payout.driver?.userId;

      const [zoneRates, sellerRates, cashSellerRates] = await Promise.all([
        prisma.driverZoneRate.findMany({ where: { driverId } }),
        prisma.driverSellerRate.findMany({ where: { driverId } }),
        userId
          ? prisma.driverCashSellerRate.findMany({
              where: { driverId: userId },
            })
          : Promise.resolve([]),
      ]);

      const zoneRateMap = new Map(
        zoneRates.map((zr: any) => [zr.zoneId, zr.rate]),
      );
      const sellerExceptionMap = new Map<string, number>();
      for (const sr of sellerRates) {
        if (sr.rateUsd > 0) sellerExceptionMap.set(sr.merchantId, sr.rateUsd);
      }
      for (const cr of cashSellerRates) {
        if (cr.rateUsd > 0) sellerExceptionMap.set(cr.merchantId, cr.rateUsd);
      }

      const ordersWithCommission = (payout.orders || []).map((order: any) => {
        const orderMerchantId = String(order.merchantId ?? "");
        const orderZoneId = String(order.zoneId);
        const exceptionRate = orderMerchantId
          ? sellerExceptionMap.get(orderMerchantId)
          : undefined;
        const driverCommissionUsd =
          exceptionRate !== undefined
            ? exceptionRate
            : (zoneRateMap.get(orderZoneId) ?? 0);

        // Normalize collected amounts — fallback to order amount when not explicitly set
        const collectedUsd =
          (order.collectedUsd ?? 0) > 0
            ? order.collectedUsd
            : (order.amountUsd ?? 0);
        const collectedLbp =
          (order.collectedLbp ?? 0) > 0
            ? order.collectedLbp
            : (order.amountLbp ?? 0);

        return {
          ...order,
          collectedUsd,
          collectedLbp,
          driverCommissionUsd,
          payoutId: payout.id,
          payoutReference: payout.payoutReference || null,
        };
      });

      return {
        ...payout,
        orders: ordersWithCommission,
      };
    }),
  );
}

// GET /api/admin/drivers/settlements — Fetch PENDING DriverPayouts only.
// Cleared payouts (PENDING_APPROVAL / SETTLED) are handled on the Cleared Payouts page.
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
            userId: true,
          },
        },
        orders: {
          select: {
            id: true,
            orderId: true,
            customerName: true,
            createdAt: true,
            amountUsd: true,
            amountLbp: true,
            collectedUsd: true,
            collectedLbp: true,
            financialStatus: true,
            zoneId: true,
            merchantId: true,
            zone: {
              select: { name: true },
            },
            merchant: {
              select: { merchantName: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Enrich pending payouts with per-order commission
    const enrichedPending = await enrichOrdersWithCommission(pendingPayouts);

    // Map to clean settlement objects
    const mapPayout = (p: any) => {
      const totalCollected = (p.orders || []).reduce(
        (sum: number, o: any) => sum + (Number(o.collectedUsd) || 0),
        0,
      );
      return {
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
        totalCollected,
        previousDebtUsd: p.previousDebtUsd,
        previousDebtLbp: p.previousDebtLbp,
        remainingUsd: p.remainingUsd,
        remainingLbp: p.remainingLbp,
        carriedDebtUsd: p.driver.carriedDebtUsd,
        carriedDebtLbp: p.driver.carriedDebtLbp,
        status: p.status,
        createdAt: p.createdAt,
        clearedAt: p.clearedAt,
        amountPaidUsd: p.amountPaidUsd,
        amountPaidLbp: p.amountPaidLbp,
        orders: p.orders,
      };
    };

    const settlements = enrichedPending.map(mapPayout);

    return NextResponse.json({ settlements }, { status: 200 });
  } catch (error: any) {
    console.error("GET settlements error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/admin/drivers/settlements — Phase 1 (Settle): record amount paid and
// move a PENDING payout to PENDING_APPROVAL. Orders remain 'WD' until approval.
export async function POST(request: Request) {
  try {
    // ── Server-side RBAC: require DRIVERS_PAYOUT before any work ──
    const authResult = await requireServerPermission(request, "DRIVERS_PAYOUT");
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const {
      payoutId,
      treasuryBoxId,
      amountPaidUsd,
      amountPaidLbp,
      paidStatementIds = [],
      statements = [],
    } = body;

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

    // ── Paid-by-driver statements ─────────────────────────────────────────
    // The driver paid these statements from his own money, so the company
    // deducts them from the payout. They must be AVAILABLE (not approved and
    // not pending approval) — the driver cannot pay a statement twice.
    //
    // Each statement is also assigned a cashbox (treasury box) to be paid
    // into. On approval (Phase 2) the FULL payout posts to the main cashbox
    // while each statement posts its own full amount to its chosen cashbox.
    let statementSelections: { id: string; treasuryBoxId: string }[] = [];
    if (Array.isArray(statements) && statements.length > 0) {
      statementSelections = statements
        .filter((s: any) => s && s.id)
        .map((s: any) => ({
          id: String(s.id),
          treasuryBoxId: String(s.treasuryBoxId || ""),
        }));
    } else if (Array.isArray(paidStatementIds)) {
      // Legacy clients: no per-statement cashbox — default to the main box.
      statementSelections = paidStatementIds
        .filter(Boolean)
        .map((id: string) => ({ id: String(id), treasuryBoxId }));
    }

    const statementIds = statementSelections.map((s) => s.id);

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

      // 1b. Validate + resolve the paid-by-driver statements.
      let statementsDeductedUsd = 0;
      let statementsDeductedLbp = 0;
      if (statementIds.length > 0) {
        const statements = await tx.merchantPayout.findMany({
          where: { id: { in: statementIds } },
        });

        if (statements.length !== statementIds.length) {
          throw new Error(
            "One or more selected statements could not be found.",
          );
        }

        for (const stmt of statements) {
          if (
            stmt.paymentStatus === "PAID" ||
            stmt.paymentStatus === "PENDING_APPROVAL"
          ) {
            throw new Error(
              `Statement #${stmt.sequentialIndex} is already paid or pending approval and cannot be deducted twice.`,
            );
          }
          if (stmt.paidByDriverPayoutId) {
            throw new Error(
              `Statement #${stmt.sequentialIndex} was already paid by a driver.`,
            );
          }
          const selection = statementSelections.find((s) => s.id === stmt.id);
          if (!selection || !selection.treasuryBoxId) {
            throw new Error(
              `Statement #${stmt.sequentialIndex} must have a cashbox selected to be paid into.`,
            );
          }
          statementsDeductedUsd += stmt.netUsd ?? 0;
          statementsDeductedLbp += stmt.netLbp ?? 0;
        }
      }

      // The driver already paid the selected statements from his own money, so
      // they are deducted from the total the driver must deliver. `amountPaidUsd`
      // is the cash actually handed to the cashbox (already reduced by the
      // frontend); the statements are deducted here so remaining = net - cash -
      // statements.
      // Calculate remaining deficit — negative means overpaid, 0 means exact
      const remainingUsd =
        payout.netUsd - safeAmountPaidUsd - statementsDeductedUsd;
      const remainingLbp = payout.totalLbp - safeAmountPaidLbp;

      // Phase 1 (Settle): record the amount paid and move to PENDING_APPROVAL.
      // Orders stay at 'WD' — they flip to 'WO' only during approval (Phase 2).
      const newStatus = "PENDING_APPROVAL";

      // 2. Update the DriverPayout — record the amount paid, remember the chosen
      //    treasury box, and move to PENDING_APPROVAL.
      const updatedPayout = await tx.driverPayout.update({
        where: { id: payoutId },
        data: {
          amountPaidUsd: safeAmountPaidUsd,
          amountPaidLbp: safeAmountPaidLbp,
          remainingUsd,
          remainingLbp,
          status: newStatus,
          treasuryBoxId,
          statementsDeductedUsd,
          statementsDeductedLbp,
        },
      });

      // 2b. Link the paid-by-driver statements to this payout and hold them as
      // PENDING_APPROVAL. Each statement records the cashbox it will be paid
      // into; it is only marked PAID (and posted to its cashbox) when the
      // payout is approved in Phase 2.
      if (statementIds.length > 0) {
        const statements = await tx.merchantPayout.findMany({
          where: { id: { in: statementIds } },
        });
        for (const stmt of statements) {
          const selection = statementSelections.find((s) => s.id === stmt.id);
          await tx.merchantPayout.update({
            where: { id: stmt.id },
            data: {
              paymentStatus: "PENDING_APPROVAL",
              paidByDriverPayoutId: payout.id,
              amountPaidUsd: stmt.netUsd ?? 0,
              amountPaidLbp: stmt.netLbp ?? 0,
              treasuryBoxId: selection?.treasuryBoxId || null,
            },
          });
        }
      }

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

      // Orders tied to this payout remain 'WD' at settle time — they are only
      // flipped to 'WO' (With Office) when the payout is approved (Phase 2).
      // No treasury IN transaction is created here: the payout is not approved
      // yet, so the money must NOT hit the treasury box. The transaction is
      // created in the approve route (Phase 2) using the stored treasuryBoxId.

      return {
        payout: updatedPayout,
        remainingUsd,
        remainingLbp,
        newStatus,
        statementsDeductedUsd,
        statementsDeductedLbp,
        statementsCount: statementIds.length,
      };
    });

    return NextResponse.json(
      {
        success: true,
        message: `Settlement recorded ($${result.remainingUsd.toFixed(
          2,
        )} USD carried as debt if short-paid). ${
          result.statementsCount > 0
            ? `${result.statementsCount} statement(s) paid by driver deducted ($${result.statementsDeductedUsd.toFixed(2)}). `
            : ""
        }Payout is now PENDING_APPROVAL.`,
        ...result,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("POST settlement error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
