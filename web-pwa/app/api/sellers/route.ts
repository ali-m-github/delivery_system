import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// GET all sellers with their zone rates
export async function GET() {
  try {
    const sellers = await prisma.merchant.findMany({
      include: { zoneRates: true },
      orderBy: { merchantId: "asc" },
    });
    return NextResponse.json(sellers, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// POST a new seller
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.merchantName)
      return NextResponse.json(
        { error: "Business Name required" },
        { status: 400 },
      );

    const newSeller = await prisma.merchant.create({
      data: {
        merchantName: body.merchantName,
        contactName: body.contactName || null,
        phone: body.phone || null,
        address: body.address || null,
        socialMedia: body.socialMedia || null,
      },
    });
    return NextResponse.json(newSeller, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH to update custom zone rates
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { merchantId, rates } = body;

    if (!merchantId || !rates || !Array.isArray(rates)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    await Promise.all(
      rates.map((r: any) =>
        prisma.merchantZoneRate.upsert({
          where: { merchantId_zoneId: { merchantId, zoneId: r.zoneId } },
          update: { rate: parseFloat(r.rate) || 0 },
          create: {
            merchantId,
            zoneId: r.zoneId,
            rate: parseFloat(r.rate) || 0,
          },
        }),
      ),
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE a seller
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id)
      return NextResponse.json(
        { error: "Seller ID required" },
        { status: 400 },
      );

    // Delete associated rates first (foreign key constraint), then delete the merchant
    await prisma.merchantZoneRate.deleteMany({ where: { merchantId: id } });
    await prisma.merchant.delete({ where: { id } });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
