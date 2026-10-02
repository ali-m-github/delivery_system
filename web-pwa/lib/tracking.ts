import { randomInt } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const TRACKING_BASE =
  process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

/**
 * Generate a cryptographically random 8-digit token (10000000–99999999).
 *
 * Uses `crypto.randomInt` (CSPRNG, unbiased) instead of `Math.random` so
 * issued tokens cannot be predicted from previously observed ones.
 *
 * Compatibility: the token is still exactly 8 digits (same shape as every
 * existing token in the database), so all existing tracking links
 * `/track/<token>/<orderId>` continue to work unchanged — no migration or
 * invalidation is needed. New orders simply get an unguessable token.
 */
export function randomTrackToken(): string {
  return String(10000000 + randomInt(0, 90000000));
}

/**
 * Generate a single DB-unique 8-digit tracking token for an order.
 */
export async function generateTrackToken(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const token = randomTrackToken();
    const existing = await prisma.order.findUnique({
      where: { trackToken: token },
      select: { id: true },
    });
    if (!existing) return token;
  }
  // Extremely unlikely: fall back to a crypto-random token with the same
  // 8-digit shape (never a timestamp — that was guessable).
  const fallback = (10000000 + randomInt(0, 90000000)).toString();
  const existing = await prisma.order.findUnique({
    where: { trackToken: fallback },
    select: { id: true },
  });
  if (!existing) return fallback;
  // Collision after 11 draws of a 90M space: surface loudly instead of
  // returning a duplicate token.
  throw new Error("Could not generate a unique tracking token");
}

/**
 * Generate `count` unique 8-digit tracking tokens in one batch
 * (for createMany imports). Dedupes in-batch and pre-checks DB collisions.
 */
export async function generateTrackTokens(count: number): Promise<string[]> {
  const pool = new Set<string>();
  let guard = 0;
  while (pool.size < count && guard < count * 50) {
    pool.add(randomTrackToken());
    guard++;
  }

  let candidates = [...pool];
  for (let round = 0; round < 5; round++) {
    const taken = await prisma.order.findMany({
      where: { trackToken: { in: candidates } },
      select: { trackToken: true },
    });
    if (taken.length === 0) break;
    const takenSet = new Set(taken.map((t) => t.trackToken!));
    // Replace colliding tokens with fresh ones.
    let innerGuard = 0;
    for (const colliding of takenSet) {
      pool.delete(colliding);
      while (innerGuard < 100) {
        const fresh = randomTrackToken();
        if (!pool.has(fresh) && !takenSet.has(fresh)) {
          pool.add(fresh);
          break;
        }
        innerGuard++;
      }
    }
    candidates = [...pool];
  }

  return candidates.slice(0, count);
}

/**
 * Build the public tracking URL: /track/<token>/<orderId>
 * Falls back to the legacy /track/<orderId> path when no token exists.
 */
export function buildTrackingUrl(orderId: string, trackToken?: string | null): string {
  if (trackToken) return `${TRACKING_BASE}/track/${trackToken}/${orderId}`;
  return `${TRACKING_BASE}/track/${orderId}`;
}

/**
 * Extract driver notes from an order's notes field.
 * Driver notes are stored as lines prefixed with "[DRIVER NOTE] ".
 */
export function extractDriverNotes(notes: string | null | undefined): string[] {
  if (!notes) return [];
  const out: string[] = [];
  for (const line of notes.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/^\[DRIVER NOTE\]\s*(.*)$/i);
    if (match && match[1]) out.push(match[1]);
  }
  return out;
}

// ──────────────────────────────────────────────
// Public tracking response helpers (shared)
//
// The tokenized endpoint (/api/track/<token>/<orderId>) is the secure
// source of public order detail. The legacy endpoint (/api/track/<orderId>)
// must apply the exact same PII masking and financial filtering — these
// helpers are the single implementation used by both endpoints.
// ──────────────────────────────────────────────

/** Phone number for public display: keep only the last 4 digits. */
export function publicPhone(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `•••• ${digits.slice(-4)}`;
}

/**
 * Name for public display: masked first name + initials of the rest
 * (e.g. "John Doe Smith" → "J*** D. S.").
 */
export function publicName(name: string | null): string {
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

/**
 * True when a history action contains money/treasury information.
 * Mirrors the legacy customer view's skip rule (Price / Collected /
 * LL / USD), with a couple of extra safety nets.
 */
export function isFinancial(text: string): boolean {
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

/**
 * Customer-friendly mapping of a raw history entry. Returns null for
 * entries that must be hidden from the public timeline (financials).
 */
export function toCustomerMessage(entry: {
  action: string;
  location: string | null;
}): { status: string; detail: string | null } | null {
  const action = entry.action;
  const loc = entry.location?.toUpperCase() ?? "";

  // Location / status changes
  if (loc === "WAREHOUSE" || action.includes("Order Created"))
    return { status: "Order received", detail: "At our warehouse" };
  if (loc === "ASSIGNED" || loc === "ASSIGNED_TR")
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
    if (loc === "ASSIGNED" || loc === "ASSIGNED_TR" || loc === "WITH_DRIVER")
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

/** Customer-friendly label for an order's current location. */
export function currentStatusLabel(location: string): string {
  const loc = location.toUpperCase();
  if (loc === "DELIVERED") return "Delivered";
  if (loc === "RETURN" || loc === "RETURNED" || loc === "RTS")
    return "Returned";
  if (loc === "ASSIGNED" || loc === "ASSIGNED_TR" || loc === "WITH_DRIVER")
    return "With delivery courier";
  if (loc === "POSTPONED") return "Postponed";
  if (loc === "CP") return "Preparing for dispatch";
  return "At warehouse";
}
