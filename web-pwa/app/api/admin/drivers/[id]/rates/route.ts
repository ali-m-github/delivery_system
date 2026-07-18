import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// GET /api/admin/drivers/[id]/rates — Fetch all seller-specific flat rates for a driver
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: identifier } = await params;

    // Resolve human-readable driverId (e.g., "d001") to CUID
    const profile = await prisma.driverProfile.findFirst({
      where: {
        driverId: {
          equals: identifier,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });

    if (!profile) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }

    const driverId = profile.id;

    const rates = await prisma.driverSellerRate.findMany({
      where: { driverId },
      include: {
        merchant: {
          select: { id: true, merchantName: true, merchantId: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(rates, { status: 200 });
  } catch (error) {
    console.error("GET driver seller rates error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// POST /api/admin/drivers/[id]/rates — Create a new seller-specific flat rate
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: identifier } = await params;

    // Resolve human-readable driverId (e.g., "d001") to CUID
    const profile = await prisma.driverProfile.findFirst({
      where: {
        driverId: {
          equals: identifier,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });

    if (!profile) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }

    const driverId = profile.id;
    const body = await request.json();
    const { merchantId, rateUsd, rateLbp } = body;

    if (!merchantId) {
      return NextResponse.json(
        { error: "merchantId is required" },
        { status: 400 },
      );
    }

    const existing = await prisma.driverSellerRate.findUnique({
      where: { driverId_merchantId: { driverId, merchantId } },
    });

    if (existing) {
      return NextResponse.json(
        { error: "A rate exception already exists for this driver and seller" },
        { status: 409 },
      );
    }

    const rate = await prisma.driverSellerRate.create({
      data: {
        driverId,
        merchantId,
        rateUsd: parseFloat(rateUsd) || 0,
        rateLbp: parseFloat(rateLbp) || 0,
      },
      include: {
        merchant: {
          select: { id: true, merchantName: true, merchantId: true },
        },
      },
    });

    return NextResponse.json(rate, { status: 201 });
  } catch (error) {
    console.error("POST driver seller rate error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// PUT /api/admin/drivers/[id]/rates — Update an existing seller-specific flat rate
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: identifier } = await params;

    // Resolve human-readable driverId (e.g., "d001") to CUID
    const profile = await prisma.driverProfile.findFirst({
      where: {
        driverId: {
          equals: identifier,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });

    if (!profile) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }

    const driverId = profile.id;
    const body = await request.json();
    const { rateId, rateUsd, rateLbp } = body;

    if (!rateId) {
      return NextResponse.json(
        { error: "rateId is required" },
        { status: 400 },
      );
    }

    const rate = await prisma.driverSellerRate.update({
      where: { id: rateId },
      data: {
        rateUsd: rateUsd !== undefined ? parseFloat(rateUsd) : undefined,
        rateLbp: rateLbp !== undefined ? parseFloat(rateLbp) : undefined,
      },
      include: {
        merchant: {
          select: { id: true, merchantName: true, merchantId: true },
        },
      },
    });

    return NextResponse.json(rate, { status: 200 });
  } catch (error) {
    console.error("PUT driver seller rate error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// DELETE /api/admin/drivers/[id]/rates — Delete a seller-specific flat rate
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: identifier } = await params;

    // Resolve human-readable driverId (e.g., "d001") to CUID
    const profile = await prisma.driverProfile.findFirst({
      where: {
        driverId: {
          equals: identifier,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });

    if (!profile) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }

    const driverId = profile.id;
    const { searchParams } = new URL(request.url);
    const rateId = searchParams.get("rateId");

    if (!rateId) {
      return NextResponse.json(
        { error: "rateId query parameter is required" },
        { status: 400 },
      );
    }

    await prisma.driverSellerRate.delete({
      where: { id: parseInt(rateId, 10) },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("DELETE driver seller rate error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
