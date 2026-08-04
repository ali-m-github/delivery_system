import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { requireServerPermission } from "@/lib/server-permissions";

const prisma = new PrismaClient();

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

    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch the transaction with its box and verify it is pending approval.
      const transaction = await tx.treasuryTransaction.findUnique({
        where: { id: txId },
        include: { box: true },
      });

      if (!transaction) {
        throw new Error("Transaction not found");
      }

      if (transaction.status !== "PENDING_APPROVAL") {
        throw new Error(
          "Transaction is not pending approval. Only PENDING_APPROVAL transactions can be approved.",
        );
      }

      // 2. Mark the transaction as APPROVED.
      const updated = await tx.treasuryTransaction.update({
        where: { id: txId },
        data: {
          status: "APPROVED",
          approvedById: user.id,
          approvedAt: new Date(),
        },
      });

      // 3. Apply the balance change to the box.
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
            balanceUsd: box.balanceUsd + sign * transaction.amountUsd,
            balanceLbp: box.balanceLbp + sign * transaction.amountLbp,
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

      return { transaction: updated };
    });

    return NextResponse.json(
      {
        success: true,
        message: "Transaction approved and applied to the cashbox balance.",
        ...result,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("POST treasury transaction approve error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
