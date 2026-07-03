import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

const prisma = new PrismaClient();

// POST /api/merchant/orders — Merchant-scoped order creation
// The merchantId is programmatically injected from the authenticated session.
export async function POST(request: Request) {
  try {
    // ── Authenticate via session cookie ──────────────────────────────────
    const cookieStore = await cookies();
    const token = cookieStore.get("session")?.value;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    let payload: { id: string; role: string };
    try {
      const verified = await jwtVerify(token, secret);
      payload = verified.payload as { id: string; role: string };
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 },
      );
    }

    if (payload.role !== "MERCHANT") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── Resolve merchant profile from session userId ─────────────────────
    const merchant = await prisma.merchant.findUnique({
      where: { userId: payload.id },
      select: { id: true, merchantId: true },
    });

    if (!merchant) {
      return NextResponse.json(
        { error: "No merchant profile linked to your account" },
        { status: 403 },
      );
    }

    // ── Parse request body ───────────────────────────────────────────────
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

    const parsedPrice = parseFloat(finalPrice);
    const amountUsd = isNaN(parsedPrice) ? 0 : parsedPrice;

    const parsedLbp = parseFloat(body.amountLbp);
    const amountLbp = isNaN(parsedLbp) ? 0 : parsedLbp;

    const parsedExtraShipping = parseFloat(body.extraShipping);
    const extraShipping = isNaN(parsedExtraShipping) ? 0 : parsedExtraShipping;

    const parsedPackages = parseInt(body.packages);
    const packages = isNaN(parsedPackages) ? 1 : parsedPackages;

    // ── Create order with programmatically injected merchantId ────────────
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
        amountLbp: amountLbp,
        extraShipping: extraShipping,
        // ── Security: merchantId injected from session, never from body ──
        merchantId: merchant.id,
        creatorId: payload.id,
        notes: body.notes || null,
        history: {
          create: {
            action: "Order Created by Merchant",
            location: "WAREHOUSE",
            userId: payload.id,
          },
        },
      },
    });

    return NextResponse.json(newOrder, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create order" },
      { status: 500 },
    );
  }
}
