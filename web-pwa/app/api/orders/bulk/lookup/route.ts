import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuthenticatedSession } from "@/lib/server-permissions";

// ─── POST /api/orders/bulk/lookup ─────────────────────────────────────────────
// Accepts an array of orderId values (the human-readable orderId field, not DB UUID)
// and returns full order records for those that exist in the database.
// This is used by Quick Assign to find orders that may not be in the local cache.
export async function POST(request: NextRequest) {
  // Full order records are returned to the caller — authenticated users only.
  const auth = await requireAuthenticatedSession(request);
  if (auth instanceof Response) return auth;
  try {
    const body = await request.json();
    const { orderIds } = body as { orderIds?: string[] };

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "orderIds array is required and must not be empty" },
        { status: 400 },
      );
    }

    // Strip # prefix and trim each ID for consistent matching
    const normalizedIds = orderIds.map((id: string) =>
      id.trim().replace(/^#/, ""),
    );

    // Find orders where orderId matches any of the provided IDs
    // We search by the human-readable orderId field (not the DB UUID)
    const foundOrders = await prisma.order.findMany({
      where: {
        orderId: { in: normalizedIds },
      },
      select: {
        id: true,
        orderId: true,
        financialStatus: true,
        location: true,
        driverId: true,
        driver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            driverId: true,
          },
        },
      },
    });

    // Build a set of found orderIds for quick lookup
    const foundOrderIdSet = new Set(foundOrders.map((o) => o.orderId));

    // Separate results into found and notFound
    const notFound = normalizedIds.filter((id) => !foundOrderIdSet.has(id));

    return NextResponse.json(
      {
        found: foundOrders,
        notFound,
        stats: {
          total: normalizedIds.length,
          matched: foundOrders.length,
          unmatched: notFound.length,
        },
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("[POST /api/orders/bulk/lookup] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
