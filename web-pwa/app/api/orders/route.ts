import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { notifyCustomerStatusChange } from "@/lib/notifications";
import { generateTrackToken } from "@/lib/tracking";
import { createExchangeOrderFromDelivered } from "@/lib/exchange";
import { orderIdForFinancialStatus } from "@/lib/order-id";
import {
  loadDriverRateTable,
  recalcPayoutTotals,
} from "@/lib/commission";
import {
  requireAuthenticatedSession,
  requireServerPermission,
} from "@/lib/server-permissions";

// ─── GET /api/orders ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedSession(request);
  if (auth instanceof Response) return auth;

  // Request-derived pagination + filters are computed outside the try so the
  // error fallback below can reuse them and keep the response shape stable.
  const { searchParams } = new URL(request.url);

  // Pagination defaults
  const skip = Math.max(0, parseInt(searchParams.get("skip") || "0", 10));
  const take = Math.min(
    5000,
    Math.max(1, parseInt(searchParams.get("take") || "500", 10)),
  );

  // Optional server-side filters
  const location = searchParams.get("location");
  const search = searchParams.get("search");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const zoneId = searchParams.get("zoneId");
  const financialStatus = searchParams.get("financialStatus");
  const isArchived = searchParams.get("isArchived");

  // Build where clause from filters
  const where: Record<string, unknown> = {};
  if (location) where.location = location;
  // Archive filter: only include the currently-viewed set (active vs archived)
  if (isArchived === "true" || isArchived === "false") {
    where.isArchived = isArchived === "true";
  }
  if (financialStatus) {
    // Support comma-separated statuses (e.g. "RWD,EWD") for combined views
    const statuses = financialStatus
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length === 1) {
      where.financialStatus = statuses[0];
    } else if (statuses.length > 1) {
      where.financialStatus = { in: statuses };
    }
  }
  if (zoneId) where.zoneId = zoneId;
  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) createdAt.gte = new Date(dateFrom);
    if (dateTo) createdAt.lte = new Date(dateTo);
    where.createdAt = createdAt;
  }
  if (search) {
    where.OR = [
      { orderId: { contains: search, mode: "insensitive" } },
      { customerName: { contains: search, mode: "insensitive" } },
      { customerPhone: { contains: search, mode: "insensitive" } },
    ];
  }

  try {
    // Tab badges need totals from the database, not only the current page of
    // orders returned below. Keep the archive scope consistent with the view.
    const summaryWhere: Record<string, unknown> = {};
    if (isArchived === "true" || isArchived === "false") {
      summaryWhere.isArchived = isArchived === "true";
    }

    // Run counts + data in parallel
    const [total, rwdTotal, cpTotal, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.count({
        where: {
          ...summaryWhere,
          location: "RETURN",
          financialStatus: { in: ["RWD", "EWD"] },
        },
      }),
      prisma.order.count({ where: { ...summaryWhere, location: "CP" } }),
      prisma.order.findMany({
        where,
        skip,
        take,
        select: {
          id: true,
          orderId: true,
          customerName: true,
          customerPhone: true,
          customerAddress: true,
          zoneId: true,
          hasExchange: true,
          location: true,
          financialStatus: true,
          amountUsd: true,
          amountLbp: true,
          collectedUsd: true,
          collectedLbp: true,
          notes: true,
          merchantId: true,
          driverId: true,
          waybillUrl: true,
          trackToken: true,
          isArchived: true,
          packages: true,
          extraShipping: true,
          createdAt: true,
          updatedAt: true,
          dispatchedAt: true,
          deliveredAt: true,
          zone: {
            select: { id: true, name: true },
          },
          driver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              driverId: true,
              userId: true,
            },
          },
          merchant: {
            select: {
              id: true,
              merchantName: true,
              phone: true,
              contactName: true,
              logoUrl: true,
            },
          },
          creator: {
            select: { id: true, username: true },
          },
          history: {
            select: {
              id: true,
              action: true,
              location: true,
              driverId: true,
              user: { select: { id: true, username: true, role: true } },
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          },
          driverPayout: {
            select: {
              payoutReference: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return NextResponse.json(
      {
        data: orders,
        meta: {
          total,
          rwdTotal,
          cpTotal,
          skip,
          take,
          hasMore: skip + take < total,
        },
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("[GET /api/orders] Query failed:", error.message);

    // Fallback: if the full query failed (e.g. a relation field name changed
    // in schema.prisma), serve the same response contract — { data, meta } —
    // with a flat order list (relations omitted), so clients can still render
    // and paginate. Do NOT change the shape to a bare array.
    try {
      const basicOrders = await prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          orderId: true,
          customerName: true,
          customerPhone: true,
          customerAddress: true,
          zoneId: true,
          hasExchange: true,
          location: true,
          financialStatus: true,
          amountUsd: true,
          amountLbp: true,
          collectedUsd: true,
          collectedLbp: true,
          notes: true,
          merchantId: true,
          driverId: true,
          waybillUrl: true,
          trackToken: true,
          isArchived: true,
          packages: true,
          extraShipping: true,
          createdAt: true,
          updatedAt: true,
          dispatchedAt: true,
          deliveredAt: true,
        },
      });
      const basicTotal = await prisma.order.count({ where });
      return NextResponse.json(
        {
          data: basicOrders,
          meta: {
            total: basicTotal,
            rwdTotal: 0,
            cpTotal: 0,
            skip,
            take,
            hasMore: skip + basicOrders.length < basicTotal,
            degraded: true,
          },
        },
        { status: 200 },
      );
    } catch (fallbackError: any) {
      console.error(
        "[GET /api/orders] Fallback query failed:",
        fallbackError.message,
      );
      return NextResponse.json(
        { error: "Internal Server Error", details: fallbackError.message },
        { status: 500 },
      );
    }
  }
}

// ─── POST /api/orders ─────────────────────────────────────────────────────────
export async function POST(request: Request) {
  const auth = await requireServerPermission(request, "ORDERS_CREATE");
  if (auth instanceof Response) return auth;
  try {
    const body = await request.json();
    const finalZoneId = body.zoneId || body.selectedZoneId;
    const finalPrice = body.price || body.amountUsd;

    // Generate a collision-proof tracking ID like: "ORD-1720042958-8F3A"
    const uniqueOrderId =
      body.orderId ||
      body.newOrderId ||
      `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const customerName = body.customerName?.trim() || "Unknown";
    if (!finalZoneId)
      return NextResponse.json(
        { error: "Missing Zone Selection" },
        { status: 400 },
      );

    // Attribute the order to the authenticated creator (server-side).
    const creatorId = auth.user.id;

    const parsedPrice = parseFloat(finalPrice);
    const amountUsd = isNaN(parsedPrice) ? 0 : parsedPrice;

    const parsedExtraShipping = parseFloat(body.extraShipping);
    const extraShipping = isNaN(parsedExtraShipping) ? 0 : parsedExtraShipping;

    const parsedPackages = parseInt(body.packages);
    const packages = isNaN(parsedPackages) ? 1 : parsedPackages;

    // Parse optional dateReceived for backdating imported orders
    let createdAt: Date | undefined;
    if (body.dateReceived && typeof body.dateReceived === "string") {
      const parsed = new Date(body.dateReceived + "T00:00:00Z");
      if (!isNaN(parsed.getTime())) {
        createdAt = parsed;
      }
    }

    const newOrder = await prisma.order.create({
      data: {
        orderId: uniqueOrderId,
        trackToken: await generateTrackToken(),
        customerName,
        customerPhone: body.customerPhone || "N/A",
        customerAddress: body.customerAddress || "N/A",
        packages: packages,
        zoneId: finalZoneId,
        hasExchange: body.hasExchange === true || body.hasExchange === "true",
        amountUsd: amountUsd,
        extraShipping: extraShipping,
        creatorId,
        notes: body.notes || null,
        merchantId: body.merchantId || null,
        driverId: body.driverId || null,
        ...(createdAt && { createdAt }),
        history: {
          create: {
            action: "Order Created",
            location: "WAREHOUSE",
            userId: creatorId,
          },
        },
      },
    });
    return NextResponse.json(newOrder, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/orders] Error:", error);

    // P2002 is Prisma's official error code for Unique Constraint violations
    if (error.code === "P2002") {
      const targetField = error.meta?.target?.[0] || "field";
      return NextResponse.json(
        {
          error: `An order with this exact ${targetField} already exists.`,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// ─── PATCH /api/orders ────────────────────────────────────────────────────────
//
// Security model:
// - The request must be authenticated. The actor (user id + role) is taken
//   exclusively from the database user behind the verified session. No field
//   in the body is authoritative for who is acting (`currentUserActionId` and
//   `status` are accepted for compatibility but never trusted).
// - Only the whitelisted fields below are written. Everything else in the body
//   is ignored — payout/identity fields (driverPayoutId, merchantPayoutId,
//   cashPayoutBatchId, returnDeductionBatchId, creatorId, trackToken, ...) are
//   owned by the payout/returns admin workflows and can never be set here.
// - `financialStatus` and `orderId` are derived server-side from the resulting
//   location. Client-sent values are ignored. `orderIdForFinancialStatus` is
//   kept because the admin returns / cash-payout workflows rely on the RTS "R"
//   suffix. The response returns the full updated order, including the result.
// - WO (cleared payout) orders and orders tied to an open driver payout can
//   only be modified here by an ADMIN — otherwise a crafted field could
//   silently unlink the order from a pending payout or fabricate a status.
// - DRIVERS may only touch their own orders (or unassigned orders being
//   assigned to themselves). MERCHANTS may only touch their own orders.

const STAFF_UPDATABLE_FIELDS = new Set<string>([
  "customerName",
  "customerPhone",
  "customerAddress",
  "notes",
  "packages",
  "extraShipping",
  "amountUsd",
  "amountLbp",
  "collectedUsd",
  "collectedLbp",
  "location",
  "driverId",
  "merchantId",
  "zoneId",
  "hasExchange",
  "isArchived",
  "deliveredAt",
  "dispatchedAt",
]);

const DRIVER_UPDATABLE_FIELDS = new Set<string>([
  "location",
  "driverId",
  "collectedUsd",
  "collectedLbp",
  "notes",
]);

const DRIVER_ALLOWED_LOCATIONS = new Set<string>([
  "DELIVERED",
  "RETURN",
  "WITH_DRIVER",
  "ASSIGNED",
]);

const MERCHANT_UPDATABLE_FIELDS = new Set<string>([
  "customerName",
  "customerPhone",
  "customerAddress",
  "notes",
  "packages",
  "amountUsd",
  "amountLbp",
]);

function parseFiniteNumber(value: unknown): number | null {
  let num: number;
  if (typeof value === "number") {
    num = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    num = parseFloat(value);
  } else {
    return null;
  }
  return Number.isFinite(num) ? num : null;
}

export async function PATCH(request: Request) {
  const auth = await requireAuthenticatedSession(request);
  if (auth instanceof Response) return auth;
  try {
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return NextResponse.json(
          { error: "Request body must be a JSON object" },
          { status: 400 },
        );
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const { id, price, driverActionLog } = body;
    // NOTE: `status` and `currentUserActionId` may arrive in the body for
    // legacy/compat reasons; they are intentionally never read or written.

    if (!id || typeof id !== "string")
      return NextResponse.json(
        { error: "Order id is required" },
        { status: 400 },
      );

    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing)
      return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const actor = auth.user; // DB-verified user: { id, role, ... }
    const actorIsAdmin = actor.role === "ADMIN";

    // ── Role scoping: which orders this actor may touch, with which fields ─
    let allowedFields: Set<string>;
    let actionDriverId: string | null = null;

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
      actionDriverId = driverProfile.id;
      const isOwnOrder = existing.driverId === driverProfile.id;
      const isSelfPickup =
        existing.driverId === null && body.driverId === driverProfile.id;
      if (!isOwnOrder && !isSelfPickup) {
        return NextResponse.json(
          { error: "Drivers can only update their own orders" },
          { status: 403 },
        );
      }
      allowedFields = DRIVER_UPDATABLE_FIELDS;
    } else if (actor.role === "MERCHANT") {
      const merchant = await prisma.merchant.findUnique({
        where: { userId: actor.id },
        select: { id: true },
      });
      if (!merchant || existing.merchantId !== merchant.id) {
        return NextResponse.json(
          { error: "Merchants can only update their own orders" },
          { status: 403 },
        );
      }
      allowedFields = MERCHANT_UPDATABLE_FIELDS;
    } else {
      // ADMIN and staff (USER) share the staff whitelist.
      allowedFields = STAFF_UPDATABLE_FIELDS;
    }

    // ── Financial state protection (evaluated before any mutation) ─────────
    // WO = cleared in the payout workflow. Any change here must be an explicit
    // admin action (the returns endpoint is the normal path).
    if (existing.financialStatus === "WO" && !actorIsAdmin) {
      return NextResponse.json(
        {
          error: `Only administrators can modify orders with status "WO" (cleared payout). Contact an admin to roll back this order.`,
        },
        { status: 403 },
      );
    }
    // Orders tied to an open driver payout are owned by the payout workflow:
    // a location change here would silently unlink them from the PENDING
    // payout and recalculate totals, so only admins may do it via this endpoint.
    if (existing.driverPayoutId !== null && !actorIsAdmin) {
      return NextResponse.json(
        {
          error:
            "Orders in a pending driver payout can only be modified by administrators. Use the payout or returns section first.",
        },
        { status: 403 },
      );
    }

    // ── Whitelist extraction (unknown / forbidden fields are ignored) ──────
    // Unchecked update input: scalar FKs (driverId, merchantId, ...) directly.
    const data: Prisma.OrderUncheckedUpdateInput = {};
    for (const key of allowedFields) {
      const value = body[key];
      if (value !== undefined) {
        (data as Record<string, unknown>)[key] = value;
      }
    }

    // ── Numeric validation (reject NaN / non-finite / negative values) ─────
    const numericFields = [
      "amountUsd",
      "amountLbp",
      "extraShipping",
      "collectedUsd",
      "collectedLbp",
    ] as const;
    for (const field of numericFields) {
      if (data[field] !== undefined) {
        const parsed = parseFiniteNumber(data[field]);
        if (parsed === null || parsed < 0) {
          return NextResponse.json(
            { error: `Invalid value for ${field}` },
            { status: 400 },
          );
        }
        (data as Record<string, unknown>)[field] = parsed;
      }
    }

    // Legacy `price` alias → amountUsd (only when amountUsd was not sent).
    if (price !== undefined && data.amountUsd === undefined) {
      const parsed = parseFiniteNumber(price);
      if (parsed === null || parsed < 0) {
        return NextResponse.json(
          { error: "Invalid value for price" },
          { status: 400 },
        );
      }
      data.amountUsd = parsed;
    }

    if (data.packages !== undefined) {
      const parsed = Number(data.packages);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000000) {
        return NextResponse.json(
          { error: "Invalid value for packages" },
          { status: 400 },
        );
      }
      data.packages = parsed;
    }

    if (data.location !== undefined) {
      if (typeof data.location !== "string" || data.location.trim() === "") {
        return NextResponse.json(
          { error: "Invalid value for location" },
          { status: 400 },
        );
      }
      data.location = data.location.trim();
    }

    // ── Role-specific field constraints ────────────────────────────────────
    if (actor.role === "DRIVER") {
      if (
        data.location !== undefined &&
        !DRIVER_ALLOWED_LOCATIONS.has(data.location)
      ) {
        return NextResponse.json(
          {
            error:
              "Drivers can only move their orders to DELIVERED, RETURN, WITH_DRIVER or ASSIGNED",
          },
          { status: 403 },
        );
      }
      if (data.driverId === null) {
        return NextResponse.json(
          { error: "Drivers cannot unassign an order" },
          { status: 403 },
        );
      }
      if (
        data.driverId !== undefined &&
        data.driverId !== null &&
        data.driverId !== actionDriverId
      ) {
        return NextResponse.json(
          { error: "Drivers can only assign orders to themselves" },
          { status: 403 },
        );
      }
    }

    if (data.isArchived === true && !actorIsAdmin) {
      return NextResponse.json(
        { error: "Only administrators can archive orders" },
        { status: 403 },
      );
    }

    // Block driver reassignment on delivered / paid-out orders (non-admins).
    if (
      data.driverId !== undefined &&
      data.driverId !== existing.driverId &&
      !actorIsAdmin &&
      ["WD", "WO"].includes(existing.financialStatus)
    ) {
      return NextResponse.json(
        {
          error: `Cannot reassign driver on orders with status "${existing.financialStatus}". Use the payout or returns section to change status first.`,
        },
        { status: 400 },
      );
    }

    // --- SERVER-SIDE FINANCIAL STATUS SYNCHRONIZATION ---
    // financialStatus is derived from the resulting location. The value the
    // client sends is ignored (accepted only for compatibility), so a crafted
    // financialStatus can no longer fabricate WO/RTS/... states here.
    const changes: string[] = [];
    const newLocation =
      typeof data.location === "string" ? data.location : existing.location;
    const locationChanged = newLocation !== existing.location;
    const effectiveDriverId =
      data.driverId !== undefined ? data.driverId : existing.driverId;

    let newFinancialStatus = existing.financialStatus;
    if (locationChanged) {
      if (newLocation === "DELIVERED") {
        changes.push("Marked as Delivered");
        // Enforce WD (With Driver) — cash is now with driver upon delivery
        newFinancialStatus = "WD";
        if (data.deliveredAt === undefined) {
          data.deliveredAt = new Date();
        }
        // Collected defaults to the original order amount unless the caller
        // explicitly recorded a different collected price.
        if (data.collectedUsd === undefined) {
          data.collectedUsd = existing.amountUsd ?? 0;
        }
        if (data.collectedLbp === undefined) {
          data.collectedLbp = existing.amountLbp ?? 0;
        }
      } else if (newLocation === "ASSIGNED" || newLocation === "WITH_DRIVER") {
        // Order returned to driver (e.g., rolled back from payout).
        // Enforce UD — order is assigned to driver but not delivered.
        // WD is only for delivered orders in pending payout.
        // WO is for orders cleared from payout.
        newFinancialStatus = "UD";
        changes.push("Returned to Driver");
        // Clear delivered timestamp since the order is no longer delivered
        if (existing.deliveredAt && data.deliveredAt === undefined) {
          data.deliveredAt = null;
        }
      } else if (newLocation === "RETURN") {
        changes.push("Marked as Return");
        // RWD = Return With Driver (driver still has the package)
        // Re  = Returned to warehouse (package is back at warehouse)
        // Use the effective driver (a same-request unassignment wins).
        newFinancialStatus = effectiveDriverId ? "RWD" : "Re";
      } else if (newLocation === "WAREHOUSE") {
        changes.push("Returned to Warehouse");
        // Back in the warehouse => not delivered, back in the normal flow.
        newFinancialStatus = "UD";
      } else if (newLocation === "Archive" && data.isArchived === true) {
        // Archiving is admin-only (see guard above). Keep the legacy behavior
        // of marking archived orders with financialStatus "Arc" — the driver
        // page excludes them via `financialStatus notIn [..., "Arc"]`.
        changes.push("Archived");
        newFinancialStatus = "Arc";
      } else {
        changes.push(`Location changed to ${newLocation}`);
      }
    }

    // Keep the persisted display ID synchronized with the current financial
    // status. `orderId` is never writable from the client: it is always
    // recomputed from the stored ID, so the RTS "R" suffix (relied on by the
    // admin returns / cash-payout workflows) can never be forged or renamed.
    const newOrderId = orderIdForFinancialStatus(
      existing.orderId,
      newFinancialStatus,
    );

    // ── Payout cleanup: Unlink + recalc when order removed from pending payout ─
    // If the order was in a pending payout and is being moved back (not DELIVERED),
    // unlink it from the payout and recalculate totals.
    if (
      existing.driverPayoutId &&
      locationChanged &&
      newLocation !== "DELIVERED"
    ) {
      data.driverPayoutId = null;
      changes.push("Removed from Payout");

      // Fetch the payout to verify it's PENDING before recalculating
      const currentPayout = await prisma.driverPayout.findUnique({
        where: { id: existing.driverPayoutId },
        select: { id: true, status: true, driverId: true },
      });

      if (currentPayout && currentPayout.status === "PENDING") {
        const remainingOrders = await prisma.order.findMany({
          where: {
            driverPayoutId: currentPayout.id,
            id: { not: existing.id }, // exclude the order being removed
          },
          select: {
            id: true,
            amountUsd: true,
            amountLbp: true,
            collectedUsd: true,
            collectedLbp: true,
            zoneId: true,
            merchantId: true,
          },
        });

        if (remainingOrders.length === 0) {
          // No orders left — delete the empty payout
          await prisma.driverPayout.delete({
            where: { id: currentPayout.id },
          });
          changes.push("Payout deleted (no remaining orders)");
        } else {
          // Recalculate totals from remaining orders through the
          // authoritative commission module (same figures the payout
          // creation wrote): gross = collected > 0 else amount,
          // commission = seller exception → zone → $0, net = gross − fee.
          const rateTable = await loadDriverRateTable(
            prisma,
            currentPayout.driverId,
          );
          const recalced = recalcPayoutTotals(rateTable, remainingOrders);

          await prisma.driverPayout.update({
            where: { id: currentPayout.id },
            data: {
              totalUsd: recalced.totalUsd,
              totalLbp: recalced.totalLbp,
              commissionUsd: recalced.commissionUsd,
              netUsd: recalced.netUsd,
              totalCollected: recalced.totalCollected,
            },
          });
          changes.push("Payout totals recalculated");
        }
      }
    }

    // --- GRANULAR HISTORY LOGGING ---

    if (
      data.driverId !== undefined &&
      data.driverId !== existing.driverId
    ) {
      if (data.driverId === null) changes.push("Driver Unassigned");
      else changes.push("Assigned to Driver");
    }

    if (
      data.customerAddress !== undefined &&
      data.customerAddress !== existing.customerAddress
    ) {
      changes.push(
        `Address: '${existing.customerAddress}' -> '${data.customerAddress}'`,
      );
    }
    if (
      data.customerPhone !== undefined &&
      data.customerPhone !== existing.customerPhone
    ) {
      changes.push(
        `Phone: '${existing.customerPhone}' -> '${data.customerPhone}'`,
      );
    }
    if (data.amountUsd !== undefined && data.amountUsd !== existing.amountUsd) {
      changes.push(`Price$: ${existing.amountUsd} -> ${data.amountUsd}`);
    }
    if (data.amountLbp !== undefined && data.amountLbp !== existing.amountLbp) {
      changes.push(`PriceLL: ${existing.amountLbp} -> ${data.amountLbp}`);
    }
    if (
      data.collectedUsd !== undefined ||
      data.collectedLbp !== undefined
    ) {
      changes.push(
        `Collected: $${data.collectedUsd ?? existing.collectedUsd} | LL${data.collectedLbp ?? existing.collectedLbp}`,
      );
    }
    if (data.notes !== undefined && data.notes !== existing.notes) {
      changes.push(`Note Added/Edited: ${data.notes}`);
    }

    const actionNote =
      typeof driverActionLog === "string" && driverActionLog.trim() !== ""
        ? driverActionLog
        : changes.length > 0
          ? changes.join(" | ")
          : "Order Updated";

    // History attribution: the acting user comes from the session; the
    // driver recorded is the effective (post-update) driver of the order.
    const historyDriverId: string | null =
      data.driverId !== undefined
        ? (data.driverId as string | null)
        : existing.driverId;

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        ...data,
        location: newLocation,
        financialStatus: newFinancialStatus,
        orderId: newOrderId,
        history: {
          create: {
            action: actionNote,
            location: newLocation,
            driverId: historyDriverId,
            userId: actor.id,
          },
        },
      },
    });

    // ── Exchange orders ──────────────────────────────────────────────
    // When an exchange order (hasExchange) is delivered, create the
    // "<orderId>-Exchange" proof order (idempotent) so it shows up in the
    // driver's Returns/Exchange tab and can be moved to the returns warehouse.
    if (newLocation === "DELIVERED" && existing.hasExchange && actor.id) {
      await createExchangeOrderFromDelivered(existing, actor.id);
    }

    notifyCustomerStatusChange(
      updatedOrder.orderId,
      newLocation,
      updatedOrder.customerPhone,
      updatedOrder.trackToken,
    ).catch(console.error);

    return NextResponse.json(updatedOrder, { status: 200 });
  } catch (error: any) {
    console.error("[PATCH /api/orders] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
