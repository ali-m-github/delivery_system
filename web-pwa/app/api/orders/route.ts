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
  isPayoutMutable,
  MissingDriverRateError,
} from "@/lib/commission";
import {
  ConcurrencyConflictError,
  withConcurrencyRetries,
} from "@/lib/concurrency";
import {
  requireAuthenticatedSession,
  requireServerPermission,
} from "@/lib/server-permissions";
import { hasPermission } from "@/lib/permissions";

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
  if (location) {
    // "With Driver" is the union of both driver-held states: ASSIGNED (order
    // queued with a driver) and WITH_DRIVER (order out for delivery). An exact
    // match on "WITH_DRIVER" alone hides the orders assigned through the driver
    // assignment workflows, which persist location = "ASSIGNED".
    where.location =
      location === "WITH_DRIVER"
        ? { in: ["WITH_DRIVER", "ASSIGNED", "ASSIGNED_TR"] }
        : location;
  }
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

  // ── Authorization scope (server-side only — never from query/body) ───────
  // Resolved before the try block and merged into `where`, so the degraded
  // fallback below automatically reuses the same scope as the returned data.
  const actor = auth.user; // DB-verified user behind the session
  let authScope: Record<string, unknown>;
  try {
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
      authScope = { driverId: driverProfile.id };
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
      // Staff (USER/EMPLOYEE): the global order list is restricted.
      if (!hasPermission(actor, "ORDERS_VIEW")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      authScope = {};
    }
  } catch (error: any) {
    // Log the raw error server-side; never echo it to the client (raw DB
    // errors can leak schema/table details).
    console.error("[GET /api/orders] Scope resolution failed:", error.message);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
  Object.assign(where, authScope);

  // ── Which visible orders already have a "-Exchange" proof order? ─────────
  // A one-shot in-memory map built from the same auth scope as the list
  // itself: any order whose "<orderId>-Exchange" row exists (whether created
  // by the manual button or by the delivery flow) cannot have a second
  // exchange order — the UI hides the Exchange action and the POST
  // /api/orders/:id/exchange route rejects it (idempotency guard).
  const exchangeIds = new Set<string>();
  if (Array.isArray(where.orderId)) {
    // Bulk lookup: scope is already narrowed to the requested orderIds.
    const hits = await prisma.order.findMany({
      where: { orderId: { in: where.orderId }, ...authScope },
      select: { orderId: true },
    });
    for (const o of hits) {
      if (o.orderId.endsWith("-Exchange")) {
        exchangeIds.add(o.orderId.slice(0, -"-Exchange".length));
      }
    }
  } else {
    const proof = await prisma.order.findMany({
      where: { orderId: { endsWith: "-Exchange" }, ...authScope },
      select: { orderId: true },
    });
    for (const o of proof) {
      exchangeIds.add(o.orderId.slice(0, -"-Exchange".length));
    }
  }

  try {
    // Tab badges need totals from the database, not only the current page of
    // orders returned below. Keep the archive scope consistent with the view
    // and the authorization scope of the data returned.
    const summaryWhere: Record<string, unknown> = { ...authScope };
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
          openParcelAllowed: true,
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
        data: orders.map((o) => ({
          ...o,
          exchangeExists: exchangeIds.has(o.orderId),
        })),
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
          openParcelAllowed: true,
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
          data: basicOrders.map((o) => ({
            ...o,
            exchangeExists: exchangeIds.has(o.orderId),
          })),
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
      // Log the raw error server-side; never echo it to the client.
      console.error(
        "[GET /api/orders] Fallback query failed:",
        fallbackError.message,
      );
      return NextResponse.json(
        { error: "Internal Server Error" },
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
        openParcelAllowed:
          body.openParcelAllowed === true || body.openParcelAllowed === "true",
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
  "openParcelAllowed",
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
  "ASSIGNED_TR",
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

// Fields that carry financial meaning. Staff (non-ADMIN) may only write these
// with the ORDERS_FINANCIAL permission. DRIVER/MERCHANT keep their own
// role-scoped whitelists (their COD workflows), and ADMIN is unrestricted.
const FINANCIAL_FIELDS = new Set<string>([
  "amountUsd",
  "amountLbp",
  "extraShipping",
  "collectedUsd",
  "collectedLbp",
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

    // Legacy `price` alias → amountUsd, normalized BEFORE whitelist and
    // permission evaluation so it is authorized exactly like amountUsd
    // itself: a role that may not write amountUsd can no longer smuggle it
    // in through `price`.
    if (price !== undefined && body.amountUsd === undefined) {
      body.amountUsd = price;
    }

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
      // ADMIN and staff (USER/EMPLOYEE) share the staff whitelist, but staff
      // must hold ORDERS_EDIT — ADMIN passes via the ADMIN bypass inside
      // hasPermission, so full authority is preserved for admins.
      if (!hasPermission(actor, "ORDERS_EDIT")) {
        return NextResponse.json(
          {
            error:
              "Staff users require the ORDERS_EDIT permission to update orders",
          },
          { status: 403 },
        );
      }
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

    // ── Historical payout protection (fix A) ───────────────────────────────
    // A payout leaves the mutable state as soon as it is settled / cleared:
    //   PENDING_APPROVAL → amountPaid / remaining / debt carryover recorded
    //   SETTLED / CLEARED → orders flipped to WO, treasury posting made
    // Its stored totals are historical money. Generic order editing must NOT
    // detach such an order or change anything that feeds the payout totals —
    // that would silently diverge ledger, settlement and treasury figures.
    // The sanctioned reversal paths remain: void (PENDING only), the admin
    // orders-return workflow, and treasury rejection.
    //
    // The pre-read here fails closed on a dangling reference; the VALUE-
    // based rejection (only fields that actually change vs the stored row,
    // so an unrelated edit like a note never trips it) runs AFTER the
    // server-side location→financialStatus synchronization below.
    let linkedPayout: { id: string; status: string } | null = null;
    if (existing.driverPayoutId) {
      linkedPayout = await prisma.driverPayout.findUnique({
        where: { id: existing.driverPayoutId },
        select: { id: true, status: true },
      });
      if (!linkedPayout) {
        // Dangling reference is a data-integrity error; fail closed.
        return NextResponse.json(
          { error: "Order references a driver payout that no longer exists" },
          { status: 409 },
        );
      }
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

    // ── Financial field gate (staff only — ADMIN bypasses) ─────────────────
    // Client-supplied monetary fields require ORDERS_FINANCIAL. This runs
    // after whitelist extraction, so the legacy `price` alias (already
    // normalized into body.amountUsd above) is covered by the same check.
    if (allowedFields === STAFF_UPDATABLE_FIELDS && !actorIsAdmin) {
      const touchedFinancial = [...FINANCIAL_FIELDS].filter(
        (f) => (data as Record<string, unknown>)[f] !== undefined,
      );
      if (
        touchedFinancial.length > 0 &&
        !hasPermission(actor, "ORDERS_FINANCIAL")
      ) {
        return NextResponse.json(
          {
            error: `Financial fields (${touchedFinancial.join(", ")}) require the ORDERS_FINANCIAL permission`,
          },
          { status: 403 },
        );
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
              "Drivers can only move their orders to DELIVERED, RETURN, WITH_DRIVER, ASSIGNED or ASSIGNED_TR",
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
      } else if (
        newLocation === "ASSIGNED" ||
        newLocation === "ASSIGNED_TR" ||
        newLocation === "WITH_DRIVER"
      ) {
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

    // ── Historical payout guard (fix A, value-based) ────────────────────────
    // Reject only edits that ACTUALLY change a payout-affecting value vs the
    // stored row (after the server-side sync above). Resending an unchanged
    // value alongside a cosmetic edit (e.g. a note) must not be blocked.
    // Anything outside PAYOUT_AFFECTING_FIELDS is cosmetic and never touches
    // payout money.
    if (linkedPayout && !isPayoutMutable(linkedPayout.status)) {
      const affected: string[] = [];
      if (locationChanged) affected.push("location");
      if (newFinancialStatus !== existing.financialStatus)
        affected.push("financialStatus");
      if (data.driverId !== undefined && data.driverId !== existing.driverId)
        affected.push("driverId");
      if (data.amountUsd !== undefined && data.amountUsd !== existing.amountUsd)
        affected.push("amountUsd");
      if (data.amountLbp !== undefined && data.amountLbp !== existing.amountLbp)
        affected.push("amountLbp");
      if (
        data.collectedUsd !== undefined &&
        data.collectedUsd !== existing.collectedUsd
      )
        affected.push("collectedUsd");
      if (
        data.collectedLbp !== undefined &&
        data.collectedLbp !== existing.collectedLbp
      )
        affected.push("collectedLbp");
      if (
        data.extraShipping !== undefined &&
        data.extraShipping !== existing.extraShipping
      )
        affected.push("extraShipping");
      if (data.zoneId !== undefined && data.zoneId !== existing.zoneId)
        affected.push("zoneId");
      if (
        data.merchantId !== undefined &&
        data.merchantId !== existing.merchantId
      )
        affected.push("merchantId");
      if (
        data.isArchived !== undefined &&
        data.isArchived !== existing.isArchived
      )
        affected.push("isArchived");
      if (
        data.hasExchange !== undefined &&
        data.hasExchange !== existing.hasExchange
      )
        affected.push("hasExchange");
      if (
        data.openParcelAllowed !== undefined &&
        data.openParcelAllowed !== existing.openParcelAllowed
      )
        affected.push("openParcelAllowed");

      if (affected.length > 0) {
        return NextResponse.json(
          {
            error: `Order belongs to a driver payout in "${linkedPayout.status}" (a historical financial record). Changes to ${affected.join(", ")} are not allowed through generic order editing — use the payout void / returns workflow instead.`,
          },
          { status: 409 },
        );
      }
    }

    // ── Payout-affecting decision for the atomic unit below ────────────────
    // Detach: the order leaves the payout (moved to a non-DELIVERED location).
    const willDetach =
      existing.driverPayoutId !== null &&
      locationChanged &&
      newLocation !== "DELIVERED";
    // Money recompute: still in the payout, but the financial sync above
    // effectively changed what is owed (moved to DELIVERED, or an
    // amount/collected/zone/merchant value that differs from the stored row).
    const willRecompute =
      existing.driverPayoutId !== null &&
      !willDetach &&
      (locationChanged ||
        (data.amountUsd !== undefined && data.amountUsd !== existing.amountUsd) ||
        (data.amountLbp !== undefined && data.amountLbp !== existing.amountLbp) ||
        (data.collectedUsd !== undefined && data.collectedUsd !== existing.collectedUsd) ||
        (data.collectedLbp !== undefined && data.collectedLbp !== existing.collectedLbp) ||
        (data.zoneId !== undefined && data.zoneId !== existing.zoneId) ||
        (data.merchantId !== undefined && data.merchantId !== existing.merchantId));

    // --- GRANULAR HISTORY LOGGING ---

    if (
      data.driverId !== undefined &&
      data.driverId !== existing.driverId
    ) {
      if (data.driverId === null) changes.push("Driver Unassigned");
      else if (newLocation === "ASSIGNED_TR")
        // The transit label is already recorded by the location sync branch
        // above ("Assigned to Driver (Transit)"); avoid a duplicate entry.
        changes.push("Assigned to Driver (Transit)");
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

    // NOTE: the history `action` note is finalized INSIDE the atomic
    // transaction below, because the payout reconciliation entries
    // ("Removed from Payout", "Payout totals recalculated", ...) are only
    // known once that reconciliation has run.

    // History attribution: the acting user comes from the session; the
    // driver recorded is the effective (post-update) driver of the order.
    const historyDriverId: string | null =
      data.driverId !== undefined
        ? (data.driverId as string | null)
        : existing.driverId;

    // ── Atomic order update + payout reconciliation (fix A) ────────────────
    // Detach + payout recalculation + order update are ONE transaction so a
    // failure can never leave the order unlinked while the payout still carries
    // stale totals (or vice versa). The payout is re-read INSIDE the
    // transaction and a CAS on its status guards against a concurrent settle /
    // clear landing between our pre-read and the write.
    const baseChanges = [...changes];
    const finalActionNote = () =>
      typeof driverActionLog === "string" && driverActionLog.trim() !== ""
        ? driverActionLog
        : changes.length > 0
          ? changes.join(" | ")
          : "Order Updated";

    const updatedOrder = await withConcurrencyRetries(() =>
      prisma.$transaction(async (tx) => {
        // Each attempt is self-contained: reset the change log to the
        // pre-transaction entries so a retried attempt cannot duplicate the
        // payout reconciliation notes.
        changes.length = 0;
        changes.push(...baseChanges);

        if (existing.driverPayoutId) {
          // Re-read the payout inside the transaction: the pre-read above is
          // only an optimization, this is the authoritative check.
          const payout = await tx.driverPayout.findUnique({
            where: { id: existing.driverPayoutId! },
            select: { id: true, status: true, driverId: true },
          });
          if (!payout) {
            // Dangling reference — fail closed rather than detach blindly.
            throw new ConcurrencyConflictError(
              "Order references a driver payout that no longer exists",
            );
          }
          if (!isPayoutMutable(payout.status)) {
            throw new ConcurrencyConflictError(
              `Driver payout is no longer mutable (status: ${payout.status}); concurrent settle/clear detected`,
            );
          }

          if (willDetach) {
            // Unlink this order from the payout first (still inside the tx).
            await tx.order.update({
              where: { id },
              data: { driverPayoutId: null },
            });
            changes.push("Removed from Payout");
          }

          if (willDetach || willRecompute) {
            // Full order rows (recalc reads the financial scalars) plus
            // human-readable labels for the fail-closed missing-rate error.
            const labelIncludes = {
              zone: { select: { name: true } },
              merchant: { select: { merchantName: true } },
            };
            let remainingOrders: {
              id: string;
              orderId: string;
              amountUsd: number;
              amountLbp: number;
              collectedUsd: number;
              collectedLbp: number;
              zoneId: string;
              merchantId: string | null;
            }[];
            if (willDetach) {
              // Order is unlinked first: everything left on the payout.
              remainingOrders = await tx.order.findMany({
                where: { driverPayoutId: payout.id },
                include: labelIncludes,
              });
            } else {
              // Still linked: recompute from the post-update row (already
              // applied by the detach-less update below? No — this tx runs
              // the payout recalc BEFORE the final order update, so apply the
              // incoming monetary values over the stored row in memory).
              const self = await tx.order.findUnique({
                where: { id },
                include: labelIncludes,
              });
              if (!self) {
                throw new ConcurrencyConflictError(
                  "Order vanished mid-transaction; retrying",
                );
              }
              const patchedSelf = {
                ...self,
                amountUsd:
                  data.amountUsd !== undefined ? Number(data.amountUsd) : self.amountUsd,
                amountLbp:
                  data.amountLbp !== undefined ? Number(data.amountLbp) : self.amountLbp,
                collectedUsd:
                  data.collectedUsd !== undefined ? Number(data.collectedUsd) : self.collectedUsd,
                collectedLbp:
                  data.collectedLbp !== undefined ? Number(data.collectedLbp) : self.collectedLbp,
                zoneId: data.zoneId !== undefined ? String(data.zoneId) : self.zoneId,
                merchantId:
                  data.merchantId !== undefined
                    ? (data.merchantId as string | null)
                    : self.merchantId,
              };
              remainingOrders = [
                patchedSelf,
                // ...plus every other order the payout still holds.
                ...(await tx.order.findMany({
                  where: {
                    driverPayoutId: payout.id,
                    id: { not: id },
                  },
                  include: labelIncludes,
                })),
              ];
            }

            if (remainingOrders.length === 0) {
              // No orders left — delete the empty payout.
              await tx.driverPayout.delete({ where: { id: payout.id } });
              changes.push("Payout deleted (no remaining orders)");
            } else {
              // Recalculate totals through the authoritative commission
              // module (same figures the payout creation wrote):
              // gross = collected > 0 else amount,
              // commission = seller exception (cash wins) → zone rate,
              // NO default (throws MissingDriverRateError if any order has
              // no configured rate — the whole tx rolls back),
              // net = gross − fee.
              const rateTable = await loadDriverRateTable(tx, payout.driverId);
              const recalced = recalcPayoutTotals(rateTable, remainingOrders);
              // CAS on status so a concurrent settle/clear can't be clobbered.
              const res = await tx.driverPayout.updateMany({
                where: { id: payout.id, status: "PENDING" },
                data: {
                  totalUsd: recalced.totalUsd,
                  totalLbp: recalced.totalLbp,
                  commissionUsd: recalced.commissionUsd,
                  netUsd: recalced.netUsd,
                  totalCollected: recalced.totalCollected,
                },
              });
              if (res.count === 0) {
                throw new ConcurrencyConflictError(
                  "Driver payout state changed concurrently; retrying",
                );
              }
              changes.push("Payout totals recalculated");
            }
          }
        }

        return tx.order.update({
          where: { id },
          data: {
            ...data,
            location: newLocation,
            financialStatus: newFinancialStatus,
            orderId: newOrderId,
            history: {
              create: {
                action: finalActionNote(),
                location: newLocation,
                driverId: historyDriverId,
                userId: actor.id,
              },
            },
          },
        });
      })
    );

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
    // A missing driver rate is a configuration error, not a 500: the
    // transaction was rolled back, nothing was changed. Surface the
    // actionable message (a $0 rate is a valid explicit override).
    if (error instanceof MissingDriverRateError) {
      return NextResponse.json(
        { error: error.message, missingRateOrders: error.missingOrders },
        { status: 400 },
      );
    }
    console.error("[PATCH /api/orders] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
