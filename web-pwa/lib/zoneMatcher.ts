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
 * Everything zone matching needs, loaded ONCE from the database: the
 * fallback zone id, the verified city mappings (already sorted longest-first
 * and filtered to existing zones), and an exact-match lookup map. Build it
 * once per request (e.g. a bulk move-from-cp) and answer any number of
 * per-address questions from it with zero further DB queries.
 */
export interface ZoneMatchContext {
  fallbackZoneId: string;
  /** Verified mappings, sorted by normalizedAddress length (desc). */
  mappings: { normalizedAddress: string; zoneId: string }[];
  /** normalizedAddress → zoneId for tier-1 exact matches. */
  exactMatchMap: Map<string, string>;
}

/**
 * One-time load of the matching data (fallback zone + verified mappings +
 * zone filter). Replaces the historical per-address 3-query pattern with a
 * single parallel load; matching semantics are unchanged.
 */
export async function createZoneMatchContext(): Promise<ZoneMatchContext> {
  const [fallbackZoneId, verifiedMappings, zones] = await Promise.all([
    ensureFallbackZone(),
    // Verified city mappings (the "cities database")
    prisma.zoneMapping.findMany({
      where: { isVerified: true },
      select: { normalizedAddress: true, zoneId: true },
    }),
    // Drop mappings that point to deleted zones
    prisma.zone.findMany({ select: { id: true } }),
  ]);

  const validZoneIds = new Set(zones.map((z) => z.id));
  const validMappings = verifiedMappings.filter((m) =>
    validZoneIds.has(m.zoneId),
  );

  // Longer (more specific) city names first — same ordering the per-address
  // resolver historically used (stable sort, DB order ties).
  const mappings = [...validMappings].sort(
    (a, b) => b.normalizedAddress.length - a.normalizedAddress.length,
  );

  return {
    fallbackZoneId,
    mappings,
    exactMatchMap: new Map(mappings.map((m) => [m.normalizedAddress, m.zoneId])),
  };
}

/**
 * Pure in-memory zone resolution against a pre-loaded context — no DB
 * access. Tier order is exactly the documented hierarchy:
 * exact → isolated phrase → fuzzy >= threshold → fallback zone "99".
 */
export function matchZoneInContext(
  ctx: ZoneMatchContext,
  address: string,
): string {
  const normalized = normalizeAddress(address || "");
  if (!normalized || ctx.mappings.length === 0) return ctx.fallbackZoneId;

  // ── Tier 1: Exact Match ─────────────────────────────────────────────────
  const exactZoneId = ctx.exactMatchMap.get(normalized);
  if (exactZoneId) return exactZoneId;

  // ── Tier 2: Substring / Keyword Match ──────────────────────────────────
  for (const mapping of ctx.mappings) {
    if (containsIsolatedWord(normalized, mapping.normalizedAddress)) {
      return mapping.zoneId;
    }
  }

  // ── Tier 3: Fuzzy Match Fallback ───────────────────────────────────────
  let bestScore = 0;
  let bestZoneId = "";
  for (const mapping of ctx.mappings) {
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
  return ctx.fallbackZoneId;
}

/**
 * Resolve the delivery zone id for a raw customer address.
 * Returns the matched zone id, or the fallback zone "99" when no mapping
 * exists. Pass a pre-loaded {@link ZoneMatchContext} to skip the DB load
 * (built via {@link createZoneMatchContext}).
 */
export async function resolveZoneForAddress(
  address: string,
  ctx?: ZoneMatchContext,
): Promise<string> {
  const context = ctx ?? (await createZoneMatchContext());
  return matchZoneInContext(context, address);
}

/**
 * Batch version for bulk flows (e.g. move-from-cp): ONE context load for N
 * addresses instead of 3 queries per address. Returns address → zoneId.
 */
export async function resolveZonesForAddresses(
  addresses: string[],
): Promise<Map<string, string>> {
  const ctx = await createZoneMatchContext();
  const zones = new Map<string, string>();
  for (const address of addresses) {
    zones.set(address, matchZoneInContext(ctx, address));
  }
  return zones;
}
