/**
 * Ad-hoc verification for lib/merchantRates.ts pure resolver.
 * Run: npx ts-node --compilerOptions '{"module":"commonjs"}' scripts/verify-merchant-rates.ts
 */
// Resolve the project's "@/..." alias for plain ts-node (tsconfig has no baseUrl).
const path = require("path");
const Module = require("module");
const origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...rest: any[]) {
  if (typeof request === "string" && request.startsWith("@/")) {
    request = path.join(__dirname, "..", request.slice(2));
  }
  return origResolve.call(this, request, ...rest);
};

import { resolveMerchantShippingRate } from "../lib/merchantRates";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const rules = [
  // zones 2-9, $2.50 from 2026-11-01
  { zoneFrom: 2, zoneTo: 9, rate: 2.5, rateLbp: 0, effectiveFrom: "2026-11-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" },
  // zones 2-9, $3.00 from 2027-01-01 (supersedes for newer orders)
  { zoneFrom: 2, zoneTo: 9, rate: 3.0, rateLbp: 0, effectiveFrom: "2027-01-01T00:00:00Z", createdAt: "2026-12-01T00:00:00Z" },
  // zones 10-20, $4.00 from 2026-01-01
  { zoneFrom: 10, zoneTo: 20, rate: 4.0, rateLbp: 100000, effectiveFrom: "2026-01-01T00:00:00Z", createdAt: "2025-12-01T00:00:00Z" },
  // narrow rule inside 2-9: zone 5 only, $1.00, same date as first rule (narrower wins)
  { zoneFrom: 5, zoneTo: 5, rate: 1.0, rateLbp: 0, effectiveFrom: "2026-11-01T00:00:00Z", createdAt: "2026-10-15T00:00:00Z" },
];

const zoneBase = { basePriceUsd: 6, basePriceLbp: 300000 };

// 1. Zone 5 order on 2026-11-15 → narrow rule ($1.00) beats wide 2-9 rule (same effective date)
check(
  "zone 5 @2026-11-15 → narrow rule $1.00",
  resolveMerchantShippingRate(rules, "5", zoneBase, "2026-11-15T12:00:00Z").usd,
  1.0,
);
// 2. Zone 4 order on 2026-11-15 → wide 2-9 rule $2.50
check(
  "zone 4 @2026-11-15 → $2.50",
  resolveMerchantShippingRate(rules, "4", zoneBase, "2026-11-15T12:00:00Z").usd,
  2.5,
);
// 3. Zone 4 order on 2027-02-01 → newer rate $3.00 wins
check(
  "zone 4 @2027-02-01 → $3.00",
  resolveMerchantShippingRate(rules, "4", zoneBase, "2027-02-01T00:00:01Z").usd,
  3.0,
);
// 4. Zone 4 order on 2026-10-31 → before any effective date → universal $6
check(
  "zone 4 @2026-10-31 → universal $6",
  resolveMerchantShippingRate(rules, "4", zoneBase, "2026-10-31T23:59:59Z").matched,
  "universal",
);
// 5. Zone 15 order → rule with LBP
const z15 = resolveMerchantShippingRate(rules, "15", zoneBase, "2026-06-01T00:00:00Z");
check("zone 15 → $4.00", z15.usd, 4.0);
check("zone 15 → LBP 100000", z15.lbp, 100000);
// 6. Zone 1 (outside all rules) → universal
check(
  "zone 1 → universal",
  resolveMerchantShippingRate(rules, "1", zoneBase, "2026-06-01T00:00:00Z").matched,
  "universal",
);
// 7. Non-numeric zone name → universal
check(
  "zone 'BEIRUT' → universal",
  resolveMerchantShippingRate(rules, "BEIRUT", zoneBase, "2026-06-01T00:00:00Z").matched,
  "universal",
);
// 8. Empty rules → universal
check(
  "no rules → universal",
  resolveMerchantShippingRate([], "5", zoneBase, "2026-06-01T00:00:00Z").usd,
  6,
);
// 9. Boundary: order exactly at effectiveFrom → rule applies
check(
  "zone 4 exactly at effectiveFrom → rule",
  resolveMerchantShippingRate(rules, "4", zoneBase, "2026-11-01T00:00:00Z").matched,
  "rule",
);
// 10. Subzone: "14B" counts as zone 14 (inside the 10-20 rule)
check(
  "zone '14B' → rule $4.00",
  resolveMerchantShippingRate(rules, "14B", zoneBase, "2026-06-01T00:00:00Z").usd,
  4.0,
);
// 11. Subzone outside all ranges: "1B" → parent 1 → universal
check(
  "zone '1B' → universal",
  resolveMerchantShippingRate(rules, "1B", zoneBase, "2026-06-01T00:00:00Z").matched,
  "universal",
);
// 12. Zone "0" is valid: rule 0-1, $0.50
check(
  "zone 0 with rule 0-1 → $0.50",
  resolveMerchantShippingRate(
    [{ zoneFrom: 0, zoneTo: 1, rate: 0.5, rateLbp: 0, effectiveFrom: "2026-01-01T00:00:00Z" }],
    "0",
    zoneBase,
    "2026-06-01T00:00:00Z",
  ).usd,
  0.5,
);
// 13. Truly non-numeric names still never match
check(
  "zone '14XZ' (multi-suffix) → universal",
  resolveMerchantShippingRate(rules, "14XZ", zoneBase, "2026-06-01T00:00:00Z").matched,
  "universal",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
