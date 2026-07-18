import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function PATCH(request: Request) {
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
