/**
 * verify-commission.ts — Verification for the unified driver commission module
 * (lib/commission.ts).
 *
 * Part A — Pure unit cases (no database):
 *   1. Seller exception        (DriverSellerRate overrides zone)
 *   2. Cash-seller exception   (DriverCashSellerRate wins over standard)
 *   3. $0 exception            (valid override — never falls through to zone)
 *   4. Zone rate               (Tier 2)
 *   5. No rate → system default ($0)
 *   6. Mixed merchants/zones   (recalcPayoutTotals batch math)
 *   7. Recalculation after removing an order
 *   + payout eligibility matrix (concern B) and gross rule (concern C).
 *
 * Part B — Read-only DB comparison (no writes):
 *   Classifies every DriverPayout's stored totals against the unified rule
 *   and the two legacy rule sets extracted from git history (legacy creation
 *   path: total=Σamount, $3 default; legacy clear path: total=Σcollected??
 *   amount, $0 default). Reports which rule wrote each payout and flags any
 *   payout that matches no rule set ("drift") for inspection.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' scripts/verify-commission.ts
 *   (or: npx tsx scripts/verify-commission.ts)
 */
import {
  buildRateTableFromRates,
  computeOrderCommission,
  recalcPayoutTotals,
  grossUsd,
  grossLbp,
  isPayoutEligibleOrder,
  DEFAULT_DRIVER_USD,
} from "../lib/commission";
import { PrismaClient } from "@prisma/client";
import { loadDriverRateTable } from "../lib/commission";

const round2 = (n: number) => Math.round(n * 100) / 100;
let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok =
    typeof actual === "number" && typeof expected === "number"
      ? Math.abs(actual - expected) < 1e-9
      : actual === expected;
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function unitCases(): Promise<void> {
  console.log("══ Part A: pure unit cases ════════════════════════════════════");

  const table = buildRateTableFromRates("drv-1", {
    driverZoneRates: [
      { zoneId: "Z1", rate: 5 },
      { zoneId: "Z2", rate: 7 },
    ],
    driverSellerRates: [
      { merchantId: "A", rateUsd: 10, rateLbp: 1500000 },
      { merchantId: "C", rateUsd: 4 },
      { merchantId: "D", rateUsd: 0 },
      { merchantId: "B", rateUsd: 2 },
    ],
    driverCashSellerRates: [{ merchantId: "B", rateUsd: 6 }],
  });

  const usd = (merchantId: string | null, zoneId: string) =>
    computeOrderCommission(table, { merchantId, zoneId }).usd;

  console.log("── 1. Seller exception (Tier 1) ──");
  check("A @Z1 → seller $10 (not zone $5)", usd("A", "Z1"), 10);
  check("A @Z2 → seller $10 (not zone $7)", usd("A", "Z2"), 10);
  check("A tier is 'seller'", computeOrderCommission(table, { merchantId: "A", zoneId: "Z1" }).tier, "seller");
  check("A isFlatOverride true", computeOrderCommission(table, { merchantId: "A", zoneId: "Z1" }).isFlatOverride, true);
  check("A lbp carried from DriverSellerRate", computeOrderCommission(table, { merchantId: "A", zoneId: "Z1" }).lbp, 1500000);

  console.log("── 2. Cash-seller exception (Tier 1, cash wins) ──");
  check("B @Z1 → cash $6 (not standard $2)", usd("B", "Z1"), 6);
  check("B tier is 'cashSeller'", computeOrderCommission(table, { merchantId: "B", zoneId: "Z1" }).tier, "cashSeller");
  check("B lbp is 0 (cash rows are USD-only)", computeOrderCommission(table, { merchantId: "B", zoneId: "Z1" }).lbp, 0);

  console.log("── 3. $0 exception (valid override, no fall-through) ──");
  check("D @Z1 → $0 (NOT zone $5)", usd("D", "Z1"), 0);
  check("D tier is 'seller'", computeOrderCommission(table, { merchantId: "D", zoneId: "Z1" }).tier, "seller");

  console.log("── 4. Zone rate (Tier 2) ──");
  check("C @Z2 → seller $4 (Tier 1 exception beats zone $7)", usd("C", "Z2"), 4);
  check("merchant E (no rates) @Z2 → zone $7", usd("E", "Z2"), 7);
  check("merchant E tier is 'zone'", computeOrderCommission(table, { merchantId: "E", zoneId: "Z2" }).tier, "zone");

  console.log("── 5. No rate → system default ──");
  check("DEFAULT_DRIVER_USD is $0", DEFAULT_DRIVER_USD, 0);
  check("merchant F (no rates) @Z9 (no zone) → $0", usd("F", "Z9"), 0);
  check("tier is 'default'", computeOrderCommission(table, { merchantId: "F", zoneId: "Z9" }).tier, "default");
  check("null merchantId @Z9 → $0", usd(null, "Z9"), 0);

  console.log("── 6. Mixed merchants/zones (batch totals) ──");
  const orders = [
    { id: "o1", merchantId: "A", zoneId: "Z1", amountUsd: 50, amountLbp: 7500000, collectedUsd: 50, collectedLbp: 7500000 },
    { id: "o2", merchantId: "B", zoneId: "Z1", amountUsd: 30, amountLbp: 4500000, collectedUsd: 32, collectedLbp: 0 },
    { id: "o3", merchantId: "C", zoneId: "Z2", amountUsd: 20, amountLbp: 3000000, collectedUsd: 0, collectedLbp: 3100000 },
    { id: "o4", merchantId: "D", zoneId: "Z1", amountUsd: 10, amountLbp: 1500000, collectedUsd: 10, collectedLbp: 1500000 },
    { id: "o5", merchantId: "F", zoneId: "Z9", amountUsd: 15, amountLbp: 2250000, collectedUsd: 15, collectedLbp: 2250000 },
  ];
  const t = recalcPayoutTotals(table, orders);
  // gross: o1 50 + o2 32 + o3 20 (collected 0 → amount) + o4 10 + o5 15 = 127
  check("totalUsd (gross: collected>0 else amount)", t.totalUsd, 127);
  check("totalLbp (gross per currency)", t.totalLbp, 7500000 + 4500000 + 3100000 + 1500000 + 2250000);
  check("commissionUsd (10+6+4+0+0)", t.commissionUsd, 20);
  check("netUsd = total − commission", t.netUsd, 107);
  check("totalCollected mirrors totalUsd", t.totalCollected, t.totalUsd);

  console.log("── 7. Recalculation after removing an order ──");
  const afterRemove = recalcPayoutTotals(table, orders.slice(1));
  // 127 − 50 (o1 gross) = 77; 20 − 10 (o1 fee) = 10; 77 − 10 = 67
  check("totalUsd drops by removed order's gross (50)", afterRemove.totalUsd, 77);
  check("commissionUsd drops by removed order's fee (10)", afterRemove.commissionUsd, 10);
  check("netUsd consistent", afterRemove.netUsd, 67);

  console.log("── Concern B: payout eligibility ──");
  check("DELIVERED + WD → eligible", isPayoutEligibleOrder({ location: "DELIVERED", financialStatus: "WD" }), true);
  check("DELIVERED + UD → eligible", isPayoutEligibleOrder({ location: "DELIVERED", financialStatus: "UD" }), true);
  check("DELIVERED + WO → not eligible", isPayoutEligibleOrder({ location: "DELIVERED", financialStatus: "WO" }), false);
  check("WITH_DRIVER + WD → not eligible", isPayoutEligibleOrder({ location: "WITH_DRIVER", financialStatus: "WD" }), false);
  check("RETURN + WD → not eligible", isPayoutEligibleOrder({ location: "RETURN", financialStatus: "WD" }), false);

  console.log("── Concern C: gross rule ──");
  check("collected 0 → falls back to amount", grossUsd({ collectedUsd: 0, amountUsd: 12 }), 12);
  check("collected 8 → wins over amount 12", grossUsd({ collectedUsd: 8, amountUsd: 12 }), 8);
  check("collected null → falls back to amount", grossUsd({ collectedUsd: null, amountUsd: 12 }), 12);
  check("grossLbp symmetric", grossLbp({ collectedLbp: 0, amountLbp: 9 }), 9);
}

