import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  currentStatusLabel,
  extractDriverNotes,
  publicName,
  publicPhone,
  toCustomerMessage,
} from "@/lib/tracking";
import { rateLimitResponse } from "@/lib/rate-limit";

// ──────────────────────────────────────────────
// Public customer-facing tracking endpoint
// GET /api/track/<token>/<orderId>
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
    });
  } catch (error) {
    console.error("[GET /api/track/<token>/<orderId>] Error:", error);
    return NextResponse.json(
      { error: "Unable to load tracking information" },
      { status: 500 },
    );
  }
}
