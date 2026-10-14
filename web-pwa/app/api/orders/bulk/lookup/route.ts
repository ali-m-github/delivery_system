import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
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

    // ── Authorization scope (same model as GET /api/orders) ────────────────
    // The lookup returns order records, so it must honor the same
    // role/ownership/permission visibility: drivers only see their own
    // orders, merchants only their own, staff need ORDERS_VIEW.
    const actor = auth.user;
    let authScope: Record<string, unknown>;
    if (actor.role === "DRIVER") {
      const driverProfile = await prisma.driverProfile.findUnique({
        where: { userId: actor.id },
        select: { id: true },
      });
      if (!driverProfile) {
        return NextResponse.json(
          { error: "Driver account has no driver profile" },
          { status: 403 },
        );
      }
      // Drivers may look up (a) their own orders, and (b) ONLY unassigned
      // WAREHOUSE orders that are legitimately available for THEM to pick
      // up — the exact same pickup rule the driver app applies
      // (app/driver/page.tsx → warehouseOrders): location WAREHOUSE,
      // driverId null, and the order's zone is one of the driver's
      // assignedZones (DriverZoneAssignment). Anything else — another
      // driver's orders, warehouse orders outside their assigned zones, or
      // orders already assigned to a driver — is never returned, so this
      // endpoint cannot be used to enumerate arbitrary warehouse orders.
      // A driver with no assigned zones gets only their own orders
      // (empty `in: []` matches nothing, mirroring the page's behavior).
      const zoneAssignments = await prisma.driverZoneAssignment.findMany({
        where: { driverId: driverProfile.id },
        select: { zoneId: true },
      });
      const assignedZoneIds = zoneAssignments.map((az) => az.zoneId);
      authScope = {
        OR: [
          { driverId: driverProfile.id },
          {
            location: "WAREHOUSE",
            driverId: null,
            zoneId: { in: assignedZoneIds },
          },
        ],
      };
    } else if (actor.role === "MERCHANT") {
      const merchant = await prisma.merchant.findUnique({
        where: { userId: actor.id },
        select: { id: true },
      });
      if (!merchant) {
        return NextResponse.json(
          { error: "Merchant account has no merchant record" },
          { status: 403 },
        );
      }
      authScope = { merchantId: merchant.id };
    } else if (actor.role === "ADMIN") {
      authScope = {};
    } else {
      if (!hasPermission(actor, "ORDERS_VIEW")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      authScope = {};
    }

    // Find orders where orderId matches any of the provided IDs
    // We search by the human-readable orderId field (not the DB UUID)
    const foundOrders = await prisma.order.findMany({
      where: {
        orderId: { in: normalizedIds },
        ...authScope,
      },
      select: {
        id: true,
        orderId: true,
        financialStatus: true,
        location: true,
        driverId: true,
        // Recipient + merchant columns for the Universal Staff Scanner tray
        customerName: true,
        merchant: {
          select: {
            id: true,
            merchantName: true,
            merchantId: true,
          },
        },
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
