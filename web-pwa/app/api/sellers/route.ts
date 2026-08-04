import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { isImageFile, saveMerchantLogo } from "@/lib/logoUpload";

const prisma = new PrismaClient();

// Parse a multipart request into a plain object. String fields are collected
// as-is; a `logo` file is persisted to public/uploads/merchants and exposed as
// a `logoUrl` web path.
async function parseFormBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const formData = await request.formData();
  const body: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") body[key] = value;
  }
  const logo = formData.get("logo");
  if (isImageFile(logo)) body.logoUrl = await saveMerchantLogo(logo);
  return body;
}

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
// Accepts both `application/json` and `multipart/form-data` (for logo upload).
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");

    // Parse a multipart payload (with optional logo) or fall back to JSON.
    const body = isMultipart
      ? await parseFormBody(request)
      : await request.json();

    const {
      name,
      merchantName,
      sellerName,
      phone,
      address,
      isCashSeller,
      defaultSellerRate,
      defaultProfitRate,
      contactName,
      socialMedia,
      logoUrl,
      ...otherData
    } = body;

    const resolvedName = name || merchantName || sellerName;

    if (!resolvedName) {
      return NextResponse.json(
        { error: "Seller name is required" },
        { status: 400 },
      );
    }

    const parsedSellerRate =
      defaultSellerRate !== undefined && defaultSellerRate !== ""
        ? parseFloat(defaultSellerRate)
        : null;

    const parsedProfitRate =
      defaultProfitRate !== undefined && defaultProfitRate !== ""
        ? parseFloat(defaultProfitRate)
        : null;

    const newMerchant = await prisma.merchant.create({
      data: {
        ...otherData,
        merchantName: resolvedName,
        contactName: contactName || resolvedName,
        phone: phone || "N/A",
        address: address || "N/A",
        socialMedia: socialMedia || null,
        logoUrl: logoUrl || null,
        // FormData sends booleans as "true"/"false" strings; JSON sends real booleans.
        isCashSeller: isCashSeller === true || isCashSeller === "true",
        defaultSellerRate: isNaN(parsedSellerRate as number)
          ? null
          : parsedSellerRate,
        defaultProfitRate: isNaN(parsedProfitRate as number)
          ? null
          : parsedProfitRate,
      },
    });

    return NextResponse.json(newMerchant, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/sellers] Error:", error.message);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    );
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
          update: {
            rate: parseFloat(r.rate) || 0,
            rateLbp: r.rateLbp !== undefined ? parseFloat(r.rateLbp) || 0 : 0,
          },
          create: {
            merchantId,
            zoneId: r.zoneId,
            rate: parseFloat(r.rate) || 0,
            rateLbp: r.rateLbp !== undefined ? parseFloat(r.rateLbp) || 0 : 0,
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
    if (!id) {
      return NextResponse.json(
        { error: "Seller ID required" },
        { status: 400 },
      );
    }

    await prisma.merchantZoneRate.deleteMany({ where: { merchantId: id } });
    await prisma.merchant.delete({ where: { id } });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
