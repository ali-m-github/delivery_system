import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/zones/overrides — list all merchant zone rate overrides
export async function GET() {
  try {
    const overrides = await prisma.merchantZoneRate.findMany({
      include: {
        merchant: true,
        zone: true,
      },
      orderBy: { zone: { name: "asc" } },
    });
    return NextResponse.json(overrides);
  } catch (error) {
    console.error("Fetch Overrides Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch overrides" },
      { status: 500 },
    );
  }
}

// POST /api/zones/overrides — create a merchant-specific zone rate override
export async function POST(request: Request) {
  try {
    const { merchantId, zoneId, rateUsd, rateLbp } = await request.json();

    if (!merchantId || !zoneId) {
      return NextResponse.json(
        { error: "merchantId and zoneId are required" },
        { status: 400 },
      );
    }

    const existing = await prisma.merchantZoneRate.findUnique({
      where: {
        merchantId_zoneId: { merchantId, zoneId },
      },
    });

    const data = {
      rate: rateUsd !== undefined ? Number(rateUsd) : 0,
      rateLbp: rateLbp !== undefined ? Number(rateLbp) : 0,
    };

    if (existing) {
      const updated = await prisma.merchantZoneRate.update({
        where: { id: existing.id },
        data,
        include: { merchant: true, zone: true },
      });
      return NextResponse.json(updated, { status: 200 });
    }

    const override = await prisma.merchantZoneRate.create({
      data: {
        merchantId,
        zoneId,
        ...data,
      },
      include: {
        merchant: true,
        zone: true,
      },
    });

    return NextResponse.json(override, { status: 201 });
  } catch (error) {
    console.error("Create Override Error:", error);
    return NextResponse.json(
      { error: "Failed to create override" },
      { status: 500 },
    );
  }
}
