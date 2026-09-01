/**
 * verify-commission.ts — Verification for the unified driver commission module
 * (lib/commission.ts).
 *
 * Business rule (owner-confirmed): there is NO implicit/default driver
 * commission. Precedence: seller exception (cash-seller wins; an explicitly
 * configured $0 is a VALID override) → zone rate (a configured $0 is VALID)
 * → MISSING RATE (configuration error). Ledger-writing paths fail closed via
 * MissingDriverRateError; display paths render "Rate not configured".
 *
 * Part A — Pure unit cases (no database):
 *   1. Seller exception        (DriverSellerRate overrides zone)
 *   2. Cash-seller exception   (DriverCashSellerRate wins over standard)
 *   3. $0 exception            (valid override — never falls through to zone)
 *   4. Zone rate               (Tier 2)
 *   5. No rate → MISSING       (ok:false — no $0 default, fail-closed)
 *   6. Mixed merchants/zones   (recalcPayoutTotals batch math)
 *   7. Recalculation after removing an order
 *   8. 10-order batch, 1 missing rate → ENTIRE batch fails (no partial result)
 *   9. Recalc after removal, remaining orders still missing a rate → fails
 *   + payout eligibility matrix (concern B) and gross rule (concern C).
 *
 * Part B — Read-only DB comparison (no writes):
 *   Classifies every DriverPayout's stored totals against the unified rule
 *   and the two legacy rule sets extracted from git history (legacy creation
 *   path: total=Σamount, $3 for missing-rate orders; legacy clear path:
 *   total=Σcollected??amount, $0 for missing-rate orders). Payouts whose
 *   orders include a NO-RATE order under the CURRENT rule are classified
 *   "would-fail-new-rule": under the fail-closed rule they could no longer be
 *   created or recalculated. Any other payout that matches no rule set
 *   ("drift") is flagged for inspection.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' scripts/verify-commission.ts
 *   (or: npx tsx scripts/verify-commission.ts)
 */
