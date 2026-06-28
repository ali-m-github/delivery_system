import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// PATCH /api/drivers/[id]/payouts/[payoutId] — Approve & settle a payout
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; payoutId: string }> },
) {
  try {
    const resolvedParams = await params;
    const { id: driverId, payoutId } = resolvedParams;

    const body = await request.json();
    const { status } = body;

    if (status !== "CLEARED") {
      return NextResponse.json(
        { error: "Only CLEARED status is supported via this endpoint" },
        { status: 400 },
      );
    }

    // Verify the payout exists and belongs to this driver
    const existing = await prisma.driverPayout.findUnique({
      where: { id: payoutId },
    });

    if (!existing || existing.driverId !== driverId) {
      return NextResponse.json(
        { error: "Payout not found for this driver" },
        { status: 404 },
      );
    }

    if (existing.status === "CLEARED") {
      return NextResponse.json(
        { error: "Payout is already cleared" },
        { status: 409 },
      );
    }

    // Approve the payout and clear the driver's ledger in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update payout status
      const updated = await tx.driverPayout.update({
        where: { id: payoutId },
        data: {
          status: "CLEARED",
          clearedAt: new Date(),
        },
        include: { orders: true },
      });

      // Clear the driver's ledger: mark linked orders as PAID_TO_MERCHANT
      await tx.order.updateMany({
        where: {
          driverPayoutId: payoutId,
          driverId,
        },
        data: {
          financialStatus: "PAID_TO_MERCHANT",
        },
      });

      return updated;
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("PATCH /api/drivers/[id]/payouts/[payoutId] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
