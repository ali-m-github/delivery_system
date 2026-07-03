import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { notifyCustomerStatusChange } from "@/lib/notifications";

const prisma = new PrismaClient();

// ─── GET /api/orders ──────────────────────────────────────────────────────────
export async function GET() {
  try {
    // Attempt full relational include
    const orders = await prisma.order.findMany({
      include: {
        zone: true,
        driver: true,
        merchant: true,
        creator: true,
        history: { include: { user: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(orders, { status: 200 });
  } catch (error: any) {
    console.error("[GET /api/orders] Full include failed:", error.message);

    // Fallback: Fetch basic order records if a relation field name changed in schema.prisma
    try {
      const basicOrders = await prisma.order.findMany({
        orderBy: { createdAt: "desc" },
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
    const finalOrderId = body.orderId || body.newOrderId;
    const finalZoneId = body.zoneId || body.selectedZoneId;
    const finalPrice = body.price || body.amountUsd;

    if (!finalOrderId)
      return NextResponse.json(
        { error: "Missing Tracking ID" },
        { status: 400 },
      );
    if (!body.customerName)
      return NextResponse.json(
        { error: "Missing Customer Name" },
        { status: 400 },
      );
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

    const newOrder = await prisma.order.create({
      data: {
        orderId: finalOrderId,
        customerName: body.customerName,
        customerPhone: body.customerPhone || "N/A",
        customerAddress: body.customerAddress || "N/A",
        packages: packages,
        zoneId: finalZoneId,
        hasExchange: body.hasExchange === true || body.hasExchange === "true",
        amountUsd: amountUsd,
        extraShipping: extraShipping,
        creatorId: adminUser.id,
        notes: body.notes || null,
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
    console.error("[POST /api/orders] Error:", error.message);
    return NextResponse.json(
      { error: error.message || "Failed to create order" },
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

    // ── Resolve authenticated userId & driverId from session cookie ──────
    const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    let actionUserId = currentUserActionId || adminUser?.id;
    let actionDriverId: string | null | undefined = undefined;

    try {
      const cookieStore = await cookies();
      const token = cookieStore.get("session")?.value;
      if (token) {
        const secret = new TextEncoder().encode(process.env.JWT_SECRET);
        const { payload } = await jwtVerify(token, secret);
        const sessionUserId = payload.id as string;
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

    if (price !== undefined) updateData.amountUsd = parseFloat(price);
    if (extraShipping !== undefined)
      updateData.extraShipping = parseFloat(extraShipping);

    if (updateData.collectedUsd !== undefined)
      updateData.collectedUsd = parseFloat(updateData.collectedUsd) || 0;
    if (updateData.collectedLbp !== undefined)
      updateData.collectedLbp = parseFloat(updateData.collectedLbp) || 0;

    // --- GRANULAR HISTORY LOGGING ---
    let changes: string[] = [];

    if (updateData.location && updateData.location !== existing.location) {
      if (updateData.location === "DELIVERED")
        changes.push("Marked as Delivered");
      else if (updateData.location === "RETURN")
        changes.push("Marked as Return");
      else if (updateData.location === "WAREHOUSE")
        changes.push("Returned to Warehouse");
      else changes.push(`Location changed to ${updateData.location}`);
    }

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
        `Collected: $${updateData.collectedUsd || existing.collectedUsd} | LL${updateData.collectedLbp || existing.collectedLbp}`,
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

    if (status !== undefined) {
      if (status === "Re") {
        updateData.location = "Re";
        updateData.financialStatus = "Re";
      }
    }

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
    notifyCustomerStatusChange(
      updatedOrder.orderId,
      newLocation,
      updatedOrder.customerPhone,
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
