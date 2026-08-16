// ─── Zone Auto-Assignment Helper ───────────────────────────────────────────────
// Shared server-side logic that resolves the correct delivery zone for an order
// from the "already identified cities database" (the internal ZoneMapping table,
// populated from the master cities file / seed + training engine).
//
// When an order is moved from the CP (customer pickup) warehouse into the main
// warehouse, each order is matched against this database so it lands in the right
// zone. Addresses that cannot be matched are routed to the fallback zone "99".
//
// Matching hierarchy (mirrors the Auto-Assign route):
//   1. Exact Match        — normalized address equals a mapping exactly
//   2. Substring/Keyword  — the mapped city appears as an isolated word/phrase
//   3. Fuzzy Match        — similarityScore >= 0.82 (typos / close variants)
// If nothing matches → fallback zone "99".

import prisma from "@/lib/prisma";
import { normalizeAddress, similarityScore } from "@/lib/addressNormalizer";

const FUZZY_THRESHOLD = 0.82;
export const FALLBACK_ZONE_NAME = "99";

/**
 * Ensure the fallback zone "99" exists, returning its id.
 * Creates it on first use so there is always a valid fallback target.
 */
export async function ensureFallbackZone(): Promise<string> {
  let zone = await prisma.zone.findUnique({
    where: { name: FALLBACK_ZONE_NAME },
    select: { id: true },
  });
  if (!zone) {
    zone = await prisma.zone.create({
      data: { name: FALLBACK_ZONE_NAME },
      select: { id: true },
    });
  }
  return zone.id;
}

/**
 * Check if `haystack` contains `needle` as an isolated word/phrase.
 * Uses word-boundary regex to avoid partial matches (e.g. "tripoli"
 * matching inside "tripolitan").
 */
function containsIsolatedWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`);
  return regex.test(haystack);
}

/**
 * Resolve the delivery zone id for a raw customer address.
 * Returns the matched zone id, or the fallback zone "99" when no mapping exists.
 */
export async function resolveZoneForAddress(
  address: string,
): Promise<string> {
  const fallbackZoneId = await ensureFallbackZone();
  const normalized = normalizeAddress(address || "");
  if (!normalized) return fallbackZoneId;

  // ── 1. Fetch verified city mappings (the "cities database") ────────────
  const verifiedMappings = await prisma.zoneMapping.findMany({
    where: { isVerified: true },
    select: { normalizedAddress: true, zoneId: true },
  });

  // ── 1b. Drop mappings that point to deleted zones ───────────────────────
  const validZoneIds = new Set(
    (await prisma.zone.findMany({ select: { id: true } })).map((z) => z.id),
  );
  const validMappings = verifiedMappings.filter((m) =>
    validZoneIds.has(m.zoneId),
  );

  if (validMappings.length === 0) return fallbackZoneId;

  // ── 2. Longer (more specific) city names first ─────────────────────────
  const sortedMappings = [...validMappings].sort(
    (a, b) => b.normalizedAddress.length - a.normalizedAddress.length,
  );

  // Exact-match lookup map
  const exactMatchMap = new Map(
    sortedMappings.map((m) => [m.normalizedAddress, m.zoneId]),
  );

  // ── Tier 1: Exact Match ─────────────────────────────────────────────────
  const exactZoneId = exactMatchMap.get(normalized);
  if (exactZoneId) return exactZoneId;

  // ── Tier 2: Substring / Keyword Match ──────────────────────────────────
  for (const mapping of sortedMappings) {
    if (containsIsolatedWord(normalized, mapping.normalizedAddress)) {
      return mapping.zoneId;
    }
  }

  // ── Tier 3: Fuzzy Match Fallback ───────────────────────────────────────
  let bestScore = 0;
  let bestZoneId = "";
  for (const mapping of sortedMappings) {
    const score = similarityScore(normalized, mapping.normalizedAddress);
    if (score > bestScore) {
      bestScore = score;
      bestZoneId = mapping.zoneId;
    }
    // Early exit on perfect match during scanning
    if (bestScore >= 1.0) break;
  }

  if (bestScore >= FUZZY_THRESHOLD && bestZoneId) return bestZoneId;

  // ── No match → fallback zone "99" ──────────────────────────────────────
  return fallbackZoneId;
}
