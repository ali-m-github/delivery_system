import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { requireAuthenticatedSession } from "@/lib/server-permissions";

/**
 * GET /api/orders/:id/history
 *
 * Returns the COMPLETE order history (oldest → newest) with full actor info:
 *  - user:   the authenticated user who triggered the action (username + role)
 *  - driver: the driver profile involved in the action, when the row recorded
 *            a driverId (name + human-readable driver code)
 *
 *
 * Access control follows the same order visibility model as GET /api/orders:
 *  - DRIVER   → may view history of their own orders only
 *  - MERCHANT → may view history of their own orders only
 *  - ADMIN    → may view any order
 *  - staff    → requires the ORDERS_VIEW permission
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Order history exposes actor identities — visibility is scoped per role
  // (see the doc comment above), but unauthenticated access is not allowed.
  const auth = await requireAuthenticatedSession(request);
  if (auth instanceof Response) return auth;
  try {
    // Next.js 15 requires awaiting params
    const { id } = await params;

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, orderId: true, driverId: true, merchantId: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // ── Order visibility (same model as GET /api/orders) ──────────────────
    const actor = auth.user;
    if (actor.role === "DRIVER") {
      const driverProfile = await prisma.driverProfile.findUnique({
        where: { userId: actor.id },
        select: { id: true },
      });
      if (!driverProfile || order.driverId !== driverProfile.id) {
        return NextResponse.json(
          { error: "Forbidden" },
          { status: 403 },
        );
      }
    } else if (actor.role === "MERCHANT") {
      const merchant = await prisma.merchant.findUnique({
        where: { userId: actor.id },
        select: { id: true },
      });
      if (!merchant || order.merchantId !== merchant.id) {
        return NextResponse.json(
          { error: "Forbidden" },
          { status: 403 },
        );
      }
    } else if (actor.role !== "ADMIN" && !hasPermission(actor, "ORDERS_VIEW")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
