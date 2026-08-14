import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

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
    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch the statement and guard against double payment
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
        throw new Error(
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

      // Sequential numeric reference (1, 2, 3, …) shared with the treasury ledger.
      const existing = await tx.treasuryTransaction.findMany({
        select: { reference: true },
      });
      const maxNum = existing.reduce((max, t) => {
        const n = parseInt(String(t.reference ?? ""), 10);
        return Number.isFinite(n) && n > max ? n : max;
      }, 0);
      const reference = String(maxNum + 1);

      // 3. Create the PENDING treasury transaction.
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

      // 4. Link the statement to the transaction and mark it pending approval.
      const updatedStatement = await tx.merchantPayout.update({
        where: { id: statementId },
        data: {
          paymentStatus: "PENDING_APPROVAL",
          amountPaidUsd: safeAmountUsd,
          amountPaidLbp: safeAmountLbp,
          treasuryBoxId,
          treasuryTransactionId: transaction.id,
        },
      });

      return {
        statement: updatedStatement,
        transaction,
        type,
      };
    });

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
    console.error("POST /api/statements/[id]/pay error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
