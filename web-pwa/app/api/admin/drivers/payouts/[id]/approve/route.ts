import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { requireServerPermission } from "@/lib/server-permissions";

const prisma = new PrismaClient();

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

    const result = await prisma.$transaction(async (tx) => {
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
        throw new Error(
          "Payout is not awaiting approval. Only PENDING_APPROVAL payouts can be approved.",
        );
      }

      // 2. Mark the payout as SETTLED
      const updatedPayout = await tx.driverPayout.update({
        where: { id: payoutId },
        data: {
          status: "SETTLED",
          clearedAt: new Date(),
        },
      });

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
      let statementTransactionIds: string[] = [];

      // Sequential numeric reference: next number after the highest existing
      // one (1, 2, 3, …). Resistant to deletions leaving gaps.
      const existing = await tx.treasuryTransaction.findMany({
        select: { reference: true },
      });
      const maxNum = existing.reduce((max, t) => {
        const n = parseInt(String(t.reference ?? ""), 10);
        return Number.isFinite(n) && n > max ? n : max;
      }, 0);
      let nextReference = maxNum + 1;

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
            reference: String(nextReference),
            referenceId: payout.id,
            userId: user.id,
          },
        });
        nextReference += 1;
        transactionId = created.id;

        const box = await tx.treasuryBox.findUnique({
          where: { id: payout.treasuryBoxId },
        });
        if (box) {
          await tx.treasuryBox.update({
            where: { id: payout.treasuryBoxId },
            data: {
              balanceUsd: box.balanceUsd + fullPayoutUsd,
              balanceLbp: box.balanceLbp + fullPayoutLbp,
            },
          });
        }
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
            reference: String(nextReference),
            referenceId: stmt.id,
            userId: user.id,
          },
        });
        nextReference += 1;
        statementTransactionIds.push(created.id);

        const stmtBox = await tx.treasuryBox.findUnique({
          where: { id: stmt.treasuryBoxId },
        });
        if (stmtBox) {
          await tx.treasuryBox.update({
            where: { id: stmt.treasuryBoxId },
            data: {
              balanceUsd: stmtBox.balanceUsd + (stmt.netUsd ?? 0),
              balanceLbp: stmtBox.balanceLbp + (stmt.netLbp ?? 0),
            },
          });
        }

        // Mark the statement PAID and link the transaction that paid it.
        await tx.merchantPayout.update({
          where: { id: stmt.id },
          data: {
            paymentStatus: "PAID",
            treasuryTransactionId: created.id,
          },
        });
      }

      return {
        payout: updatedPayout,
        ordersUpdated: ordersUpdated.count,
        transactionId,
        statementTransactionIds,
      };
    });

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
    console.error("POST /api/admin/drivers/payouts/[id]/approve error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
