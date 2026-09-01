import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";
import {
  withConcurrencyRetries,
  ConcurrencyConflictError,
} from "@/lib/concurrency";
import {
  loadDriverRateTable,
  enrichPayoutOrdersWithCommission,
} from "@/lib/commission";

/** Thrown when a row was already processed by another request (CAS claim lost). */
class AlreadyProcessedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadyProcessedError";
  }
}

// Enrich orders with per-order driver commission (authoritative precedence
// from lib/commission.ts: seller exception (cash wins) → zone rate → MISSING).
// A configured $0 is valid; a missing rate yields driverCommissionUsd: null
// ("Rate not configured"), never a silent $0.
// Rate tables are loaded ONCE PER DRIVER (grouped), not per payout, so the
// old N+1 per-payout rate loading is gone.
async function enrichOrdersWithCommission(payouts: any[]) {
  // Group payouts by driver so each driver's rate table is loaded once.
  const byDriver = new Map<string, any[]>();
  for (const payout of payouts) {
    const group = byDriver.get(payout.driverId) ?? [];
    group.push(payout);
    byDriver.set(payout.driverId, group);
  }

  // Load all rate tables in parallel (one per driver).
  const tableByDriver = new Map<string, Awaited<ReturnType<typeof loadDriverRateTable>>>();
  await Promise.all(
    Array.from(byDriver.entries()).map(async ([driverId, driverPayouts]) => {
      const userId = driverPayouts[0]?.driver?.userId;
      tableByDriver.set(
        driverId,
        await loadDriverRateTable(prisma, driverId, userId),
      );
    }),
  );

  // Enrich while preserving the original payout order.
  return payouts.map((payout) => {
    const rateTable = tableByDriver.get(payout.driverId)!;
    return {
      ...payout,
      orders: enrichPayoutOrdersWithCommission(rateTable, payout.orders || []).map(
        (order: any) => ({
          ...order,
          payoutId: payout.id,
          payoutReference: payout.payoutReference || null,
        }),
      ),
    };
  });
}

// GET /api/admin/drivers/settlements — Fetch PENDING DriverPayouts only.
// Cleared payouts (PENDING_APPROVAL / SETTLED) are handled on the Cleared Payouts page.
export async function GET(request: Request) {
  const auth = await requireServerPermission(request, "DRIVERS_VIEW");
  if (auth instanceof Response) return auth;
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
        createdBy: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        orders: {
          select: {
            id: true,
            orderId: true,
            customerName: true,
            customerPhone: true,
            customerAddress: true,
            location: true,
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
        createdBy: p.createdBy || null,
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
  } catch (error: unknown) {
    console.error("GET settlements error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
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

    // Allow $0 payments (e.g., a payout whose net is $0) to still be settled
    // into the treasury box, but never allow a negative amount.
    if (safeAmountPaidUsd < 0 || safeAmountPaidLbp < 0) {
      return NextResponse.json(
        { error: "Amount paid cannot be negative" },
        { status: 400 },
      );
    }

    // Execute full settlement in a transaction. Wrapped in a retry loop so a
    // lost CAS race (concurrent settle of the same payout) re-runs cleanly.
    const result = await withConcurrencyRetries(() =>
      prisma.$transaction(async (tx) => {
      // 1. Fetch the payout to get net values
      const payout = await tx.driverPayout.findUnique({
        where: { id: payoutId },
      });

      if (!payout) {
        throw new Error("Payout not found");
      }

      if (payout.status !== "PENDING") {
        throw new AlreadyProcessedError("Payout is not in PENDING status");
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
            throw new AlreadyProcessedError(
              `Statement #${stmt.sequentialIndex} is already paid or pending approval and cannot be deducted twice.`,
            );
          }
          if (stmt.paidByDriverPayoutId) {
            throw new AlreadyProcessedError(
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

      // 2. CLAIM the payout with a conditional update (compare-and-swap):
      //    only a PENDING payout can be settled. Concurrent settles serialize
      //    on the payout row lock; exactly one sees count === 1. The loser's
      //    transaction rolls back with nothing persisted.
      const claimedPayout = await tx.driverPayout.updateMany({
        where: { id: payoutId, status: "PENDING" },
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

      if (claimedPayout.count !== 1) {
        throw new ConcurrencyConflictError("Payout was settled concurrently");
      }

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
          // CAS: only claim statements that are still available (not paid /
          // not pending approval / not already paid by a driver). If a
          // concurrent request took one, this attempt rolls back entirely.
          const claimedStmt = await tx.merchantPayout.updateMany({
            where: {
              id: stmt.id,
              paidByDriverPayoutId: null,
              paymentStatus: { notIn: ["PAID", "PENDING_APPROVAL"] },
            },
            data: {
              paymentStatus: "PENDING_APPROVAL",
              paidByDriverPayoutId: payout.id,
              amountPaidUsd: stmt.netUsd ?? 0,
              amountPaidLbp: stmt.netLbp ?? 0,
              treasuryBoxId: selection?.treasuryBoxId || null,
            },
          });
          if (claimedStmt.count !== 1) {
            throw new ConcurrencyConflictError(
              `Statement #${stmt.sequentialIndex} was taken concurrently`,
            );
          }
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

      const updatedPayout = await tx.driverPayout.findUniqueOrThrow({
        where: { id: payoutId },
      });

      return {
        payout: updatedPayout,
        remainingUsd,
        remainingLbp,
        newStatus,
        statementsDeductedUsd,
        statementsDeductedLbp,
        statementsCount: statementIds.length,
      };
      })
    );

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
    if (error instanceof AlreadyProcessedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("POST settlement error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
