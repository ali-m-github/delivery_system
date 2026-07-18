import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ============================================================
// PATCH /api/admin/merchants/[id]/cash-payouts/exclude
// Toggle cashPayoutExcluded flag on an order.
// Body: { orderId: string, excluded: boolean }
// ============================================================
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await params;
    const merchantId = resolvedParams.id;

    const body = await request.json();
    const { orderId, excluded } = body;

    if (!orderId || typeof excluded !== "boolean") {
      return NextResponse.json(
        { error: "Missing orderId or excluded flag" },
        { status: 400 },
      );
    }

    // Verify the order belongs to this merchant
    const order = await prisma.order.findFirst({
      where: { orderId, merchantId },
    });

    if (!order) {
      return NextResponse.json(
        { error: "Order not found for this merchant" },
        { status: 404 },
      );
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { cashPayoutExcluded: excluded },
      select: { id: true, orderId: true, cashPayoutExcluded: true },
    });

    return NextResponse.json(updated, { status: 200 });
  } catch (error: any) {
    console.error("CashPayouts Exclude PATCH Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    );
  }
}
