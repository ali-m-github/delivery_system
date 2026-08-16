import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { resolveZoneForAddress } from "@/lib/zoneMatcher";

// ─── POST /api/admin/orders/move-from-cp ──────────────────────────────────────
// Moves one or more orders from the "CP" (customer pickup) warehouse into the
// main warehouse. While moving, each order is matched against the internal
// cities database (ZoneMapping) so it lands in its correct zone; addresses that
// cannot be matched are routed to the fallback zone "99".
//
// Request body: { orderIds: string[] }
//
// Returns: { movedCount, skippedCount, results: [{ id, orderId, zoneId, zone, status }] }

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orderIds = (body?.orderIds ?? []) as string[];

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "orderIds array is required" },
        { status: 400 },
      );
    }

    // ── Resolve the acting user for history entries ─────────────────────
    let actionUserId: string | null = null;
    try {
      const cookieStore = await cookies();
      const token = cookieStore.get("session")?.value;
      if (token) {
        const secret = new TextEncoder().encode(process.env.JWT_SECRET);
        const { payload } = await jwtVerify(token, secret);
        actionUserId = (payload.id as string) || null;
      }
    } catch {
      // fall through
    }
    if (!actionUserId) {
      const admin = await prisma.user.findFirst({
        where: { role: "ADMIN" },
        select: { id: true },
      });
      actionUserId = admin?.id ?? null;
    }

    // ── Load the target CP orders ────────────────────────────────────────
    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds.map(String) },
        location: "CP",
      },
      select: { id: true, orderId: true, customerAddress: true, zoneId: true },
    });

    const results: {
      id: string;
      orderId: string;
      zoneId: string;
      zone: string | null;
      status: "moved" | "skipped" | "failed";
      error?: string;
    }[] = [];

    let movedCount = 0;

    for (const order of orders) {
      try {
        // ── Resolve zone from the cities database (fallback zone "99") ──
        const zoneId = await resolveZoneForAddress(order.customerAddress);

        const updated = await prisma.order.update({
          where: { id: order.id },
          data: {
            location: "WAREHOUSE",
            financialStatus: "UD",
            zoneId,
            driverId: null,
            isArchived: false,
            collectedUsd: 0,
            collectedLbp: 0,
            history: {
              create: {
                action: "Moved from CP to Warehouse",
                location: "WAREHOUSE",
                userId: actionUserId ?? "",
              },
            },
          },
          include: { zone: { select: { id: true, name: true } } },
        });

        movedCount++;
        results.push({
          id: order.id,
          orderId: order.orderId,
          zoneId: updated.zoneId,
          zone: updated.zone?.name ?? null,
          status: "moved",
        });
      } catch (error: unknown) {
        results.push({
          id: order.id,
          orderId: order.orderId,
          zoneId: order.zoneId,
          zone: null,
          status: "failed",
          error:
            error instanceof Error ? error.message : "Failed to move order",
        });
      }
    }

    // Orders that were not found at CP (already moved / different location)
    const foundIds = new Set(orders.map((o) => o.id));
    const skipped = orderIds.filter((id) => !foundIds.has(String(id)));

    return NextResponse.json(
      {
        success: true,
        movedCount,
        skippedCount: skipped.length,
        totalRequested: orderIds.length,
        results,
        skipped,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to move orders from CP";
    console.error("[POST /api/admin/orders/move-from-cp] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
