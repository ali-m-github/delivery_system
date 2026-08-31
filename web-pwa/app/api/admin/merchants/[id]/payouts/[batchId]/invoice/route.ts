import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; batchId: string }> },
) {
  const auth = await requireServerPermission(request, "MANAGE_FINANCE");
  if (auth instanceof Response) return auth;
  try {
    const { id: merchantId, batchId } = await context.params;
    const batchIdInt = parseInt(batchId, 10);

    if (isNaN(batchIdInt)) {
      return NextResponse.json({ error: "Invalid batch ID" }, { status: 400 });
    }

    const batch = await prisma.cashPayoutBatch.findUnique({
      where: { id: batchIdInt },
      include: {
        merchant: {
          select: {
            id: true,
            merchantName: true,
            merchantId: true,
            sellerNumber: true,
            phone: true,
            address: true,
          },
        },
        orders: {
          include: {
            zone: { select: { name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        resolvedReturns: {
          include: {
            zone: { select: { name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        adjustments: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // ── Build per-order line items (advance orders) ──
    const orderLines = batch.orders.map((o) => {
      const collectedUsd = o.collectedUsd ?? 0;
      const shippingUsd = o.amountUsd ?? 0;
      const netToSeller = collectedUsd - shippingUsd;

      return {
        id: o.id,
        orderId: o.orderId,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        customerAddress: o.customerAddress,
        zoneName: o.zone?.name ?? "—",
        createdAt: o.createdAt.toISOString(),
        collectedUsd,
        collectedLbp: o.collectedLbp ?? 0,
        shippingUsd,
        netToSeller,
        type: "advance" as const,
      };
    });

    // ── Return lines (deductions) ──
    const returnLines = batch.resolvedReturns.map((r) => {
      const collectedUsd = r.collectedUsd ?? 0;
      const shippingUsd = r.amountUsd ?? 0;

      return {
        id: r.id,
        orderId: r.orderId,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        customerAddress: r.customerAddress,
        zoneName: r.zone?.name ?? "—",
        createdAt: r.createdAt.toISOString(),
        collectedUsd,
        collectedLbp: r.collectedLbp ?? 0,
        shippingUsd,
        netToSeller: 0, // Returns are deducted, not paid
        type: "return" as const,
      };
    });

    // ── Computed totals ──
    const totalCollectedUsd = orderLines.reduce(
      (sum, o) => sum + o.collectedUsd,
      0,
    );
    const totalShippingUsd = orderLines.reduce(
      (sum, o) => sum + o.shippingUsd,
      0,
    );
    const totalNetToSeller = orderLines.reduce(
      (sum, o) => sum + o.netToSeller,
      0,
    );
    const totalReturnsDeduction = returnLines.reduce(
      (sum, r) => sum + (r.collectedUsd - r.shippingUsd),
      0,
    );
    const totalAdjustmentsUsd = batch.adjustments.reduce(
      (sum, a) => sum + (a.amountUsd ?? 0),
      0,
    );

    return NextResponse.json(
      {
        batchReference: batch.batchReference,
        createdAt: batch.createdAt.toISOString(),
        merchant: batch.merchant,
        orderLines,
        returnLines,
        adjustments: batch.adjustments.map((a) => ({
          id: a.id,
          description: a.description,
          amountUsd: a.amountUsd,
          amountLbp: a.amountLbp,
          createdAt: a.createdAt.toISOString(),
        })),
        totals: {
          totalOrders: orderLines.length,
          totalReturns: returnLines.length,
          totalCollectedUsd,
          totalShippingUsd,
          grossAdvance: totalNetToSeller, // collected - shipping
          deductedReturns: totalReturnsDeduction,
          adjustmentsTotal: totalAdjustmentsUsd,
          netPaid:
            totalNetToSeller - totalReturnsDeduction + totalAdjustmentsUsd,
          profit: batch.profit,
        },
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error(
      "GET /api/admin/merchants/[id]/payouts/[batchId]/invoice Error:",
      error,
    );
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
