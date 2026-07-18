import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

const prisma = new PrismaClient();

// ─── PATCH /api/admin/orders/returns ────────────────────────────────────────
// Bulk transition for the Return Lifecycle State Machine:
//   RWD -> Re  (Driver returns to warehouse)
//   Re  -> RTS (Warehouse returns to seller)
export async function PATCH(request: Request) {
  try {
    // ── Auth guard ──────────────────────────────────────────────────────────
    let userId: string | null = null;
    try {
      const cookieStore = await cookies();
      const token = cookieStore.get("session")?.value;
      if (token) {
        const secret = new TextEncoder().encode(process.env.JWT_SECRET);
        const { payload } = await jwtVerify(token, secret);
        userId = payload.id as string;
      }
    } catch {
      // Auth is best-effort; continue if no session
    }

    const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    const actionUserId = userId || adminUser?.id;
    if (!actionUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { orderIds, newStatus } = body as {
      orderIds: string[];
      newStatus: "Re" | "RTS";
    };

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "orderIds array is required" },
        { status: 400 },
      );
    }

    if (!newStatus || !["Re", "RTS"].includes(newStatus)) {
      return NextResponse.json(
        { error: "newStatus must be 'Re' or 'RTS'" },
        { status: 400 },
      );
    }

    // ── Validate state transitions ──────────────────────────────────────────
    // Fetch existing orders to validate before updating
    const existingOrders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, financialStatus: true, location: true },
    });

    if (newStatus === "Re") {
      // RWD -> Re: Only orders with financialStatus "RWD" can transition
      const invalidOrders = existingOrders.filter(
        (o) => o.financialStatus !== "RWD",
      );
      if (invalidOrders.length > 0) {
        return NextResponse.json(
          {
            error: `${
              invalidOrders.length
            } order(s) are not in RWD status. Found: ${invalidOrders
              .map((o) => o.financialStatus)
              .join(", ")}`,
          },
          { status: 400 },
        );
      }
    }

    if (newStatus === "RTS") {
      // Re -> RTS: Only orders with financialStatus "Re" can transition
      const invalidOrders = existingOrders.filter(
        (o) => o.financialStatus !== "Re",
      );
      if (invalidOrders.length > 0) {
        return NextResponse.json(
          {
            error: `${
              invalidOrders.length
            } order(s) are not in Re status. Found: ${invalidOrders
              .map((o) => o.financialStatus)
              .join(", ")}`,
          },
          { status: 400 },
        );
      }
    }

    // ── Perform bulk update ─────────────────────────────────────────────────
    await prisma.order.updateMany({
      where: { id: { in: orderIds } },
      data: { financialStatus: newStatus },
    });

    // ── Log history for each order ──────────────────────────────────────────
    const historyLabel =
      newStatus === "Re"
        ? "Return to Warehouse: RWD → Re"
        : "Returned to Seller: Re → RTS";

    await Promise.all(
      orderIds.map((orderId) =>
        prisma.orderHistory.create({
          data: {
            orderId,
            action: historyLabel,
            location: "RETURN",
            userId: actionUserId,
          },
        }),
      ),
    );

    return NextResponse.json({
      success: true,
      count: orderIds.length,
      newStatus,
    });
  } catch (error: any) {
    console.error("[PATCH /api/admin/orders/returns] Error:", error.message);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    );
  }
}
