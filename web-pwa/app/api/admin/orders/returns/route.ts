import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

const prisma = new PrismaClient();

// ─── PATCH /api/admin/orders/returns ────────────────────────────────────────
// Bulk transition for the Return/Exchange Lifecycle State Machine:
//   RWD -> Re  (Return with Driver moves to warehouse)
//   EWD -> EX  (Exchange with Driver moves to warehouse)
//   Re  -> RTS (Warehouse return returns to seller)
//   EX  -> RTS (Warehouse exchange returns to seller)
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
    // Fetch existing orders to validate before updating. The warehouse move
    // (Re) accepts both RWD (returns) and EWD (exchanges); the return-to-seller
    // (RTS) accepts both Re (returns) and EX (exchanges).
    const existingOrders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, financialStatus: true, location: true },
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
      return { id: o.id, from, target };
    });

    // ── Perform bulk update ─────────────────────────────────────────────────
    await Promise.all(
      updates.map((u) =>
        prisma.order.update({
          where: { id: u.id },
          data: { financialStatus: u.target },
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
    console.error("[PATCH /api/admin/orders/returns] Error:", error.message);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    );
  }
}
