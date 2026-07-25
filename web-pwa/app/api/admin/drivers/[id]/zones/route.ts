import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/admin/drivers/[id]/zones — Fetch zones assigned to a driver
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const driver = await prisma.driverProfile.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!driver) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }

    const assignments = await prisma.driverZoneAssignment.findMany({
      where: { driverId: id },
      include: {
        zone: true,
      },
      orderBy: { zone: { name: "asc" } },
    });

    return NextResponse.json(assignments, { status: 200 });
  } catch (error) {
    console.error("GET /api/admin/drivers/[id]/zones Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// PUT /api/admin/drivers/[id]/zones — Update zone assignments for a driver
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { zoneIds }: { zoneIds: string[] } = body;

    if (!Array.isArray(zoneIds)) {
      return NextResponse.json(
        { error: "zoneIds must be an array" },
        { status: 400 },
      );
    }

    const driver = await prisma.driverProfile.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!driver) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }

    const zones = await prisma.zone.findMany({
      where: { id: { in: zoneIds } },
      select: { id: true },
    });
    if (zones.length !== zoneIds.length) {
      return NextResponse.json(
        { error: "One or more zones not found" },
        { status: 400 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.driverZoneAssignment.deleteMany({
        where: { driverId: id },
      });

      if (zoneIds.length > 0) {
        await tx.driverZoneAssignment.createMany({
          data: zoneIds.map((zoneId) => ({
            driverId: id,
            zoneId,
          })),
        });
      }
    });

    const assignments = await prisma.driverZoneAssignment.findMany({
      where: { driverId: id },
      include: {
        zone: true,
      },
      orderBy: { zone: { name: "asc" } },
    });

    return NextResponse.json(assignments, { status: 200 });
  } catch (error) {
    console.error("PUT /api/admin/drivers/[id]/zones Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
