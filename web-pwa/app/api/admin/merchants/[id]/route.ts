import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// GET /api/admin/merchants/[id] — Fetch a single merchant with orders and zone rates
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await params;
    const merchantId = resolvedParams.id;

    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        zoneRates: { include: { zone: true } },
        orders: {
          include: { zone: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!merchant) {
      return NextResponse.json(
        { error: "Merchant not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(merchant, { status: 200 });
  } catch (error) {
    console.error("Fetch Merchant Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
