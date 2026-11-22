import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// /api/admin/merchants/[id]/rate-rules
// CRUD for merchant zone-rate RULES (MerchantRateRule): a rate (USD + LBP)
// charged for a span of zones (numeric zone-name range, e.g. 2–9) on orders
// created on/after `effectiveFrom`. Resolution lives in lib/merchantRates.ts.
//
// [id] is the merchant's internal UUID id (same value the /merchants page
// already holds as seller.id). All mutations re-check MANAGE_MERCHANTS.

function clampInt(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function clampMoney(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// GET — list the merchant's rules, newest effective date first.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "MANAGE_MERCHANTS");
  if (auth instanceof Response) return auth;

  try {
    const { id } = await params;

    const rules = await prisma.merchantRateRule.findMany({
      where: { merchantId: id },
      orderBy: [{ effectiveFrom: "desc" }, { zoneFrom: "asc" }],
    });

    return NextResponse.json(rules, { status: 200 });
  } catch (error: unknown) {
    console.error("GET merchant rate-rules Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// POST — create or update a rule.
// Body: { id?, zoneFrom, zoneTo, rate, rateLbp?, effectiveFrom }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "MANAGE_MERCHANTS");
  if (auth instanceof Response) return auth;

  try {
    const { id: merchantId } = await params;
    const body = await request.json();
    const { id, zoneFrom, zoneTo, rate, rateLbp, effectiveFrom } = body ?? {};

    const zFrom = clampInt(zoneFrom, 0, 999);
    const zTo = clampInt(zoneTo, 0, 999);
    if (zFrom === null || zTo === null || zFrom > zTo) {
      return NextResponse.json(
        { error: "zoneFrom/zoneTo must be integers with 0 <= zoneFrom <= zoneTo <= 999" },
        { status: 400 },
      );
    }

    const rateUsd = clampMoney(rate);
    if (rateUsd === null) {
      return NextResponse.json(
        { error: "rate must be a number >= 0" },
        { status: 400 },
      );
    }
    const rateLbpVal =
      rateLbp === undefined || rateLbp === null || rateLbp === ""
        ? 0
        : clampMoney(rateLbp);
    if (rateLbpVal === null) {
      return NextResponse.json(
        { error: "rateLbp must be a number >= 0" },
        { status: 400 },
      );
    }

    const effective = effectiveFrom ? new Date(effectiveFrom) : null;
    if (!effective || Number.isNaN(effective.getTime())) {
      return NextResponse.json(
        { error: "effectiveFrom must be a valid date" },
        { status: 400 },
      );
    }

    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true },
    });
    if (!merchant) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

    const data = {
      merchantId,
      zoneFrom: zFrom,
      zoneTo: zTo,
      rate: rateUsd,
      rateLbp: rateLbpVal,
      effectiveFrom: effective,
    };

    const saved = id
      ? await prisma.$transaction(async (tx) => {
          // Update: verify ownership before touching the row.
          const existing = await tx.merchantRateRule.findFirst({
            where: { id: String(id), merchantId },
            select: { id: true },
          });
          if (!existing) {
            throw new Error("RULE_NOT_FOUND");
          }
          return tx.merchantRateRule.update({
            where: { id: String(id) },
            data,
          });
        })
      : await prisma.merchantRateRule.create({ data });

    return NextResponse.json(saved, { status: id ? 200 : 201 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "RULE_NOT_FOUND") {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }
    console.error("POST merchant rate-rules Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// DELETE ?ruleId= — remove a single rule (ownership-checked).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "MANAGE_MERCHANTS");
  if (auth instanceof Response) return auth;

  try {
    const { id: merchantId } = await params;
    const { searchParams } = new URL(request.url);
    const ruleId = searchParams.get("ruleId");
    if (!ruleId) {
      return NextResponse.json({ error: "ruleId is required" }, { status: 400 });
    }

    const rule = await prisma.merchantRateRule.findFirst({
      where: { id: ruleId, merchantId },
      select: { id: true },
    });
    if (!rule) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    await prisma.merchantRateRule.delete({ where: { id: rule.id } });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    console.error("DELETE merchant rate-rules Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
