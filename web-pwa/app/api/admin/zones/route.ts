import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

export async function GET(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_ZONES");
  if (auth instanceof Response) return auth;
  try {
    const zones = await prisma.zone.findMany({
      include: {
        driverAssignments: {
          include: {
            driver: {
              include: {
                user: true,
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(zones);
  } catch (error) {
    console.error("Fetch Zones Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch zones" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_ZONES");
  if (auth instanceof Response) return auth;
  try {
    const { name, basePriceUsd, basePriceLbp } = await request.json();

    if (!name) {
      return NextResponse.json(
        { error: "Zone name is required" },
        { status: 400 },
      );
    }

    const newZone = await prisma.zone.create({
      data: {
        name,
        basePriceUsd: basePriceUsd !== undefined ? Number(basePriceUsd) : 0,
        basePriceLbp: basePriceLbp !== undefined ? Number(basePriceLbp) : 0,
      },
    });

    return NextResponse.json(newZone, { status: 201 });
  } catch (error) {
    console.error("Create Zone Error:", error);
    return NextResponse.json(
      { error: "Failed to create zone" },
      { status: 500 },
    );
  }
}
