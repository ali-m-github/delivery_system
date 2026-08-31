import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { extractDriverNotes } from "@/lib/tracking";
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

// Phone number for public display: keep only the last 4 digits.
function publicPhone(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `•••• ${digits.slice(-4)}`;
}

// Name for public display: masked first name + initials of the rest
// (matches what the legacy tracking page rendered client-side).
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

// True when a history action contains money/treasury information.
// Mirrors the legacy customer view's skip rule (Price / Collected /
// LL / USD), with a couple of extra safety nets.
function isFinancial(text: string): boolean {
  return (
    text.includes("Price") ||
    text.includes("Collected") ||
    text.includes("LL") ||
    text.includes("USD") ||
    /\$\s?\d/.test(text) ||
    /price/i.test(text) ||
    /collected/i.test(text) ||
    /\busd\b/i.test(text)
  );
}

// Customer-friendly mapping of a raw history entry. Returns null for
// entries that must be hidden from the public timeline (financials).
function toCustomerMessage(entry: {
  action: string;
  location: string | null;
}): { status: string; detail: string | null } | null {
  const action = entry.action;
  const loc = entry.location?.toUpperCase() ?? "";

  // Location / status changes
  if (loc === "WAREHOUSE" || action.includes("Order Created"))
    return { status: "Order received", detail: "At our warehouse" };
  if (loc === "ASSIGNED")
    return { status: "With delivery courier", detail: null };
  if (loc === "WITH_DRIVER")
    return { status: "With delivery courier", detail: "Out for delivery" };
  if (loc === "DELIVERED") return { status: "Delivered", detail: null };
  if (loc === "RETURN" || loc === "RETURNED")
    return { status: "Return requested", detail: null };
  if (loc === "RTS") return { status: "Returned to sender", detail: null };

  // Action-based mapping
  if (action.includes("Assigned") || action.includes("assigned"))
    return { status: "With delivery courier", detail: null };
  if (action.includes("picked") || action.includes("Picked"))
    return { status: "Picked up", detail: null };
  if (action.includes("dispatch") || action.includes("Dispatch"))
    return { status: "Dispatched", detail: null };

  // Financial / treasury entries — never shown publicly
  if (isFinancial(action)) return null;

  // Note changes
  if (action.includes("Note")) return { status: "Note added", detail: null };

  // Generic location change
  if (action.includes("Location changed")) {
    if (loc === "WAREHOUSE")
      return { status: "Order received", detail: "At our warehouse" };
    if (loc === "ASSIGNED" || loc === "WITH_DRIVER")
      return { status: "With delivery courier", detail: null };
    if (loc === "DELIVERED") return { status: "Delivered", detail: null };
    if (loc === "RETURN" || loc === "RETURNED")
      return { status: "Return requested", detail: null };
    if (loc === "RTS") return { status: "Returned to sender", detail: null };
    return { status: "Status updated", detail: null };
  }

  // Fallback: clean up raw action text; hide anything still financial
  const cleaned = action
    .replace(/Location changed to /, "")
    .replace(/Assigned to Driver/, "")
    .replace(/->/g, "→")
    .trim();
  if (!cleaned || isFinancial(cleaned)) return null;
  return { status: cleaned, detail: null };
}

function currentStatusLabel(location: string): string {
  const loc = location.toUpperCase();
  if (loc === "DELIVERED") return "Delivered";
  if (loc === "RETURN" || loc === "RETURNED" || loc === "RTS")
    return "Returned";
  if (loc === "ASSIGNED" || loc === "WITH_DRIVER")
    return "With delivery courier";
  if (loc === "POSTPONED") return "Postponed";
  if (loc === "CP") return "Preparing for dispatch";
  return "At warehouse";
}

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
