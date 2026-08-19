import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { notifyCustomerStatusChange } from "@/lib/notifications";
import { generateTrackToken } from "@/lib/tracking";
import { createExchangeOrderFromDelivered } from "@/lib/exchange";

// ─── GET /api/orders ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
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

    // Run count + data in parallel
    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
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
          skip,
          take,
          hasMore: skip + take < total,
        },
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("[GET /api/orders] Query failed:", error.message);

    // Fallback: Fetch basic order records if a relation field name changed in schema.prisma
    try {
      const basicOrders = await prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return NextResponse.json(basicOrders, { status: 200 });
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

    const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    if (!adminUser)
      return NextResponse.json(
        { error: "System Admin not found" },
        { status: 400 },
      );

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
        creatorId: adminUser.id,
        notes: body.notes || null,
        merchantId: body.merchantId || null,
        driverId: body.driverId || null,
        ...(createdAt && { createdAt }),
        history: {
          create: {
            action: "Order Created",
            location: "WAREHOUSE",
            userId: adminUser.id,
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
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    );
  }
}

// ─── PATCH /api/orders ────────────────────────────────────────────────────────
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const {
      id,
      price,
      status,
      extraShipping,
      currentUserActionId,
      driverActionLog,
      ...updateData
    } = body;

    if (!id)
      return NextResponse.json(
        { error: "Order id is required" },
        { status: 400 },
      );

    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing)
      return NextResponse.json({ error: "Order not found" }, { status: 404 });

    // ── Block driver reassignment on delivered / paid-out orders ─────────
    if (
      updateData.driverId !== undefined &&
      existing.driverId !== updateData.driverId &&
      existing.financialStatus &&
      ["WD", "WO"].includes(existing.financialStatus)
    ) {
      return NextResponse.json(
        {
          error: `Cannot reassign driver on orders with status "${existing.financialStatus}". Use the payout or returns section to change status first.`,
        },
        { status: 400 },
      );
    }

    // ── Resolve authenticated userId, role & driverId from session cookie ─
    const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    let actionUserId = currentUserActionId || adminUser?.id;
    let actionDriverId: string | null | undefined = undefined;
    let sessionRole: string | null = null;

    try {
      const cookieStore = await cookies();
      const token = cookieStore.get("session")?.value;
      if (token) {
        const secret = new TextEncoder().encode(process.env.JWT_SECRET);
        const { payload } = await jwtVerify(token, secret);
        const sessionUserId = payload.id as string;
        sessionRole = (payload.role as string) || null;
        if (sessionUserId) {
          if (!currentUserActionId) actionUserId = sessionUserId;
          const driverProfile = await prisma.driverProfile.findUnique({
            where: { userId: sessionUserId },
            select: { id: true },
          });
          if (driverProfile) actionDriverId = driverProfile.id;
        }
      }
    } catch {
      // Session lookup is best-effort; fall back to body-supplied ids
    }

    // ── Admin-only guard: WO status change (cleared payout rollback) ──────
    // Only admins can modify orders that are in a cleared payout (WO).
    // Any non-admin attempt to update a WO order is rejected.
    if (existing.financialStatus === "WO") {
      const isAdmin = sessionRole === "ADMIN" || adminUser?.id === actionUserId;
      if (!isAdmin) {
        return NextResponse.json(
          {
            error: `Only administrators can modify orders with status "WO" (cleared payout). Contact an admin to roll back this order.`,
          },
          { status: 403 },
        );
      }
    }

    if (price !== undefined) updateData.amountUsd = parseFloat(price);
    if (extraShipping !== undefined)
      updateData.extraShipping = parseFloat(extraShipping);

    if (updateData.collectedUsd !== undefined)
      updateData.collectedUsd = parseFloat(updateData.collectedUsd) ?? 0;
    if (updateData.collectedLbp !== undefined)
      updateData.collectedLbp = parseFloat(updateData.collectedLbp) ?? 0;

    // --- SERVER-SIDE FINANCIAL STATUS SYNCHRONIZATION ---
    // Enforce the correct financialStatus when location transitions,
    // so the UI filter expectations (location + financialStatus) are always met.
    // This is a safety net even if the client omits the field.
    const changes: string[] = [];
    if (updateData.location && updateData.location !== existing.location) {
      if (updateData.location === "DELIVERED") {
        changes.push("Marked as Delivered");
        // Enforce WD (With Driver) — cash is now with driver upon delivery
        updateData.financialStatus = "WD";
        if (!updateData.deliveredAt) {
          updateData.deliveredAt = new Date();
        }
        // Collected defaults to the original order amount unless the driver
        // explicitly recorded a different collected price.
        if (updateData.collectedUsd === undefined) {
          updateData.collectedUsd = existing.amountUsd ?? 0;
        }
        if (updateData.collectedLbp === undefined) {
          updateData.collectedLbp = existing.amountLbp ?? 0;
        }
      } else if (
        updateData.location === "ASSIGNED" ||
        updateData.location === "WITH_DRIVER"
      ) {
        // Order returned to driver (e.g., rolled back from payout).
        // Enforce UD — order is assigned to driver but not delivered.
        // WD is only for delivered orders in pending payout.
        // WO is for orders cleared from payout.
        updateData.financialStatus = "UD";
        changes.push("Returned to Driver");
        // Clear delivered timestamp since the order is no longer delivered
        if (existing.deliveredAt) {
          updateData.deliveredAt = null;
        }
      } else if (updateData.location === "RETURN") {
        changes.push("Marked as Return");
        // Always enforce correct financialStatus based on driverId presence:
        // RWD = Return With Driver (driver still has the package)
        // Re  = Returned to warehouse (package is back at warehouse)
        updateData.financialStatus = existing.driverId ? "RWD" : "Re";
      } else if (updateData.location === "WAREHOUSE") {
        changes.push("Returned to Warehouse");
      } else {
        changes.push(`Location changed to ${updateData.location}`);
      }
    }

    // ── Payout cleanup: Unlink + recalc when order removed from pending payout ─
    // If the order was in a pending payout and is being moved back (not DELIVERED),
    // unlink it from the payout and recalculate totals.
    if (
      existing.driverPayoutId &&
      updateData.location &&
      updateData.location !== existing.location &&
      updateData.location !== "DELIVERED"
    ) {
      updateData.driverPayoutId = null;
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
          // Recalculate totals from remaining orders
          const newTotalUsd = remainingOrders.reduce(
            (sum, o) => sum + (o.amountUsd ?? 0),
            0,
          );
          const newTotalLbp = remainingOrders.reduce(
            (sum, o) => sum + (o.amountLbp ?? 0),
            0,
          );

          // Recalculate commission using 3-tier logic
          const zoneRates = await prisma.driverZoneRate.findMany({
            where: { driverId: currentPayout.driverId || undefined },
          });
          const zoneRateMap = new Map(
            zoneRates.map((zr) => [zr.zoneId, zr.rate]),
          );

          const driverProfile = await prisma.driverProfile.findUnique({
            where: { id: currentPayout.driverId || undefined },
            select: { userId: true },
          });

          const sellerRates = driverProfile?.userId
            ? await prisma.driverSellerRate.findMany({
                where: { driverId: currentPayout.driverId || undefined },
              })
            : [];

          const sellerExceptionMap = new Map<string, number>();
          // A $0 seller exception is still a valid override of the zonal rate.
          for (const sr of sellerRates) {
            sellerExceptionMap.set(sr.merchantId, sr.rateUsd);
          }

          const newCommissionUsd = remainingOrders.reduce((sum, o) => {
            const merchantId = String(o.merchantId ?? "");
            const exceptionRate = merchantId
              ? sellerExceptionMap.get(merchantId)
              : undefined;
            const commission =
              exceptionRate !== undefined
                ? exceptionRate
                : (zoneRateMap.get(o.zoneId) ?? 0);
            return sum + commission;
          }, 0);

          const newNetUsd = newTotalUsd - newCommissionUsd;

          await prisma.driverPayout.update({
            where: { id: currentPayout.id },
            data: {
              totalUsd: newTotalUsd,
              totalLbp: newTotalLbp,
              commissionUsd: newCommissionUsd,
              netUsd: newNetUsd,
              totalCollected: newTotalUsd,
            },
          });
          changes.push("Payout totals recalculated");
        }
      }
    }

    // --- GRANULAR HISTORY LOGGING ---

    if (
      updateData.driverId !== undefined &&
      updateData.driverId !== existing.driverId
    ) {
      if (updateData.driverId === null) changes.push("Driver Unassigned");
      else changes.push("Assigned to Driver");
    }

    if (
      updateData.customerAddress !== undefined &&
      updateData.customerAddress !== existing.customerAddress
    ) {
      changes.push(
        `Address: '${existing.customerAddress}' -> '${updateData.customerAddress}'`,
      );
    }
    if (
      updateData.customerPhone !== undefined &&
      updateData.customerPhone !== existing.customerPhone
    ) {
      changes.push(
        `Phone: '${existing.customerPhone}' -> '${updateData.customerPhone}'`,
      );
    }
    if (
      updateData.amountUsd !== undefined &&
      updateData.amountUsd !== existing.amountUsd
    ) {
      changes.push(`Price$: ${existing.amountUsd} -> ${updateData.amountUsd}`);
    }
    if (
      updateData.amountLbp !== undefined &&
      updateData.amountLbp !== existing.amountLbp
    ) {
      changes.push(`PriceLL: ${existing.amountLbp} -> ${updateData.amountLbp}`);
    }
    if (
      updateData.collectedUsd !== undefined ||
      updateData.collectedLbp !== undefined
    ) {
      changes.push(
        `Collected: $${updateData.collectedUsd ?? existing.collectedUsd} | LL${updateData.collectedLbp ?? existing.collectedLbp}`,
      );
    }
    if (updateData.notes !== undefined && updateData.notes !== existing.notes) {
      changes.push(`Note Added/Edited: ${updateData.notes}`);
    }

    const actionNote = driverActionLog
      ? driverActionLog
      : changes.length > 0
        ? changes.join(" | ")
        : "Order Updated";

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        ...updateData,
        history: {
          create: {
            action: actionNote,
            location: updateData.location || existing.location,
            driverId:
              actionDriverId ?? updateData.driverId ?? existing.driverId,
            userId: actionUserId,
          },
        },
      },
    });

    const newLocation = updateData.location || existing.location;

    // ── Exchange orders ──────────────────────────────────────────────
    // When an exchange order (hasExchange) is delivered, create the
    // "<orderId>-Exchange" proof order (idempotent) so it shows up in the
    // driver's Returns/Exchange tab and can be moved to the returns warehouse.
    if (newLocation === "DELIVERED" && existing.hasExchange && actionUserId) {
      await createExchangeOrderFromDelivered(existing, actionUserId);
    }

    notifyCustomerStatusChange(
      updatedOrder.orderId,
      newLocation,
      updatedOrder.customerPhone,
      updatedOrder.trackToken,
    ).catch(console.error);

    return NextResponse.json(updatedOrder, { status: 200 });
  } catch (error: any) {
    console.error("[PATCH /api/orders] Error:", error.message);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    );
  }
}
