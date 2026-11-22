/**
 * Merchant shipping-rate resolution (single source of truth).
 *
 * A merchant is charged per order via MerchantRateRule rows: a rate (USD + LBP)
 * applied to a SPAN of zones (inclusive numeric zone-name range, e.g. 2–9) for
 * orders created on/after `effectiveFrom`. This lets an admin set e.g.
 * "zones 2–9 → $2.50 from 2026-11-01" and later "zones 2–9 → $3.00 from
 * 2027-01-01" without restating historical orders.
 *
 * Precedence for an order (non-cash sellers only — cash sellers keep their
 * flat defaultSellerRate + defaultProfitRate fee):
 *   1. Matching rules: zoneFrom <= numeric(zoneName) <= zoneTo AND
 *      orderCreatedAt >= rule.effectiveFrom.
 *      Winner: latest effectiveFrom → narrower range → latest createdAt.
 *   2. No matching rule (or non-numeric zone name): the UNIVERSAL zone price
 *      (Zone.basePriceUsd / Zone.basePriceLbp).
 *
 * Keying on order.createdAt means historical orders keep the rate that was in
 * force when they were received.
 *
 * The resolvers here are PURE (no Prisma inside) so server routes, server
 * components and client components all compute IDENTICAL figures — money math
 * must never be re-implemented inline in a page (project money rule).
 */
import { prisma } from "@/lib/prisma";

/** Shape of a MerchantRateRule row (subset; also matches serialized props). */
export interface MerchantRateRuleLike {
  id?: string;
  zoneFrom: number;
  zoneTo: number;
  rate: number; // USD
  rateLbp: number;
  effectiveFrom: Date | string;
  createdAt?: Date | string;
}

/** Universal (fallback) price carried on Zone. */
export interface ZoneBasePriceLike {
  basePriceUsd?: number | null;
  basePriceLbp?: number | null;
}

export interface ResolvedMerchantRate {
  usd: number;
  lbp: number;
  /** Which tier produced this figure (for debug/audit display). */
  matched: "rule" | "universal";
  /** The winning rule, when matched === "rule". */
  rule?: MerchantRateRuleLike;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parse the numeric zone key from a zone name. Zones are named "0", "2", "9",
 * "99" (the fallback zone, see lib/zoneMatcher.ts); SUBZONES carry a letter
 * suffix ("14B" = subzone of 14) and count as their parent number, so a rule
 * covering zones 10-20 also prices zone "14B". Zone names that do not start
 * with a number never match a rule and fall back to the universal price.
 */
export function parseZoneNumber(zoneName: string | null | undefined): number | null {
  if (!zoneName) return null;
  const trimmed = String(zoneName).trim();
  const match = /^(\d+)(?:\s*[A-Za-z]?)$/.exec(trimmed);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pure resolver: pick the rate for one order from a merchant's rules.
 * `zoneName` is Zone.name; `zoneBase` is the universal price used when no
 * rule matches. All money values coerce via Number() || 0.
 */
export function resolveMerchantShippingRate(
  rules: MerchantRateRuleLike[],
  zoneName: string | null | undefined,
  zoneBase: ZoneBasePriceLike | null | undefined,
  orderCreatedAt: Date | string,
): ResolvedMerchantRate {
  const universal = (): ResolvedMerchantRate => ({
    usd: Number(zoneBase?.basePriceUsd) || 0,
    lbp: Number(zoneBase?.basePriceLbp) || 0,
    matched: "universal",
  });

  const zoneNum = parseZoneNumber(zoneName);
  if (zoneNum === null) return universal();

  const createdAt = toDate(orderCreatedAt);
  if (createdAt === null) return universal();

  const matching = (rules || []).filter((r) => {
    const from = toDate(r.effectiveFrom);
    if (from === null) return false;
    return (
      Number(r.zoneFrom) <= zoneNum &&
      zoneNum <= Number(r.zoneTo) &&
      createdAt.getTime() >= from.getTime()
    );
  });

  if (matching.length === 0) return universal();

  // Winner: latest effectiveFrom → narrower range → latest createdAt.
  matching.sort((a, b) => {
    const ea = toDate(a.effectiveFrom)!.getTime();
    const eb = toDate(b.effectiveFrom)!.getTime();
    if (eb !== ea) return eb - ea;
    const spanA = Number(a.zoneTo) - Number(a.zoneFrom);
    const spanB = Number(b.zoneTo) - Number(b.zoneFrom);
    if (spanA !== spanB) return spanA - spanB;
    const ca = toDate(a.createdAt)?.getTime() ?? 0;
    const cb = toDate(b.createdAt)?.getTime() ?? 0;
    return cb - ca;
  });

  const winner = matching[0];
  return {
    usd: Number(winner.rate) || 0,
    lbp: Number(winner.rateLbp) || 0,
    matched: "rule",
    rule: winner,
  };
}

/**
 * Load a merchant's rate rules with one query. Accepts a plain Prisma client
 * or an interactive-transaction client so statement creation can resolve
 * inside its transaction.
 */
export async function loadMerchantRateRules(
  merchantId: string,
  client: PrismaClientLike = prisma,
): Promise<MerchantRateRuleLike[]> {
  const rows = await client.merchantRateRule.findMany({
    where: { merchantId },
  });
  return rows.map((r) => ({
    id: r.id,
    zoneFrom: r.zoneFrom,
    zoneTo: r.zoneTo,
    rate: r.rate,
    rateLbp: r.rateLbp,
    effectiveFrom: r.effectiveFrom,
    createdAt: r.createdAt,
  }));
}

/** Minimal structural type so both `prisma` and `tx` clients are accepted. */
type PrismaClientLike = {
  merchantRateRule: {
    findMany: (args: {
      where: { merchantId: string };
    }) => Promise<
      {
        id: string;
        zoneFrom: number;
        zoneTo: number;
        rate: number;
        rateLbp: number;
        effectiveFrom: Date;
        createdAt: Date;
      }[]
    >;
  };
};
