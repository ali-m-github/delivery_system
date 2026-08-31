import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";
import { nextTreasuryReference } from "@/lib/sequences";
import { withConcurrencyRetries, ConcurrencyConflictError } from "@/lib/concurrency";

/** Thrown when a row was already processed by another request (CAS claim lost). */
class AlreadyProcessedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadyProcessedError";
  }
}

// POST /api/statements/[id]/pay — Phase 1 (Pay) a statement into a cashbox.
//
// Mirrors the driver-payout settlement flow:
//   - The amount is prefilled with the statement's netUsd but the user may edit
//     it (like the driver payout settle popup).
//   - A TreasuryTransaction is created with status PENDING_APPROVAL and linked to
//     the chosen cashbox. The box balance is NOT touched yet — the money only
//     counts toward the cashbox once an admin/editor approves the transaction
//     (Phase 2), or is discarded if rejected.
//   - Guards: a statement cannot be paid twice if it is already approved (PAID)
//     or has a transaction pending approval (PENDING_APPROVAL).
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
    const { id: statementId } = resolvedParams;

    if (!statementId) {
      return NextResponse.json(
        { error: "Missing statement id" },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { treasuryBoxId, amountUsd, amountLbp } = body;

    if (!treasuryBoxId) {
      return NextResponse.json(
        { error: "Missing treasuryBoxId — select a Cashbox" },
        { status: 400 },
      );
    }

    const safeAmountUsd = parseFloat(String(amountUsd ?? 0)) || 0;
    const safeAmountLbp = parseFloat(String(amountLbp ?? 0)) || 0;

    // Allow $0 payments into a cashbox (e.g., a fully waived/net-zero payout)
    // but never allow a negative amount.
    if (safeAmountUsd < 0 || safeAmountLbp < 0) {
      return NextResponse.json(
        { error: "Amount paid cannot be negative" },
        { status: 400 },
      );
    }

    // ── Execute pay in a transaction ───────────────────────────────────────
    const result = await withConcurrencyRetries(() =>
      prisma.$transaction(async (tx) => {
        // 1. Fetch the statement (error-message read; the atomic guard is the
        //    CAS claim below, which re-evaluates the status under a row lock).
        const statement = await tx.merchantPayout.findUnique({
          where: { id: statementId },
        });

        if (!statement) {
          throw new Error("Statement not found");
        }

        if (
          statement.paymentStatus === "PAID" ||
          statement.paymentStatus === "PENDING_APPROVAL"
        ) {
          throw new AlreadyProcessedError(
            "This statement is already paid or has a payment pending approval and cannot be paid twice.",
          );
        }

        // 2. Fetch the cashbox to determine transaction direction.
        const box = await tx.treasuryBox.findUnique({
          where: { id: treasuryBoxId },
        });

        if (!box) {
          throw new Error("Treasury box not found");
        }

        // 3. CLAIM the statement with a conditional update (compare-and-swap):
        //    only UNPAID / REJECTED statements can be paid. Concurrent pay
        //    requests serialize on the statement row lock; exactly one sees
        //    count === 1. The loser rolls back with nothing persisted, and —
        //    crucially — no treasury transaction was created for it yet.
        const claimed = await tx.merchantPayout.updateMany({
          where: {
            id: statementId,
            paymentStatus: { in: ["UNPAID", "REJECTED"] },
          },
          data: {
            paymentStatus: "PENDING_APPROVAL",
            amountPaidUsd: safeAmountUsd,
            amountPaidLbp: safeAmountLbp,
            treasuryBoxId,
          },
        });

        if (claimed.count !== 1) {
          throw new AlreadyProcessedError(
            "This statement is already paid or has a payment pending approval and cannot be paid twice.",
          );
        }

        // 4. Allocate the reference from the DB sequence (O(1), atomic) —
        //    only the winning claimant ever gets here, so no gap is created by
        //    double-pay attempts.
        const reference = await nextTreasuryReference(tx);

        // 5. Create the PENDING treasury transaction.
        //    - Asset/income box (isPositive): paying the seller is money OUT.
        //    - Liability/expense box (!isPositive): paying the seller reduces the
        //      liability, recorded as IN. Either way, on approval the box balance
        //      is deducted (see approve route).
        const type = box.isPositive ? "OUT" : "IN";
        const transaction = await tx.treasuryTransaction.create({
          data: {
            boxId: treasuryBoxId,
            type,
            amountUsd: safeAmountUsd,
            amountLbp: safeAmountLbp,
            description: `Statement #${statement.sequentialIndex} payment`.trim(),
            reference,
            referenceId: statement.id,
            userId: user.id,
            status: "PENDING_APPROVAL",
          },
        });

        // 6. Link the statement to the transaction. CAS again so a concurrent
        //    rejection (which nulls treasuryTransactionId and returns the
        //    statement to UNPAID) cannot be silently overwritten — if it
        //    happens we roll back, including the transaction we just created.
        const linked = await tx.merchantPayout.updateMany({
          where: {
            id: statementId,
            paymentStatus: "PENDING_APPROVAL",
            treasuryTransactionId: null,
          },
          data: { treasuryTransactionId: transaction.id },
        });

        if (linked.count !== 1) {
          throw new ConcurrencyConflictError("Statement was modified during payment");
        }

        const updatedStatement = await tx.merchantPayout.findUniqueOrThrow({
          where: { id: statementId },
        });

        return {
          statement: updatedStatement,
          transaction,
          type,
        };
      })
    );

    return NextResponse.json(
      {
        success: true,
        message:
          "Statement payment recorded and is now PENDING APPROVAL. The cashbox balance will be updated once approved.",
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
    console.error("POST /api/statements/[id]/pay error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
