import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";
import { orderIdForFinancialStatus } from "@/lib/order-id";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

// ─── PATCH /api/admin/orders/returns ────────────────────────────────────────
// Bulk transition for the Return/Exchange Lifecycle State Machine:
//   RWD -> Re  (Return with Driver moves to warehouse)
//   EWD -> EX  (Exchange with Driver moves to warehouse)
//   Re  -> RTS (Warehouse return returns to seller)
//   EX  -> RTS (Warehouse exchange returns to seller)
export async function PATCH(request: Request) {
  // ── Auth guard ──────────────────────────────────────────────────────────
  // Moving delivered orders (RWD/EWD/Re/EX) through the return lifecycle is a
  // financial action — same permission as the sibling /api/admin/orders/return.
  // A valid session is mandatory; unauthenticated requests can no longer fall
  // back to acting as an admin.
  const auth = await requireServerPermission(request, "ACTION_ORDER_RETURN");
  if (auth instanceof Response) return auth;
  const actionUserId = auth.user.id;
  try {
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
    // Fetch existing orders to validate before updating. The warehouse move
    // (Re) accepts both RWD (returns) and EWD (exchanges); the return-to-seller
    // (RTS) accepts both Re (returns) and EX (exchanges).
    const existingOrders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        orderId: true,
        financialStatus: true,
        location: true,
      },
    });

    const allowedSources = newStatus === "Re" ? ["RWD", "EWD"] : ["Re", "EX"];

    const invalidOrders = existingOrders.filter(
      (o) => !allowedSources.includes(o.financialStatus),
    );
    if (invalidOrders.length > 0) {
      return NextResponse.json(
        {
          error: `${
            invalidOrders.length
          } order(s) are not eligible for transition to "${newStatus}". Found: ${invalidOrders
            .map((o) => o.financialStatus)
            .join(", ")}`,
        },
        { status: 400 },
      );
    }

    // ── Derive per-order target status ──────────────────────────────────────
    // RWD -> Re, EWD -> EX on warehouse move; Re/EX -> RTS on return-to-seller
    const updates = existingOrders.map((o) => {
      const from = o.financialStatus;
      const target =
        newStatus === "Re" ? (from === "EWD" ? "EX" : "Re") : "RTS";
      return { id: o.id, orderId: o.orderId, from, target };
    });

    // ── Perform bulk update ─────────────────────────────────────────────────
    await Promise.all(
      updates.map((u) =>
        prisma.order.update({
          where: { id: u.id },
          data: {
            orderId: orderIdForFinancialStatus(u.orderId, u.target),
            financialStatus: u.target,
          },
        }),
      ),
    );

    // ── Log history for each order ──────────────────────────────────────────
    await Promise.all(
      updates.map((u) =>
        prisma.orderHistory.create({
          data: {
            orderId: u.id,
            action:
              newStatus === "Re"
                ? u.target === "EX"
                  ? "Exchange to Warehouse: EWD → EX"
                  : "Return to Warehouse: RWD → Re"
                : u.from === "EX"
                  ? "Exchange to Seller: EX → RTS"
                  : "Returned to Seller: Re → RTS",
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
    console.error("[PATCH /api/admin/orders/returns] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
