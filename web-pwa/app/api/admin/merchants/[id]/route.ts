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

// GET /api/admin/merchants/[id] — Fetch a single merchant with orders and zone rates
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireServerPermission(request, "MANAGE_MERCHANTS");
    if (auth instanceof Response) return auth;

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

// PATCH /api/admin/merchants/[id] — Update a merchant (incl. cash seller settings)
// Accepts both `application/json` and `multipart/form-data` (for logo upload).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireServerPermission(request, "MANAGE_MERCHANTS");
    if (auth instanceof Response) return auth;

    const resolvedParams = await params;
    const merchantId = resolvedParams.id;
    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");

    // Build update data dynamically — only include fields that are provided
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

      // Saved sheet import template
      if (formData.has("sheetImportConfig")) {
        const raw = formString(formData, "sheetImportConfig");
        if (raw != null) {
          try {
            updateData.sheetImportConfig = JSON.parse(raw);
          } catch {
            updateData.sheetImportConfig = raw;
          }
        }
      }

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

      // Saved sheet import template
      if (body.sheetImportConfig !== undefined)
        updateData.sheetImportConfig = body.sheetImportConfig;

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

    // Step 1: Resolve the true primary key UUID regardless of input format
    const paramId = String(merchantId);
    const isUuid = paramId.includes("-") || isNaN(Number(paramId));

    const existingMerchant = await prisma.merchant.findFirst({
      where: isUuid ? { id: paramId } : { merchantId: parseInt(paramId, 10) },
    });

    if (!existingMerchant) {
      return NextResponse.json(
        { error: `Merchant record (${paramId}) not found in database.` },
        { status: 404 },
      );
    }

    // Step 2: Execute the update using the verified primary key UUID
    const updated = await prisma.merchant.update({
      where: { id: existingMerchant.id },
      data: updateData,
    });

    return NextResponse.json(updated, { status: 200 });
  } catch (error: any) {
    console.error("Update Merchant Error:", error);
    if (error.code === "P2025") {
      return NextResponse.json(
        { error: "Merchant not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
