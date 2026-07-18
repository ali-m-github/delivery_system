import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// GET /api/admin/merchants — Fetch all active merchants
export async function GET() {
  try {
    const merchants = await prisma.merchant.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(merchants);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch merchants" },
      { status: 500 },
    );
  }
}

// POST /api/admin/merchants — Create a new merchant (seller)
export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.merchantName) {
      return NextResponse.json(
        { error: "Business Name required" },
        { status: 400 },
      );
    }

    const newMerchant = await prisma.merchant.create({
      data: {
        merchantName: body.merchantName,
        contactName: body.contactName || null,
        phone: body.phone || null,
        address: body.address || null,
        socialMedia: body.socialMedia || null,
        isCashSeller: body.isCashSeller === true,
        defaultSellerRate:
          body.defaultSellerRate != null
            ? parseFloat(body.defaultSellerRate)
            : null,
        defaultCompanyRate:
          body.defaultCompanyRate != null
            ? parseFloat(body.defaultCompanyRate)
            : null,
      },
    });

    return NextResponse.json(newMerchant, { status: 201 });
  } catch (error: any) {
    console.error("Create Merchant Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
