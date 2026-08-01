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

    const resolvedParams = await params;
    const { id: payoutId } = resolvedParams;

    if (!payoutId) {
      return NextResponse.json({ error: "Missing payoutId" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch the payout and verify it is awaiting approval
      const payout = await tx.driverPayout.findUnique({
        where: { id: payoutId },
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

      return {
        payout: updatedPayout,
        ordersUpdated: ordersUpdated.count,
      };
    });

    return NextResponse.json(
      {
        success: true,
        message: `Payout approved and settled. ${result.ordersUpdated} order(s) marked as With Office (WO).`,
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
