import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * GET /api/orders/:id/history
 *
 * Returns the COMPLETE order history (oldest → newest) with full actor info:
 *  - user:   the authenticated user who triggered the action (username + role)
 *  - driver: the driver profile involved in the action, when the row recorded
 *            a driverId (name + human-readable driver code)
 *
 * NOTE: access control / per-role visibility for history rows is intentionally
 * not applied here yet — it will be refined separately.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Next.js 15 requires awaiting params
    const { id } = await params;

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, orderId: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const history = await prisma.orderHistory.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { id: true, username: true, role: true } },
      },
    });

    // Resolve driver names for entries that recorded a driverId
    const driverIds = [
      ...new Set(history.map((h) => h.driverId).filter(Boolean)),
    ] as string[];
    const drivers =
      driverIds.length > 0
        ? await prisma.driverProfile.findMany({
            where: { id: { in: driverIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              driverId: true,
            },
          })
        : [];
    const driverMap = new Map(drivers.map((d) => [d.id, d]));

    return NextResponse.json({
      orderId: order.id,
      orderReference: order.orderId,
      count: history.length,
      history: history.map((h) => ({
        id: h.id,
        action: h.action,
        location: h.location,
        driverId: h.driverId,
        driver: h.driverId ? (driverMap.get(h.driverId) ?? null) : null,
        user: h.user,
        createdAt: h.createdAt,
      })),
    });
  } catch (error: any) {
    console.error("[GET /api/orders/:id/history] Error:", error.message);
    return NextResponse.json(
      { error: "Failed to load order history" },
      { status: 500 },
    );
  }
}
