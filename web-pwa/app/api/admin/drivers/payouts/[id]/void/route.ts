import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

// DELETE /api/admin/drivers/payouts/[id]/void — Void a PENDING driver payout batch
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "DRIVERS_PAYOUT");
  if (auth instanceof Response) return auth;
  try {
    const resolvedParams = await params;
    const { id: payoutId } = resolvedParams;

    if (!payoutId) {
      return NextResponse.json({ error: "Missing payoutId" }, { status: 400 });
    }

    // 1. Find the payout and verify it is PENDING
    const payout = await prisma.driverPayout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      return NextResponse.json({ error: "Payout not found" }, { status: 404 });
    }

    if (payout.status !== "PENDING") {
      return NextResponse.json(
        {
          error:
            "Cannot void a payout that is not PENDING. Only unsettled batches can be voided.",
        },
        { status: 409 },
      );
    }

    // Execute void in a transaction
    await prisma.$transaction(async (tx) => {
      // 2. Unlink all orders and reset their financial status to UD
      await tx.order.updateMany({
        where: { driverPayoutId: payoutId },
        data: {
          driverPayoutId: null,
          financialStatus: "UD",
        },
      });

      // 3. Delete the payout record entirely
      await tx.driverPayout.delete({
        where: { id: payoutId },
      });
    });

    return NextResponse.json(
      {
        success: true,
        message:
          "Payout voided successfully. Orders returned to Delivered tab.",
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("DELETE /api/admin/drivers/payouts/[id]/void error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
