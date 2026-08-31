import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";
import { createZoneMatchContext, matchZoneInContext } from "@/lib/zoneMatcher";

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
  const auth = await requireServerPermission(request, "MANAGE_ORDERS");
  if (auth instanceof Response) return auth;
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
    // A valid session is mandatory (see guard above); unauthenticated
    // requests can no longer fall back to acting as an admin.
    const actionUserId = auth.user.id;

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

    // ── Load the zone matching data ONCE for the whole batch ──────────────
    // (historically 3 queries per address; matching semantics unchanged)
    const zoneCtx = await createZoneMatchContext();

    for (const order of orders) {
      try {
        // ── Resolve zone from the cities database (fallback zone "99") ──
        // Pure in-memory match against the batch's pre-loaded context.
        const zoneId = matchZoneInContext(zoneCtx, order.customerAddress);

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
                userId: actionUserId,
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
