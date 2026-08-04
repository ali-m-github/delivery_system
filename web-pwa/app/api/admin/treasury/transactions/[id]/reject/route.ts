import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { requireServerPermission } from "@/lib/server-permissions";

const prisma = new PrismaClient();

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
      // 1. Fetch the transaction and verify it is pending approval.
      const transaction = await tx.treasuryTransaction.findUnique({
        where: { id: txId },
      });

      if (!transaction) {
        throw new Error("Transaction not found");
      }

      if (transaction.status !== "PENDING_APPROVAL") {
        throw new Error(
          "Transaction is not pending approval. Only PENDING_APPROVAL transactions can be rejected.",
        );
      }

      // 2. Mark the transaction as REJECTED. No balance change is applied.
      const updated = await tx.treasuryTransaction.update({
        where: { id: txId },
        data: {
          status: "REJECTED",
          rejectedById: user.id,
          rejectedAt: new Date(),
        },
      });

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
    console.error("POST treasury transaction reject error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
