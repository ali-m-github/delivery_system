import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Next.js 15+ requires params to be a Promise
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    // Await the params before extracting the ID
    const resolvedParams = await context.params;

    const seller = await prisma.merchant.findUnique({
      where: { id: resolvedParams.id },
      include: {
        zoneRates: { include: { zone: true } },
        orders: {
          where: {
            NOT: {
              location: {
                equals: "archive",
                mode: "insensitive",
              },
            },
          },
          include: { driver: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!seller)
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    return NextResponse.json(seller, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/sellers/[id] — Update seller details (incl. cash seller settings)
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await context.params;
    const sellerId = resolvedParams.id;
    const body = await request.json();

    const updateData: Record<string, unknown> = {};

    if (body.merchantName !== undefined)
      updateData.merchantName = body.merchantName;
    if (body.contactName !== undefined)
      updateData.contactName = body.contactName;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.address !== undefined) updateData.address = body.address;
    if (body.socialMedia !== undefined)
      updateData.socialMedia = body.socialMedia;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    // Cash seller toggles & rates
    if (body.isCashSeller !== undefined)
      updateData.isCashSeller = body.isCashSeller === true;
    if (body.defaultSellerRate !== undefined) {
      updateData.defaultSellerRate =
        body.defaultSellerRate != null
          ? parseFloat(body.defaultSellerRate)
          : null;
    }
    if (body.defaultCompanyRate !== undefined) {
      updateData.defaultCompanyRate =
        body.defaultCompanyRate != null
          ? parseFloat(body.defaultCompanyRate)
          : null;
    }

    const updated = await prisma.merchant.update({
      where: { id: sellerId },
      data: updateData,
    });

    return NextResponse.json(updated, { status: 200 });
  } catch (error: any) {
    console.error("Update Seller Error:", error);
    if (error.code === "P2025") {
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
