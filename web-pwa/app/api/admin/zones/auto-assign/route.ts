import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { normalizeAddress, similarityScore } from "@/lib/addressNormalizer";
import { requireServerPermission } from "@/lib/server-permissions";

const FUZZY_THRESHOLD = 0.82;

/**
 * POST /api/admin/zones/auto-assign
 *
 * Scans orders assigned to a default/unassigned zone (specified by `defaultZoneId`)
 * and attempts to re-assign them to the correct zone using verified ZoneMapping records.
 *
 * Request body: { defaultZoneId: string }
 *
 * Matching hierarchy (in order, per order):
 * 1. Exact Match: normalizedOrderAddress === mapping.normalizedAddress
 * 2. Substring/Keyword Match: order address contains the known city as an
 *    isolated word/phrase using word-boundary regex.
 * 3. Fuzzy Match (Fallback): similarityScore >= 0.82 for minor spelling typos.
 *
 * ZoneMapping records are sorted by normalizedAddress length descending
 * so longer (more specific) city names match before shorter ones.
 *
 * Returns: { totalOrdersScanned, assignedCount, unassignedCount, unassignedOrders }
 */
export async function POST(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_ZONES");
  if (auth instanceof Response) return auth;
  try {
    const body = await request.json();
    const { defaultZoneId } = body;

    console.log(
      "[AUTO-ASSIGN] Received request with defaultZoneId:",
      defaultZoneId,
    );

    if (!defaultZoneId || typeof defaultZoneId !== "string") {
      return NextResponse.json(
        {
          error:
            "defaultZoneId is required. Provide the zone ID that represents 'unassigned' orders.",
        },
        { status: 400 },
      );
    }

    // ── DEBUG: Check distinct location values in the database ──────────
    const locationStats = await prisma.order.groupBy({
      by: ["location"],
      where: { zoneId: defaultZoneId, isArchived: false },
      _count: true,
    });
    console.log(
      "[AUTO-ASSIGN] Location distribution for default zone:",
      JSON.stringify(locationStats),
    );

    // ── 1. Fetch active orders in the default zone ────────────────────
    // "Active" = not archived, not delivered/returned (i.e., still in pipeline)
    const orders = await prisma.order.findMany({
      where: {
        zoneId: defaultZoneId,
        isArchived: false,
        location: { in: ["WAREHOUSE", "WITH_DRIVER"] },
      },
      select: {
        id: true,
        orderId: true,
        customerAddress: true,
        zoneId: true,
        location: true,
      },
    });

    console.log(
      `[AUTO-ASSIGN] Found ${orders.length} active orders in default zone`,
    );

    if (orders.length === 0) {
      return NextResponse.json(
        {
          totalOrdersScanned: 0,
          assignedCount: 0,
          unassignedCount: 0,
          unassignedOrders: [],
          message: "No active orders found in the specified default zone.",
        },
        { status: 200 },
      );
    }

    // ── 2. Fetch all verified ZoneMapping records ─────────────────────
    const verifiedMappings = await prisma.zoneMapping.findMany({
      where: { isVerified: true },
      select: {
        normalizedAddress: true,
        zoneId: true,
      },
    });

    // ── DEBUG: Check total vs verified mappings ────────────────────────
    const totalMappings = await prisma.zoneMapping.count();
    const verifiedCount = verifiedMappings.length;
    console.log(
      `[AUTO-ASSIGN] ZoneMappings: ${verifiedCount} verified out of ${totalMappings} total`,
    );

    // ── 2b. Filter out stale mappings pointing to deleted zones ────────
    const validZoneIds = new Set(
      await prisma.zone
        .findMany({ select: { id: true } })
        .then((zones) => zones.map((z) => z.id)),
    );
    const staleCount = verifiedMappings.filter(
      (m) => !validZoneIds.has(m.zoneId),
    ).length;
    if (staleCount > 0) {
      console.log(
        `[AUTO-ASSIGN] WARNING: ${staleCount} verified mappings reference deleted zones — skipping them`,
      );
    }
    const validMappings = verifiedMappings.filter((m) =>
      validZoneIds.has(m.zoneId),
    );

    if (validMappings.length === 0) {
      const reason =
        verifiedMappings.length === 0
          ? "No verified zone mappings exist yet. Train the engine first."
          : "All verified mappings reference deleted zones. Re-seed or re-train.";
      const unassignedOrders = orders.map((o) => ({
        id: o.id,
        orderId: o.orderId,
        address: o.customerAddress,
        reason,
      }));

      return NextResponse.json(
        {
          totalOrdersScanned: orders.length,
          assignedCount: 0,
          unassignedCount: orders.length,
          unassignedOrders,
        },
        { status: 200 },
      );
    }

    // ── 3. Sort mappings by normalizedAddress length descending ──────
    //     Longer (more specific) strings first: "zgharta main" before "zgharta"
    const sortedMappings = [...validMappings].sort(
      (a, b) => b.normalizedAddress.length - a.normalizedAddress.length,
    );

    // Build exact-match map (still useful for O(1) lookup)
    const exactMatchMap = new Map(
      sortedMappings.map((m) => [m.normalizedAddress, m.zoneId]),
    );

    // Array form for substring and fuzzy scanning
    const candidates = sortedMappings.map((m) => ({
      normalized: m.normalizedAddress,
      zoneId: m.zoneId,
    }));

    /**
     * Check if `haystack` contains `needle` as an isolated word/phrase.
     * Uses word-boundary regex to avoid partial matches like "tripoli"
     * matching inside "tripolitan".
     */
    function containsIsolatedWord(haystack: string, needle: string): boolean {
      // Escape special regex characters in the needle
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`);
      return regex.test(haystack);
    }

    // ── 4. Match and assign ───────────────────────────────────────────
    let assignedCount = 0;
    const unassignedOrders: {
      id: string;
      orderId: string;
      address: string;
      reason?: string;
    }[] = [];

    for (const order of orders) {
      const normalized = normalizeAddress(order.customerAddress);

      // ── DEBUG: Log normalization for first few orders ────────────────
      if (orders.indexOf(order) < 3) {
        console.log(
          `[AUTO-ASSIGN] Order ${order.orderId}: raw="${order.customerAddress}" -> normalized="${normalized}"`,
        );
      }

      if (!normalized) {
        unassignedOrders.push({
          id: order.id,
          orderId: order.orderId,
          address: order.customerAddress,
          reason: "Address could not be normalized (empty after processing).",
        });
        continue;
      }

      let matchedZoneId = "";
      let matchMethod = "";
      let debugBestScore = 0;

      // ── Tier 1: Exact Match
      const exactZoneId = exactMatchMap.get(normalized);
      if (exactZoneId) {
        matchedZoneId = exactZoneId;
        matchMethod = "exact";
      }

      // ── Tier 2: Substring/Keyword Match
      if (!matchedZoneId) {
        for (const candidate of candidates) {
          if (containsIsolatedWord(normalized, candidate.normalized)) {
            matchedZoneId = candidate.zoneId;
            matchMethod = "substring";
            break;
          }
        }
      }

      // ── Tier 3: Fuzzy Match Fallback
      if (!matchedZoneId) {
        let bestScore = 0;
        let bestZoneId = "";

        for (const candidate of candidates) {
          const score = similarityScore(normalized, candidate.normalized);
          if (score > bestScore) {
            bestScore = score;
            bestZoneId = candidate.zoneId;
          }
          // Early exit on perfect match during scanning
          if (bestScore >= 1.0) break;
        }

        debugBestScore = bestScore;

        if (bestScore >= FUZZY_THRESHOLD && bestZoneId) {
          matchedZoneId = bestZoneId;
          matchMethod = "fuzzy";
        }
      }

      // ── DEBUG: Log match result for first few orders ────────────────
      if (orders.indexOf(order) < 3) {
        console.log(
          `[AUTO-ASSIGN] Order ${order.orderId}: matched=${!!matchedZoneId}, method=${matchMethod || "none"}, bestFuzzyScore=${debugBestScore}`,
        );
      }

      // ── Apply assignment if matched ────────────────────────────────
      if (matchedZoneId) {
        await prisma.order.update({
          where: { id: order.id },
          data: { zoneId: matchedZoneId },
        });
        assignedCount++;
      } else {
        unassignedOrders.push({
          id: order.id,
          orderId: order.orderId,
          address: order.customerAddress,
          reason:
            debugBestScore > 0
              ? `No match found. Best fuzzy score: ${debugBestScore.toFixed(3)} (threshold: ${FUZZY_THRESHOLD}).`
              : "No match found via exact, substring, or fuzzy methods.",
        });
      }
    }

    const unassignedCount = unassignedOrders.length;

    return NextResponse.json(
      {
        totalOrdersScanned: orders.length,
        assignedCount,
        unassignedCount,
        unassignedOrders,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("[POST /api/admin/zones/auto-assign] Error:", error);
    return NextResponse.json(
      {
        error: "Auto-assignment failed",
      },
      { status: 500 },
    );
  }
}