import {
  buildRateTableFromRates,
  computeOrderCommission,
  recalcPayoutTotals,
  validateDriverRates,
  MissingDriverRateError,
  grossUsd,
  grossLbp,
  isPayoutEligibleOrder,
  loadDriverRateTable,
  type PayoutTotals,
  type CommissionOrderRow,
} from "../lib/commission";
import { PrismaClient } from "@prisma/client";

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
      { zoneId: "Z3", rate: 0 },
    ],
    driverSellerRates: [
      { merchantId: "A", rateUsd: 10, rateLbp: 1500000 },
      { merchantId: "C", rateUsd: 4 },
      { merchantId: "D", rateUsd: 0 },
      { merchantId: "B", rateUsd: 2 },
    ],
    driverCashSellerRates: [{ merchantId: "B", rateUsd: 6 }],
  });

  // Configured-rate helper: throws if the rate is MISSING (cases 1–4 all
  // expect a configured rate, so a throw means a rule regression).
  const usd = (merchantId: string | null, zoneId: string): number => {
    const b = computeOrderCommission(table, { merchantId, zoneId });
    if (!b.ok) {
      throw new Error(
        `expected a configured rate for ${merchantId ?? "∅"}@${zoneId}, got missing`,
      );
    }
    return b.usd;
  };

  // Narrowing variant: returns the ok-branch breakdown (throws if missing)
  // so callers can safely read .usd / .lbp / .isFlatOverride.
  const breakdown = (merchantId: string | null, zoneId: string) => {
    const b = computeOrderCommission(table, { merchantId, zoneId });
    if (!b.ok) {
      throw new Error(
        `expected a configured rate for ${merchantId ?? "∅"}@${zoneId}, got missing`,
      );
    }
    return b;
  };

  console.log("── 1. Seller exception (Tier 1) ──");
  check("A @Z1 → seller $10 (not zone $5)", usd("A", "Z1"), 10);
  check("A @Z2 → seller $10 (not zone $7)", usd("A", "Z2"), 10);
  check("A tier is 'seller'", breakdown("A", "Z1").tier, "seller");
  check("A isFlatOverride true", breakdown("A", "Z1").isFlatOverride, true);
  check("A lbp carried from DriverSellerRate", breakdown("A", "Z1").lbp, 1500000);

  console.log("── 2. Cash-seller exception (Tier 1, cash wins) ──");
  check("B @Z1 → cash $6 (not standard $2)", usd("B", "Z1"), 6);
  check("B tier is 'cashSeller'", breakdown("B", "Z1").tier, "cashSeller");
  check("B lbp is 0 (cash rows are USD-only)", breakdown("B", "Z1").lbp, 0);

  console.log("── 3. $0 exception (valid override, no fall-through) ──");
  const dBreak = computeOrderCommission(table, { merchantId: "D", zoneId: "Z1" });
  check("D @Z1 → $0 (NOT zone $5)", usd("D", "Z1"), 0);
  check("D tier is 'seller'", dBreak.tier, "seller");
  check("D $0 is ok:true (configured, NOT missing)", dBreak.ok, true);

  console.log("── 4. Zone rate (Tier 2) ──");
  check("C @Z2 → seller $4 (Tier 1 exception beats zone $7)", usd("C", "Z2"), 4);
  check("merchant E (no rates) @Z2 → zone $7", usd("E", "Z2"), 7);
  check("merchant E tier is 'zone'", breakdown("E", "Z2").tier, "zone");

  // A configured $0 ZONE rate is VALID (not missing): no seller + zone $0 → $0.
  const z3 = computeOrderCommission(table, { merchantId: "E", zoneId: "Z3" });
  check("merchant E (no rates) @Z3 (zone rate $0) → ok:true", z3.ok, true);
  check("zone $0 tier is 'zone'", z3.tier, "zone");
  check("zone $0 is a valid configured rate (usd 0)", z3.ok ? z3.usd : "missing", 0);

  console.log("── 5. No rate → MISSING (fail-closed, NO default) ──");
  const fBreak = computeOrderCommission(table, { merchantId: "F", zoneId: "Z9" });
  check("merchant F (no rates) @Z9 (no zone) → ok:false", fBreak.ok, false);
  check("tier is 'missing'", fBreak.tier, "missing");
  check(
    "null merchantId @Z9 → ok:false",
    computeOrderCommission(table, { merchantId: null, zoneId: "Z9" }).ok,
    false,
  );
  try {
    validateDriverRates(table, [
      { id: "x1", merchantId: "F", zoneId: "Z9" },
      { id: "x2", merchantId: null, zoneId: "Z8" },
    ] as (CommissionOrderRow & { id: string })[]);
    check("validateDriverRates throws when ANY rate is missing", "did not throw", "threw");
  } catch (e) {
    check("validateDriverRates throws MissingDriverRateError", e instanceof MissingDriverRateError, true);
    check("error aggregates ALL missing orders (2)", (e as MissingDriverRateError).missingOrders.length, 2);
  }

  console.log("── 6. Mixed merchants/zones (batch totals) ──");
  const orders: (CommissionOrderRow & { id: string })[] = [
    { id: "o1", merchantId: "A", zoneId: "Z1", amountUsd: 50, amountLbp: 7500000, collectedUsd: 50, collectedLbp: 7500000 },
    { id: "o2", merchantId: "B", zoneId: "Z1", amountUsd: 30, amountLbp: 4500000, collectedUsd: 32, collectedLbp: 0 },
    { id: "o3", merchantId: "C", zoneId: "Z2", amountUsd: 20, amountLbp: 3000000, collectedUsd: 0, collectedLbp: 3100000 },
    { id: "o4", merchantId: "D", zoneId: "Z1", amountUsd: 10, amountLbp: 1500000, collectedUsd: 10, collectedLbp: 1500000 },
    { id: "o5", merchantId: "E", zoneId: "Z2", amountUsd: 15, amountLbp: 2250000, collectedUsd: 15, collectedLbp: 2250000 },
  ];
  const t = recalcPayoutTotals(table, orders);
  // gross: o1 50 + o2 32 + o3 20 (collected 0 → amount) + o4 10 + o5 15 = 127
  check("totalUsd (gross: collected>0 else amount)", t.totalUsd, 127);
  check("totalLbp (gross per currency)", t.totalLbp, 7500000 + 4500000 + 3100000 + 1500000 + 2250000);
  check("commissionUsd (10+6+4+0+7)", t.commissionUsd, 27);
  check("netUsd = total − commission", t.netUsd, 100);
  check("totalCollected mirrors totalUsd", t.totalCollected, t.totalUsd);

  console.log("── 7. Recalculation after removing an order ──");
  const afterRemove = recalcPayoutTotals(table, orders.slice(1));
  // 127 − 50 (o1 gross) = 77; commission 27 − 10 (o1 fee) = 17; 77 − 17 = 60
  check("totalUsd drops by removed order's gross (50)", afterRemove.totalUsd, 77);
  check("commissionUsd drops by removed order's fee (10)", afterRemove.commissionUsd, 17);
  check("netUsd consistent", afterRemove.netUsd, 60);

  console.log("── 8. 10-order batch, 1 missing rate → ENTIRE batch fails ──");
  const batch: (CommissionOrderRow & { id: string; orderId: string })[] = [];
  for (let i = 0; i < 9; i++) {
    batch.push({
      id: `p${i}`,
      orderId: `ORD-${i}`,
      merchantId: "A",
      zoneId: "Z1",
      amountUsd: 10,
      amountLbp: 150000,
      collectedUsd: 10,
      collectedLbp: 150000,
    });
  }
  batch.push({
    id: "p9",
    orderId: "ORD-9",
    merchantId: "F",
    zoneId: "Z9",
    amountUsd: 10,
    amountLbp: 150000,
    collectedUsd: 10,
    collectedLbp: 150000,
  });
  let batchErr: unknown;
  let batchThrew = false;
  try {
    recalcPayoutTotals(table, batch);
  } catch (e) {
    batchThrew = true;
    batchErr = e;
  }
  check("recalcPayoutTotals throws when 1 of 10 orders lacks a rate", batchThrew, true);
  check("error is MissingDriverRateError", batchErr instanceof MissingDriverRateError, true);
  check("error names exactly the 1 missing order", (batchErr as MissingDriverRateError).missingOrders.length, 1);
  check("missing order identified by public id", (batchErr as MissingDriverRateError).missingOrders[0].label, "ORD-9");
  check("message names the driver", (batchErr as MissingDriverRateError).message.includes("driver drv-1"), true);
  check(
    "message is actionable (configure-first, nothing saved)",
    (batchErr as MissingDriverRateError).message.includes("Configure the missing rate(s) first") &&
      (batchErr as MissingDriverRateError).message.includes("Nothing was saved"),
    true,
  );
  // Same 10 orders, all configured → succeeds (no partial-failure ambiguity).
  const batchOk = batch.map((o) => (o.id === "p9" ? { ...o, merchantId: "C" } : o));
  const tOk = recalcPayoutTotals(table, batchOk);
  check("same 10 orders, all configured → succeeds", tOk.totalUsd, 100);
  check("commission = 9×$10 (A) + $4 (C) = 94", tOk.commissionUsd, 94);

  console.log("── 9. Recalc after removal, remaining set still missing a rate → fails ──");
  const stored: (CommissionOrderRow & { id: string })[] = [
    ...orders,
    { id: "o6", merchantId: "F", zoneId: "Z9", amountUsd: 5, amountLbp: 750000, collectedUsd: 5, collectedLbp: 750000 },
  ];
  const remaining = stored.slice(1); // o1 removed, o6 (no rate) remains
  let remErr: unknown;
  let remThrew = false;
  try {
    recalcPayoutTotals(table, remaining);
  } catch (e) {
    remThrew = true;
    remErr = e;
  }
  check("recalc of remaining orders throws (o6 has no rate)", remThrew, true);
  check("names exactly the remaining missing order", (remErr as MissingDriverRateError).missingOrders.length, 1);
  check("named order is o6", (remErr as MissingDriverRateError).missingOrders[0].id, "o6");

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
 *   unified         — the current lib/commission.ts rules
 *                     (gross = collected>0?collected:amount; missing rate →
 *                      fail-closed, no default)
 *   legacy-creation — POST /api/drivers/[id]/payouts (creation path):
 *                     total = Σ amountUsd; missing-rate order → $3 (removed)
 *   legacy-clear    — POST /api/driver-payouts (clear-to-office path):
 *                     total = Σ (collectedUsd ?? amountUsd)  ← `??` keeps 0!
 *                     missing-rate order → $0 (removed)
 *
 * A payout whose orders include an order that has NO configured rate under
 * the CURRENT rule is classified "would-fail-new-rule": under the fail-closed
 * rule it could no longer be created or recalculated — its stored totals are
 * a historical snapshot written when a silent default applied. Other payouts
 * matching a legacy rule set were written correctly by the historical app;
 * "drift" matches NEITHER set (manual DB edits, order reassignment, or a 3rd
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
            orderId: true,
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
    let nWouldFail = 0;

    for (const p of payouts) {
      const table = tableByDriver.get(p.driverId)!;

      // Per-order tier breakdown (needed for the legacy missing-rate
      // variants). `!b.ok` = no configured rate under the CURRENT rule.
      let nMissing = 0;
      let tier12Commission = 0;
      const missingLabels: string[] = [];
      for (const o of p.orders) {
        const b = computeOrderCommission(table, o);
        if (!b.ok) {
          nMissing++;
          missingLabels.push(o.orderId ?? o.id);
        } else {
          tier12Commission += b.usd;
        }
      }

      const legacyCreation = {
        totalUsd: p.orders.reduce((s, o) => s + (o.amountUsd ?? 0), 0),
        totalLbp: p.orders.reduce((s, o) => s + (o.amountLbp ?? 0), 0),
        commissionUsd: tier12Commission + 3 * nMissing,
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
      let unified: PayoutTotals | null = null;
      if (p.orders.length === 0 && (p.totalUsd !== 0 || p.commissionUsd !== 0)) {
        nHistorical++;
        label = "historical-snapshot";
        detail = "0 orders attached (removed/reassigned after creation) — stored totals are a point-in-time snapshot";
      } else if (nMissing > 0) {
        // recalcPayoutTotals would throw MissingDriverRateError for this
        // order set — under the current fail-closed rule the payout could
        // not be created or recalculated.
        nWouldFail++;
        label = "would-fail-new-rule";
        detail = `${nMissing} order(s) lack a configured rate now — could no longer be created/recalculated (fail-closed)`;
      } else {
        unified = recalcPayoutTotals(table, p.orders);
        if (matchesRule(unified)) {
          nUnified++;
          label = "unified";
          detail = "";
        } else if (matchesRule(legacyCreation)) {
          nLegacyCreation++;
          label = "legacy-creation";
          detail = "written by the legacy creation rule (total=Σamount, $3 for missing-rate orders)";
        } else if (matchesRule(legacyClear)) {
          nLegacyClear++;
          label = "legacy-clear";
          detail = "written by the legacy clear-to-office rule (total=Σcollected??amount, $0 for missing-rate orders)";
        } else {
          nDrift++;
          label = "drift";
          detail = "matches NO known rule set — inspect";
        }
      }

      const netResidual = p.netUsd - (p.totalUsd - p.commissionUsd);
      if (label !== "unified") {
        console.log(
          `  [${label.toUpperCase()}] ${p.payoutReference ?? p.id} (${p.orders.length} orders)` +
            (detail ? ` — ${detail}` : ""),
        );
        if (label === "would-fail-new-rule") {
          console.log(`     missing-rate order(s): ${missingLabels.join(", ")}`);
        }
        if (label === "drift" && unified) {
          console.log(
            `     stored  total=${round2(p.totalUsd)} lbp=${round2(p.totalLbp)} comm=${round2(p.commissionUsd)}`,
          );
          console.log(
            `     unified total=${round2(unified.totalUsd)} lbp=${round2(unified.totalLbp)} comm=${round2(unified.commissionUsd)}`,
          );
        }
        if (label === "drift" || label === "legacy-creation" || label === "legacy-clear") {
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
        `${nWouldFail} would FAIL the new fail-closed rule (missing-rate orders), ` +
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
