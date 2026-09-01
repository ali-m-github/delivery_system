import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  currentStatusLabel,
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
    });
  } catch (error) {
    console.error("[GET /api/track/<token>] Error:", error);
    return NextResponse.json(
      { error: "Unable to load tracking information" },
      { status: 500 },
    );
  }
}
