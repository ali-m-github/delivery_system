import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  currentStatusLabel,
  LOCKED_DELIVERY_LOCATIONS,
  parseDeliveryUpdate,
  publicName,
  toCustomerMessage,
} from "@/lib/tracking";
import { rateLimitResponse } from "@/lib/rate-limit";

// ──────────────────────────────────────────────
// Legacy public tracking endpoint (pre-token links)
// GET /api/track/<orderId>
//
// Hardened (2026-09) — this endpoint must never undermine the secrecy of
// trackToken:
//  - Token shape allow-list (rejects junk/traversal input before it ever
//    reaches the database).
//  - Per-client rate limit (public endpoint, must stay cheap).
//  - trackToken is NEVER returned. A redirect strategy would be insecure:
//    serving the token to anyone who knows/guesses a predictable orderId
//    hands them the secret that protects the tokenized endpoint. The old
//    links keep working by degrading to a minimal, non-sensitive status
//    response instead.
//  - Minimal field whitelist — NO customer PII beyond a masked name, NO
//    phone/address/merchant, NO financial data, NO raw history entries
//    (raw actions contain amounts and internal notes).
//  - The timeline is produced by the exact same toCustomerMessage()
//    financial-filtering rules as the tokenized endpoint
//    (/api/track/<token>/<orderId>), so both public views agree.
// ──────────────────────────────────────────────

// OrderIds are short alphanumeric (e.g. "10007447", "2-0001", "C-10007447").
// Anything else (slashes, spaces, long blobs) is rejected up front.
const ORDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const throttled = rateLimitResponse("public-track", request, {
    limit: 30,
    windowMs: 60_000,
  });
  if (throttled) return throttled;

  const { token } = await params;

  if (!ORDER_ID_RE.test(token)) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { orderId: token },
      select: {
        orderId: true,
        customerName: true,
        location: true,
        updatedAt: true,
        createdAt: true,
        // Customer delivery actions (prefill for the tracking page's
        // "Delivery Assistance" card). Non-sensitive by design: the
        // values were supplied by the customer themselves.
        latitude: true,
        longitude: true,
        deliveryPreference: true,
        deliveryNotes: true,
        history: {
          select: {
            action: true,
            location: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Same customer-facing, financially-filtered timeline as the tokenized
    // endpoint. Raw history actions never leave the server.
    const timeline = order.history
      .map((h) => ({ message: toCustomerMessage(h), at: h.createdAt }))
      .filter(
        (e): e is {
          message: { status: string; detail: string | null };
          at: Date;
        } => e.message !== null,
      )
      .map(({ message, at }) => ({
        status: message.status,
        detail: message.detail,
        at,
      }));

    return NextResponse.json({
      orderId: order.orderId,
      customerName: publicName(order.customerName),
      status: currentStatusLabel(order.location),
      timeline,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      latitude: order.latitude,
      longitude: order.longitude,
      deliveryPreference: order.deliveryPreference,
      deliveryNotes: order.deliveryNotes,
    });
  } catch (error) {
    console.error("[GET /api/track/<token>] Error:", error);
    return NextResponse.json(
      { error: "Unable to load tracking information" },
      { status: 500 },
    );
  }
}

// ──────────────────────────────────────────────
// PATCH /api/track/<token>
//
// Customer delivery actions for the legacy (orderId-based) tracking page:
// drop-off coordinates, a delivery preference, and delivery notes.
//
// Capability model differs from the tokenized endpoint: here the orderId
// itself is the lookup key, so the write is scoped to exactly one order
// and rate-limited like the tokenized PATCH. Validation and the locked
// rule (no updates once DELIVERED/CANCELLED) come from lib/tracking.ts,
// shared with the tokenized endpoint so both behave identically.
// ──────────────────────────────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const throttled = rateLimitResponse("public-track-update", request, {
    limit: 10,
    windowMs: 60_000,
  });
  if (throttled) return throttled;

  const { token } = await params;

  if (!ORDER_ID_RE.test(token)) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !(body instanceof Object)
  ) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  }

  const parsed = parseDeliveryUpdate(body as Record<string, unknown>);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { orderId: token },
      select: { id: true, location: true },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const location = order.location.toUpperCase();
    if (LOCKED_DELIVERY_LOCATIONS.includes(location)) {
      return NextResponse.json(
        {
          error:
            "This order can no longer be updated because it has already been delivered or cancelled",
        },
        { status: 409 },
      );
    }

    // Guarded write: repeats the lock conditions in the WHERE clause so a
    // status change racing with this request still wins (count === 0 →
    // the order moved to a locked state).
    const result = await prisma.order.updateMany({
      where: {
        id: order.id,
        location: { notIn: LOCKED_DELIVERY_LOCATIONS },
      },
      data: parsed.data,
    });

    if (result.count === 0) {
      return NextResponse.json(
        {
          error:
            "This order can no longer be updated because it has already been delivered or cancelled",
        },
        { status: 409 },
      );
    }

    // Return the updated delivery details with the same public-view
    // policy as GET: no financial data, no raw history.
    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id },
      select: {
        orderId: true,
        location: true,
        latitude: true,
        longitude: true,
        deliveryPreference: true,
        deliveryNotes: true,
        updatedAt: true,
      },
    });

    if (!updatedOrder) {
      // Vanished between the guarded write and the re-read (deleted
      // concurrently). The write itself already succeeded.
      return NextResponse.json(
        { error: "Unable to load the updated order" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Delivery details updated successfully",
      order: {
        orderId: updatedOrder.orderId,
        status: currentStatusLabel(updatedOrder.location),
        latitude: updatedOrder.latitude,
        longitude: updatedOrder.longitude,
        deliveryPreference: updatedOrder.deliveryPreference,
        deliveryNotes: updatedOrder.deliveryNotes,
        updatedAt: updatedOrder.updatedAt,
      },
    });
  } catch (error) {
    console.error("[PATCH /api/track/<token>] Error:", error);
    return NextResponse.json(
      { error: "Unable to update delivery details" },
      { status: 500 },
    );
  }
}
