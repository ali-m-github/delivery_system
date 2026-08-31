import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

/** Thrown when a row was already processed by another request (CAS claim lost). */
class AlreadyProcessedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadyProcessedError";
  }
}

// POST /api/admin/treasury/transactions/[id]/reject — Reject a pending transaction.
//
// A rejected PENDING_APPROVAL transaction never touches the cashbox balance.
// If the transaction paid a statement, the statement is returned to UNPAID so it
// can be paid again (it is not approved and no longer pending approval).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // ── Server-side RBAC: require treasury transact permission ──
    const authResult = await requireServerPermission(
      request,
      "ACTION_TREASURY_TRANSACT",
    );
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const resolvedParams = await params;
    const { id: txId } = resolvedParams;

    if (!txId) {
      return NextResponse.json(
        { error: "Missing transaction id" },
        { status: 400 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch the transaction.
      const transaction = await tx.treasuryTransaction.findUnique({
        where: { id: txId },
      });

      if (!transaction) {
        throw new Error("Transaction not found");
      }

      if (transaction.status !== "PENDING_APPROVAL") {
        throw new AlreadyProcessedError(
          "Transaction is not pending approval. Only PENDING_APPROVAL transactions can be rejected.",
        );
      }

      // 2. CLAIM the transaction with a conditional update (compare-and-swap)
      //    so a concurrent approve/reject cannot both win. Only one claimant
      //    sees count === 1; the loser rolls back with nothing persisted.
      //    No balance change is applied on rejection.
      const claimed = await tx.treasuryTransaction.updateMany({
        where: { id: txId, status: "PENDING_APPROVAL" },
        data: {
          status: "REJECTED",
          rejectedById: user.id,
          rejectedAt: new Date(),
        },
      });

      if (claimed.count !== 1) {
        throw new AlreadyProcessedError(
          "Transaction is not pending approval. Only PENDING_APPROVAL transactions can be rejected.",
        );
      }

      // 3. If this transaction paid a statement, return it to UNPAID.
      if (transaction.referenceId) {
        const statement = await tx.merchantPayout.findUnique({
          where: { id: transaction.referenceId },
        });
        if (statement) {
          await tx.merchantPayout.update({
            where: { id: statement.id },
            data: {
              paymentStatus: "UNPAID",
              treasuryBoxId: null,
              treasuryTransactionId: null,
            },
          });
        }
      }

      const updated = await tx.treasuryTransaction.findUniqueOrThrow({
        where: { id: txId },
      });
      return { transaction: updated };
    });

    return NextResponse.json(
      {
        success: true,
        message:
          "Transaction rejected. The cashbox balance was not changed and any linked statement is available to pay again.",
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
    console.error("POST treasury transaction reject error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
