import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  currentStatusLabel,
  extractDriverNotes,
  parseDeliveryUpdate,
  publicName,
  publicPhone,
  toCustomerMessage,
  LOCKED_DELIVERY_LOCATIONS,
} from "@/lib/tracking";
import { rateLimitResponse } from "@/lib/rate-limit";

// ──────────────────────────────────────────────
// Public customer-facing tracking endpoint
// GET   /api/track/<token>/<orderId>
// PATCH /api/track/<token>/<orderId>  (customer delivery actions)
//
// Strict field whitelist — NO financial data (amounts, collected
// values, prices, financialStatus, treasury/statement info) is ever
// returned. The 8-digit token makes the link unguessable; the orderId
// is validated against the token so a leaked token alone can't be
// probed for other orders (and vice versa).
//
// Hardening (2026-08):
//  - Input shape allow-lists reject junk before any database access.
//  - Per-client rate limit keeps the public endpoint cheap.
//  - Customer PII is masked on the server (phone → last 4, name →
//    first name + initials) instead of shipping full PII to the page.
// ──────────────────────────────────────────────

// Track tokens have always been exactly 8 digits (10000000–99999999);
// orderIds are short alphanumeric (e.g. "10007447", "2-0001", "C-10007447").
const TRACK_TOKEN_RE = /^\d{8}$/;
const ORDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/;

// ──────────────────────────────────────────────
// Customer delivery actions (PATCH)
//
// The tracking token IS the capability: only someone holding the exact
// token + orderId pair for this order can update its delivery details.
// Updates are rejected once the order is delivered or cancelled, and
// the final write is guarded (updateMany with the same conditions) so
// a concurrent status change can't slip between the check and the
// write. Validation and the locked-location rule live in
// lib/tracking.ts, shared with any other public tracking surface.
// ──────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; orderId: string }> },
) {
  // Per-client throttle on the public endpoint (expensive: DB read +
  // history fan-out per request).
  const throttled = rateLimitResponse("public-track", request, {
    limit: 30,
    windowMs: 60_000,
  });
  if (throttled) return throttled;

  const { token, orderId } = await params;

  // Reject malformed shapes with the same generic 404 as a miss, so the
  // response never reveals which part of the link was wrong.
  if (!TRACK_TOKEN_RE.test(token) || !ORDER_ID_RE.test(orderId)) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { trackToken: token },
      select: {
        orderId: true,
        customerName: true,
        customerPhone: true,
        customerAddress: true,
        notes: true,
        location: true,
        deliveredAt: true,
        updatedAt: true,
        // Customer delivery actions (prefill for the tracking page's
        // "Delivery Assistance" card). Non-sensitive by design: the
        // values were supplied by the customer themselves.
        latitude: true,
        longitude: true,
        deliveryPreference: true,
        deliveryNotes: true,
        merchant: { select: { merchantName: true } },
        history: {
          select: { action: true, location: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    // One generic 404 for a bad token OR a token/orderId mismatch, so the
    // response never reveals which part of the link was wrong.
    if (!order || order.orderId !== orderId) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

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
      customerPhone: publicPhone(order.customerPhone),
      customerAddress: order.customerAddress,
      merchantName: order.merchant?.merchantName ?? null,
      status: currentStatusLabel(order.location),
      driverNotes: extractDriverNotes(order.notes),
      timeline,
      deliveredAt: order.deliveredAt,
      updatedAt: order.updatedAt,
      latitude: order.latitude,
      longitude: order.longitude,
      deliveryPreference: order.deliveryPreference,
      deliveryNotes: order.deliveryNotes,
    });
  } catch (error) {
    console.error("[GET /api/track/<token>/<orderId>] Error:", error);
    return NextResponse.json(
      { error: "Unable to load tracking information" },
      { status: 500 },
    );
  }
}

// ──────────────────────────────────────────────
// PATCH /api/track/<token>/<orderId>
//
// Customer delivery actions: update the drop-off coordinates, a
// delivery preference, and delivery notes for this specific order.
//
// Security model: the unguessable 8-digit trackToken combined with the
// orderId IS the authorization — the same capability that grants read
// access grants write access, and nothing else. No session/JWT is
// involved, so the update is scoped to exactly one order.
//
// Guards:
//  - Same input shape allow-lists and generic 404s as GET (never
//    reveals whether the token or the orderId was wrong).
//  - Stricter per-client rate limit than GET (this is a write).
//  - Rejected with 409 once the order is DELIVERED/CANCELLED. The
//    final updateMany repeats the location guard so a concurrent
//    status change cannot slip between the check and the write.
// ──────────────────────────────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; orderId: string }> },
) {
  const throttled = rateLimitResponse("public-track-update", request, {
    limit: 10,
    windowMs: 60_000,
  });
  if (throttled) return throttled;

  const { token, orderId } = await params;

  if (!TRACK_TOKEN_RE.test(token) || !ORDER_ID_RE.test(orderId)) {
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
    // Resolve the order by token and confirm the orderId matches —
    // identical capability check to GET, so only the recipient of this
    // specific order's link can update it.
    const order = await prisma.order.findUnique({
      where: { trackToken: token },
      select: { id: true, orderId: true, location: true },
    });

    if (!order || order.orderId !== orderId) {
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

    // Guarded write: repeats the token/orderId/lock conditions in the
    // WHERE clause so a status change racing with this request still
    // wins (count === 0 → the order moved to a locked state).
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
    console.error("[PATCH /api/track/<token>/<orderId>] Error:", error);
    return NextResponse.json(
      { error: "Unable to update delivery details" },
      { status: 500 },
    );
  }
}
