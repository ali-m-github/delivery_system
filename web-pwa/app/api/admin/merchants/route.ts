import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { isImageFile, saveMerchantLogo } from "@/lib/logoUpload";

const prisma = new PrismaClient();

// Helper: read a string field from a FormData payload (empty → null)
function formString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

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
// Accepts both `application/json` and `multipart/form-data` (for logo upload).
export async function POST(request: Request) {
  try {
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
