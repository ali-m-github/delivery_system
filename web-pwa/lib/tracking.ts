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
