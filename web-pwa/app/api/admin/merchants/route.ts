import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { isImageFile, saveMerchantLogo } from "@/lib/logoUpload";
import { requireServerPermission } from "@/lib/server-permissions";

const prisma = new PrismaClient();

// Helper: read a string field from a FormData payload (empty → null)
function formString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

// GET /api/admin/merchants — Fetch all merchants with their zone rates
export async function GET(request: Request) {
  try {
    const auth = await requireServerPermission(request, "MANAGE_MERCHANTS");
    if (auth instanceof Response) return auth;

    const merchants = await prisma.merchant.findMany({
      include: { zoneRates: true },
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
// Accepts both `application/json` and `multipart/form-data` (for logo upload).
export async function POST(request: Request) {
  try {
    const auth = await requireServerPermission(request, "MANAGE_MERCHANTS");
    if (auth instanceof Response) return auth;

    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");

    let merchantName = "";
    let contactName: string | null = null;
    let phone: string | null = null;
    let address: string | null = null;
    let socialMedia: string | null = null;
    let isCashSeller = false;
    let defaultSellerRate: number | null = null;
    let defaultProfitRate: number | null = null;
    let logoUrl: string | null = null;

    if (isMultipart) {
      const formData = await request.formData();
      merchantName = formString(formData, "merchantName") ?? "";
      contactName = formString(formData, "contactName");
      phone = formString(formData, "phone");
      address = formString(formData, "address");
      socialMedia = formString(formData, "socialMedia");
      isCashSeller = formString(formData, "isCashSeller") === "true";

      const sellerRate = formString(formData, "defaultSellerRate");
      const profitRate = formString(formData, "defaultProfitRate");
      defaultSellerRate = sellerRate != null ? parseFloat(sellerRate) : null;
      defaultProfitRate = profitRate != null ? parseFloat(profitRate) : null;

      const logo = formData.get("logo");
      if (isImageFile(logo)) logoUrl = await saveMerchantLogo(logo);
    } else {
      const body = await request.json();
      merchantName = body.merchantName || "";
      contactName = body.contactName || null;
      phone = body.phone || null;
      address = body.address || null;
      socialMedia = body.socialMedia || null;
      isCashSeller = body.isCashSeller === true;
      defaultSellerRate =
        body.defaultSellerRate != null
          ? parseFloat(body.defaultSellerRate)
          : null;
      defaultProfitRate =
        body.defaultProfitRate != null
          ? parseFloat(body.defaultProfitRate)
          : null;
      logoUrl = body.logoUrl ?? null;
    }

    if (!merchantName) {
      return NextResponse.json(
        { error: "Business Name required" },
        { status: 400 },
      );
    }

    const newMerchant = await prisma.merchant.create({
      data: {
        merchantName,
        contactName,
        phone,
        address,
        socialMedia,
        logoUrl,
        isCashSeller,
        defaultSellerRate,
        defaultProfitRate,
      },
    });

    return NextResponse.json(newMerchant, { status: 201 });
  } catch (error: any) {
    console.error("Create Merchant Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/admin/merchants — Upsert custom zone rates for a merchant
export async function PATCH(request: Request) {
  try {
    const auth = await requireServerPermission(request, "MANAGE_MERCHANTS");
    if (auth instanceof Response) return auth;

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

// DELETE /api/admin/merchants?id=<id> — Delete a merchant and its custom rates
export async function DELETE(request: Request) {
  try {
    const auth = await requireServerPermission(request, "MANAGE_MERCHANTS");
    if (auth instanceof Response) return auth;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "Merchant ID required" },
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
