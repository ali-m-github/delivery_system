import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";
import { withConcurrencyRetries } from "@/lib/concurrency";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

/** Thrown when a row was already processed by another request (CAS claim lost). */
class AlreadyProcessedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlreadyProcessedError";
  }
}

// POST /api/admin/treasury/transactions/[id]/approve — Phase 2 (Approve)
//
// Approves a PENDING_APPROVAL treasury transaction. Once approved:
//   - The transaction's amount is applied to its cashbox balance.
//   - The add/deduct direction depends on the transaction type AND the box type:
//       * Asset/income box (isPositive): IN adds, OUT deducts.
//       * Liability/expense box (!isPositive): IN deducts, OUT adds.
//   - If the transaction pays a statement, the statement is marked PAID.
//
// This approval flow applies to every cash box (all TreasuryTransactions).
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

    const result = await withConcurrencyRetries(() =>
      prisma.$transaction(async (tx) => {
        // 1. Fetch the transaction with its box (single attempt is self-contained:
        //    every row is re-read here on each retry).
        const transaction = await tx.treasuryTransaction.findUnique({
          where: { id: txId },
          include: { box: true },
        });

        if (!transaction) {
          throw new Error("Transaction not found");
        }

        if (transaction.status !== "PENDING_APPROVAL") {
          throw new AlreadyProcessedError(
            "Transaction is not pending approval. Only PENDING_APPROVAL transactions can be approved.",
          );
        }

        // 2. CLAIM the transaction with a conditional update (compare-and-swap):
        //    only a PENDING_APPROVAL row is transitioned. Under concurrent
        //    approvals the row lock serializes the claimants; exactly one sees
        //    count === 1 and proceeds, the others see count === 0. The claim
        //    happens inside this same transaction, so the loser's work never
        //    persists.
        const claimed = await tx.treasuryTransaction.updateMany({
          where: { id: txId, status: "PENDING_APPROVAL" },
          data: {
            status: "APPROVED",
            approvedById: user.id,
            approvedAt: new Date(),
          },
        });

        if (claimed.count !== 1) {
          // Someone else approved (or rejected) it concurrently. Throwing rolls
          // back the whole transaction (the claim included), so nothing
          // persists; the caller maps this to a 409.
          throw new AlreadyProcessedError(
            "Transaction is not pending approval. Only PENDING_APPROVAL transactions can be approved.",
          );
        }

        // 3. Apply the balance change to the box ATOMICALLY via increment, so
        //    concurrent approvals can never overwrite each other's balances.
        const box = transaction.box;
        if (box) {
          // direction: IN = +1, OUT = -1
          const direction = transaction.type === "IN" ? 1 : -1;
          // box sign: asset keeps the direction, liability inverts it
          const boxSign = box.isPositive ? 1 : -1;
          const sign = direction * boxSign;

          await tx.treasuryBox.update({
            where: { id: box.id },
            data: {
              balanceUsd: { increment: sign * transaction.amountUsd },
              balanceLbp: { increment: sign * transaction.amountLbp },
            },
          });
        }

        // 4. If this transaction pays a statement, mark it PAID.
        if (transaction.referenceId) {
          const statement = await tx.merchantPayout.findUnique({
            where: { id: transaction.referenceId },
          });
          if (statement) {
            await tx.merchantPayout.update({
              where: { id: statement.id },
              data: { paymentStatus: "PAID" },
            });
          }
        }

        const updated = await tx.treasuryTransaction.findUniqueOrThrow({
          where: { id: txId },
        });
        return { transaction: updated };
      })
    );

    return NextResponse.json(
      {
        success: true,
        message: "Transaction approved and applied to the cashbox balance.",
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
    console.error("POST treasury transaction approve error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
