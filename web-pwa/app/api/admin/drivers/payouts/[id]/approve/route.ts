import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";
import { nextTreasuryReference } from "@/lib/sequences";
import { withConcurrencyRetries } from "@/lib/concurrency";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

/** Thrown when a row was already processed by another request (CAS claim lost). */
class AlreadyProcessedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadyProcessedError";
  }
}

// POST /api/admin/drivers/payouts/[id]/approve — Phase 2 (Approve)
// Moves a PENDING_APPROVAL payout to SETTLED and flips all associated orders
// from 'WD' (With Driver) to 'WO' (With Office).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // ── Server-side RBAC: require DRIVERS_PAYOUT before any work ──
    const authResult = await requireServerPermission(request, "DRIVERS_PAYOUT");
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const resolvedParams = await params;
    const { id: payoutId } = resolvedParams;

    if (!payoutId) {
      return NextResponse.json({ error: "Missing payoutId" }, { status: 400 });
    }

    const result = await withConcurrencyRetries(() =>
      prisma.$transaction(async (tx) => {
      // 1. Fetch the payout (with driver + treasury box) and verify it is
      //    awaiting approval.
      const payout = await tx.driverPayout.findUnique({
        where: { id: payoutId },
        include: {
          driver: {
            select: { driverId: true, firstName: true, lastName: true },
          },
          paidStatements: true,
        },
      });

      if (!payout) {
        throw new Error("Payout not found");
      }

      if (payout.status !== "PENDING_APPROVAL") {
        throw new AlreadyProcessedError(
          "Payout is not awaiting approval. Only PENDING_APPROVAL payouts can be approved.",
        );
      }

      // 2. CLAIM the payout with a conditional update (compare-and-swap):
      //    only a PENDING_APPROVAL payout can be approved. Concurrent approvals
      //    serialize on the payout row lock; exactly one sees count === 1 and
      //    posts the money, the losers roll back with nothing persisted — so
      //    the cashbox can never be credited twice for the same payout.
      const claimedPayout = await tx.driverPayout.updateMany({
        where: { id: payoutId, status: "PENDING_APPROVAL" },
        data: {
          status: "SETTLED",
          clearedAt: new Date(),
        },
      });

      if (claimedPayout.count !== 1) {
        throw new AlreadyProcessedError(
          "Payout is not awaiting approval. Only PENDING_APPROVAL payouts can be approved.",
        );
      }

      // 3. Update all orders tied to this payout: WD -> WO (With Office)
      const ordersUpdated = await tx.order.updateMany({
        where: { driverPayoutId: payoutId },
        data: {
          financialStatus: "WO",
        },
      });

      // 4. Phase 2 now posts the money. Nothing was posted during settlement
      //    because the payout was not yet approved. The FULL payout (cash the
      //    driver hands over + statements he paid from his own money) is
      //    credited to the main cashbox so the payout shows in full, and each
      //    statement posts its own full amount to the cashbox chosen for it.
      //    Statements are only marked PAID here, in Phase 2.
      let transactionId: string | null = null;
      const statementTransactionIds: string[] = [];

      // References are allocated from a PostgreSQL sequence (O(1), atomic,
      // deletion-tolerant) — one call per treasury transaction created below.

      const driverName = `${payout.driver?.firstName ?? ""} ${
        payout.driver?.lastName ?? ""
      }`.trim();
      const driverId = payout.driver?.driverId ?? "";
      const payoutLabel =
        payout.payoutReference || `#${payout.sequentialIndex}`;

      const statements = payout.paidStatements || [];
      const fullPayoutUsd =
        (payout.amountPaidUsd ?? 0) + (payout.statementsDeductedUsd ?? 0);
      const fullPayoutLbp =
        (payout.amountPaidLbp ?? 0) + (payout.statementsDeductedLbp ?? 0);

      if (payout.treasuryBoxId) {
        const statementDetail = statements
          .map((s) => `#${s.sequentialIndex} ($${(s.netUsd ?? 0).toFixed(2)})`)
          .join(", ");

        const created = await tx.treasuryTransaction.create({
          data: {
            boxId: payout.treasuryBoxId,
            type: "IN",
            amountUsd: fullPayoutUsd,
            amountLbp: fullPayoutLbp,
            description:
              `Settlement for ${payoutLabel} — Driver ${driverName} (${driverId})`.trim() +
              (statementDetail
                ? ` — statements paid within: ${statementDetail}.`
                : ""),
            reference: await nextTreasuryReference(tx),
            referenceId: payout.id,
            userId: user.id,
          },
        });
        transactionId = created.id;

        // Credit the box ATOMICALLY (increment) — the ledger record and the
        // balance change commit or roll back together.
        await tx.treasuryBox.update({
          where: { id: payout.treasuryBoxId },
          data: {
            balanceUsd: { increment: fullPayoutUsd },
            balanceLbp: { increment: fullPayoutLbp },
          },
        });
      } else {
        // Payouts settled before the treasuryBoxId field existed have no box
        // stored. Surface it so the missing posting is not silent.
        console.warn(
          `Approve: payout ${payout.payoutReference || payout.id} has no ` +
            `treasuryBoxId — no treasury transaction was posted.`,
        );
      }

      // 4b. Post each statement the driver paid to its own chosen cashbox and
      //     mark it PAID. Payouts settled before per-statement cashboxes existed
      //     have statements already marked PAID with no box stored — those are
      //     skipped so they are not posted twice.
      for (const stmt of statements) {
        if (!stmt.treasuryBoxId) {
          if (stmt.paymentStatus !== "PAID") {
            console.warn(
              `Approve: statement #${stmt.sequentialIndex} paid by driver has no ` +
                `treasuryBoxId — skipping cashbox posting.`,
            );
          }
          continue;
        }

        const created = await tx.treasuryTransaction.create({
          data: {
            boxId: stmt.treasuryBoxId,
            type: "IN",
            amountUsd: stmt.netUsd ?? 0,
            amountLbp: stmt.netLbp ?? 0,
            description:
              `Statement #${stmt.sequentialIndex} — paid by Driver ${driverName} (${driverId}) via payout ${payoutLabel}.`.trim(),
            reference: await nextTreasuryReference(tx),
            referenceId: stmt.id,
            userId: user.id,
          },
        });
        statementTransactionIds.push(created.id);

        // Credit the statement's box ATOMICALLY (increment).
        await tx.treasuryBox.update({
          where: { id: stmt.treasuryBoxId },
          data: {
            balanceUsd: { increment: stmt.netUsd ?? 0 },
            balanceLbp: { increment: stmt.netLbp ?? 0 },
          },
        });

        // Mark the statement PAID and link the transaction that paid it.
        // CAS: only statements still in PENDING_APPROVAL (held by the payout
        // settle step) are transitioned, so a concurrent statement payment
        // cannot be silently overwritten.
        const claimedStmt = await tx.merchantPayout.updateMany({
          where: {
            id: stmt.id,
            paymentStatus: "PENDING_APPROVAL",
          },
          data: {
            paymentStatus: "PAID",
            treasuryTransactionId: created.id,
          },
        });
        if (claimedStmt.count !== 1) {
          throw new Error(
            `Statement #${stmt.sequentialIndex} was modified concurrently during payout approval`,
          );
        }
      }

      const updatedPayout = await tx.driverPayout.findUniqueOrThrow({
        where: { id: payoutId },
      });

      return {
        payout: updatedPayout,
        ordersUpdated: ordersUpdated.count,
        transactionId,
        statementTransactionIds,
      };
      })
    );

    return NextResponse.json(
      {
        success: true,
        message: `Payout approved and settled. ${result.ordersUpdated} order(s) marked as With Office (WO). ${
          result.statementTransactionIds.length > 0
            ? `${result.statementTransactionIds.length} statement(s) paid to their cashboxes. `
            : ""
        }`,
        ...result,
      },
      { status: 200 },
    );
  } catch (error: any) {
    if (error instanceof AlreadyProcessedError) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 },
      );
    }
    console.error("POST /api/admin/drivers/payouts/[id]/approve error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