/**
 * Part B classifies each payout's STORED totals against three candidate rule
 * sets (all extracted verbatim from git history, pre-refactor):
 *
 *   unified        — the current lib/commission.ts rules
 *                    (gross = collected>0?collected:amount; commission Tier3 = $0)
 *   legacy-creation — POST /api/drivers/[id]/payouts (creation path):
 *                    total = Σ amountUsd; commission Tier3 = $3 (DEFAULT_DRIVER_USD)
 *   legacy-clear    — POST /api/driver-payouts (clear-to-office path):
 *                    total = Σ (collectedUsd ?? amountUsd)  ← `??` keeps 0!
 *                    commission Tier3 = $0
 *
 * A payout whose stored totals match a legacy rule set was written correctly
 * by the historical app; its divergence from `unified` is then fully
 * attributable to the documented rule changes. "drift" means stored totals
 * match NEITHER rule set (manual DB edits, order reassignment, or a 3rd
 * historical path) and is flagged for inspection.
 */
async function dbComparison(): Promise<void> {
  console.log("\n══ Part B: read-only DB comparison (stored vs rule sets) ══");

  const prisma = new PrismaClient();
  try {
    const payouts = await prisma.driverPayout.findMany({
      include: {
        driver: { select: { id: true } },
        orders: {
          select: {
            id: true,
            merchantId: true,
            zoneId: true,
            amountUsd: true,
            amountLbp: true,
            collectedUsd: true,
            collectedLbp: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    if (payouts.length === 0) {
      console.log("  (no DriverPayout rows in database — nothing to compare)");
      return;
    }

    const driverIds = Array.from(new Set(payouts.map((p) => p.driverId)));
    const tableByDriver = new Map<string, Awaited<ReturnType<typeof loadDriverRateTable>>>();
    await Promise.all(
      driverIds.map(async (id) => {
        tableByDriver.set(id, await loadDriverRateTable(prisma, id));
      }),
    );

    const EPS = 0.005;
    const close = (a: number, b: number) => Math.abs(a - b) < EPS;

    let nUnified = 0;
    let nLegacyCreation = 0;
    let nLegacyClear = 0;
    let nDrift = 0;
    let nHistorical = 0;

    for (const p of payouts) {
      const table = tableByDriver.get(p.driverId)!;
      const unified = recalcPayoutTotals(table, p.orders);

      // Per-order tier breakdown (needed for the legacy Tier-3 variants).
      let nDefaultTier = 0;
      let tier12Commission = 0;
      for (const o of p.orders) {
        const b = computeOrderCommission(table, o);
        if (b.tier === "default") nDefaultTier++;
        else tier12Commission += b.usd;
      }

      const legacyCreation = {
        totalUsd: p.orders.reduce((s, o) => s + (o.amountUsd ?? 0), 0),
        totalLbp: p.orders.reduce((s, o) => s + (o.amountLbp ?? 0), 0),
        commissionUsd: tier12Commission + 3 * nDefaultTier,
      };
      const legacyClear = {
        // `??` semantics: collectedUsd is non-null (schema default 0), so 0
        // stays 0 — it does NOT fall back to amount.
        totalUsd: p.orders.reduce((s, o) => s + (o.collectedUsd ?? o.amountUsd ?? 0), 0),
        totalLbp: p.orders.reduce((s, o) => s + (o.collectedLbp ?? o.amountLbp ?? 0), 0),
        commissionUsd: tier12Commission,
      };

      const matchesRule = (c: { totalUsd: number; totalLbp: number; commissionUsd: number }) =>
        close(p.totalUsd, c.totalUsd) &&
        close(p.totalLbp, c.totalLbp) &&
        close(p.commissionUsd, c.commissionUsd);

      let label: string;
      let detail: string;
      if (p.orders.length === 0 && (p.totalUsd !== 0 || p.commissionUsd !== 0)) {
        nHistorical++;
        label = "historical-snapshot";
        detail = "0 orders attached (removed/reassigned after creation) — stored totals are a point-in-time snapshot";
      } else if (matchesRule(unified)) {
        nUnified++;
        label = "unified";
        detail = "";
      } else if (matchesRule(legacyCreation)) {
        nLegacyCreation++;
        label = "legacy-creation";
        detail =
          `written by the legacy creation rule (total=Σamount` +
          (nDefaultTier ? `, ${nDefaultTier} order(s) at the $3 default` : "") + ")";
      } else if (matchesRule(legacyClear)) {
        nLegacyClear++;
        label = "legacy-clear";
        detail = "written by the legacy clear-to-office rule (total=Σcollected??amount, $0 default)";
      } else {
        nDrift++;
        label = "drift";
        detail = "matches NO known rule set — inspect";
      }

      const netResidual = p.netUsd - (p.totalUsd - p.commissionUsd);
      if (label !== "unified") {
        console.log(
          `  [${label.toUpperCase()}] ${p.payoutReference ?? p.id} (${p.orders.length} orders)` +
            (detail ? ` — ${detail}` : ""),
        );
        if (label === "drift") {
          console.log(
            `     stored  total=${round2(p.totalUsd)} lbp=${round2(p.totalLbp)} comm=${round2(p.commissionUsd)}`,
          );
          console.log(
            `     unified total=${round2(unified.totalUsd)} lbp=${round2(unified.totalLbp)} comm=${round2(unified.commissionUsd)}` +
              ` (default-tier orders: ${nDefaultTier})`,
          );
          console.log(
            `     legacy-creation: total=${round2(legacyCreation.totalUsd)} comm=${round2(legacyCreation.commissionUsd)}` +
              ` | legacy-clear: total=${round2(legacyClear.totalUsd)} comm=${round2(legacyClear.commissionUsd)}`,
          );
        }
        if (Math.abs(netResidual) > EPS) {
          console.log(
            `     netUsd residual ${round2(netResidual)} = stored.net − (stored.total − stored.commission)` +
              (label === "legacy-creation" ? " (legacy creation injected carriedDebtUsd into netUsd)" : ""),
          );
        }
      }
    }

    console.log("────────────────────────────────────────────────────────────");
    console.log(
      `  ${payouts.length} payouts compared: ` +
        `${nUnified} match the unified rule, ` +
        `${nLegacyCreation} written under legacy-creation, ` +
        `${nLegacyClear} under legacy-clear, ` +
        `${nHistorical} historical snapshots (0 orders), ` +
        `${nDrift} DRIFT (match no rule set — inspect)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

(async () => {
  await unitCases();
  await dbComparison();
  console.log(failures === 0 ? "\n✅ ALL UNIT CASES PASSED" : `\n❌ ${failures} UNIT CASE(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
