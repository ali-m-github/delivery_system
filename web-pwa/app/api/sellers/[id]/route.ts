import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { isImageFile, saveMerchantLogo } from "@/lib/logoUpload";

const prisma = new PrismaClient();

// Helper: read a string field from a FormData payload (empty → null)
function formString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

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
          include: {
            driver: true,
            history: { include: { user: true }, orderBy: { createdAt: "asc" } },
          },
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
// Accepts both `application/json` and `multipart/form-data` (for logo upload).
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await context.params;
    const sellerId = resolvedParams.id;
    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");

    const updateData: Record<string, unknown> = {};

    if (isMultipart) {
      const formData = await request.formData();

      if (formData.has("merchantName"))
        updateData.merchantName = formString(formData, "merchantName") ?? "";
      if (formData.has("contactName"))
        updateData.contactName = formString(formData, "contactName");
      if (formData.has("phone"))
        updateData.phone = formString(formData, "phone");
      if (formData.has("address"))
        updateData.address = formString(formData, "address");
      if (formData.has("socialMedia"))
        updateData.socialMedia = formString(formData, "socialMedia");
      if (formData.has("isActive"))
        updateData.isActive = formString(formData, "isActive") === "true";

      // Cash seller toggles & rates
      if (formData.has("isCashSeller"))
        updateData.isCashSeller =
          formString(formData, "isCashSeller") === "true";
      if (formData.has("defaultSellerRate")) {
        const rate = formString(formData, "defaultSellerRate");
        updateData.defaultSellerRate = rate != null ? parseFloat(rate) : null;
      }
      if (formData.has("defaultProfitRate")) {
        const rate = formString(formData, "defaultProfitRate");
        updateData.defaultProfitRate = rate != null ? parseFloat(rate) : null;
      }

      // Logo upload / removal
      const logo = formData.get("logo");
      if (isImageFile(logo)) updateData.logoUrl = await saveMerchantLogo(logo);
      if (formString(formData, "clearLogo") === "true")
        updateData.logoUrl = null;
    } else {
      const body = await request.json();

      if (body.merchantName !== undefined)
        updateData.merchantName = body.merchantName;
      if (body.contactName !== undefined)
        updateData.contactName = body.contactName;
      if (body.phone !== undefined) updateData.phone = body.phone;
      if (body.address !== undefined) updateData.address = body.address;
      if (body.socialMedia !== undefined)
        updateData.socialMedia = body.socialMedia;
      if (body.isActive !== undefined) updateData.isActive = body.isActive;
      if (body.logoUrl !== undefined) updateData.logoUrl = body.logoUrl;

      // Cash seller toggles & rates
      if (body.isCashSeller !== undefined)
        updateData.isCashSeller = body.isCashSeller === true;
      if (body.defaultSellerRate !== undefined) {
        updateData.defaultSellerRate =
          body.defaultSellerRate != null
            ? parseFloat(body.defaultSellerRate)
            : null;
      }
      if (body.defaultProfitRate !== undefined) {
        updateData.defaultProfitRate =
          body.defaultProfitRate != null
            ? parseFloat(body.defaultProfitRate)
            : null;
      }
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
