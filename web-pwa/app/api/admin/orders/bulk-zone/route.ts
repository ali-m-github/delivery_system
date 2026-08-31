import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

export async function PATCH(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_ORDERS");
  if (auth instanceof Response) return auth;
  try {
    const { orderIds, targetZoneId } = await request.json();

    if (!Array.isArray(orderIds) || orderIds.length === 0 || !targetZoneId) {
      return NextResponse.json(
        { error: "Invalid order IDs or target zone." },
        { status: 400 },
      );
    }

    const updated = await prisma.order.updateMany({
      where: { id: { in: orderIds.map((id: string) => String(id)) } },
      data: { zoneId: String(targetZoneId) },
    });

    return NextResponse.json(
      { success: true, count: updated.count },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("[PATCH /api/admin/orders/bulk-zone] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
