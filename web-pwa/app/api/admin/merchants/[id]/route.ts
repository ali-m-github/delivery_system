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

// PATCH /api/admin/merchants/[id] — Update a merchant (incl. cash seller settings)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await params;
    const merchantId = resolvedParams.id;
    const body = await request.json();

    // Build update data dynamically — only include fields that are provided
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
    if (body.defaultCompanyRate !== undefined) {
      updateData.defaultCompanyRate =
        body.defaultCompanyRate != null
          ? parseFloat(body.defaultCompanyRate)
          : null;
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
