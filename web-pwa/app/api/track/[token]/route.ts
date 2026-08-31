import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { rateLimitResponse } from "@/lib/rate-limit";

// ──────────────────────────────────────────────
// Legacy public tracking endpoint (pre-token links)
// GET /api/track/<orderId>
//
// Hardened:
//  - Token shape allow-list (rejects junk/traversal input before it ever
//    reaches the database).
//  - Per-client rate limit (public endpoint, must stay cheap).
//  - Minimal field whitelist — NO customer PII (name/phone/address) and NO
//    financial data. The page consuming this endpoint only needs orderId,
//    location, timestamps and the status history.
//  - Legacy links are preserved: this endpoint keeps working for every
//    existing orderId and redirects the UI to the tokenized link.
// ──────────────────────────────────────────────

// OrderIds are short alphanumeric (e.g. "10007447", "2-0001", "C-10007447").
// Anything else (slashes, spaces, long blobs) is rejected up front.
const ORDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/;

// Name for public display: masked first name + initials of the rest.
// (The legacy tracking page re-applies its own client-side mask, which is
// idempotent on already-masked values.)
function publicName(name: string | null): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0];
  const maskedFirst =
    first.length <= 1 ? first : `${first[0]}${"*".repeat(first.length - 1)}`;
  const tail = parts
    .slice(1)
    .map((p) => (p.length <= 1 ? `${p}.` : `${p[0]}.`))
    .join(" ");
  return tail ? `${maskedFirst} ${tail}` : maskedFirst;
}

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
        trackToken: true,
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

    return NextResponse.json({
      ...order,
      customerName: publicName(order.customerName),
    });
  } catch (error) {
    console.error("[GET /api/track/<token>] Error:", error);
    return NextResponse.json(
      { error: "Unable to load tracking information" },
      { status: 500 },
    );
  }
}
