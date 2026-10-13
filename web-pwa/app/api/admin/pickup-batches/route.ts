import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// GET /api/admin/pickup-batches — Pickup batches for the warehouse intake /
// assignment workspace. Supports ?status=PENDING|PICKED_UP|... and returns
// per-order item breakdown so the intake modal can reconcile without a second
// round-trip.
export async function GET(request: Request) {
  try {
    const auth = await requireServerPermission(request, "MANAGE_ORDERS");
    if (auth instanceof Response) return auth;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "";

    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status === "ACTIVE"
        ? { in: ["PENDING", "PICKED_UP"] }
        : status;
    }

    const batches = await prisma.pickupBatch.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        merchant: {
          select: { id: true, merchantId: true, merchantName: true },
        },
        driver: {
          select: { id: true, firstName: true, lastName: true },
        },
        orders: {
          select: {
            id: true,
            orderId: true,
            customerName: true,
            packages: true,
            location: true,
            financialStatus: true,
          },
          orderBy: { orderId: "asc" },
        },
      },
    });

    return NextResponse.json({ batches });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[GET /api/admin/pickup-batches] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
