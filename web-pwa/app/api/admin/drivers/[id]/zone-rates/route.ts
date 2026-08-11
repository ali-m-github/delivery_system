import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// PUT /api/admin/drivers/[id]/zone-rates
// Replace the driver's zone-based commission rates in a single call.
//
// Guarded by ACTION_DRIVER_RATE_EDIT so only ADMINs (who bypass the permission
// map) or employees holding the permission via a Permission Group or their
// per-user Custom Permissions can change a driver's rate from the /drivers page.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Server-side RBAC: require ACTION_DRIVER_RATE_EDIT before any work ──
  const auth = await requireServerPermission(
    request,
    "ACTION_DRIVER_RATE_EDIT",
  );
  if (auth instanceof Response) return auth;

  try {
    const { id: identifier } = await params;

    // Resolve human-readable driverId (e.g., "d001") to internal DriverProfile.id (CUID)
    const profile = await prisma.driverProfile.findFirst({
      where: {
        driverId: { equals: identifier, mode: "insensitive" },
      },
      select: { id: true },
    });

    if (!profile) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }

    const driverId = profile.id;
    const body = await request.json();
    const rawRates: unknown = body.rates;

    // Validate + normalize: keep only entries with a zoneId and a non-negative number rate
    const rates: { zoneId: string; rate: number }[] = Array.isArray(rawRates)
      ? (rawRates as Array<{ zoneId?: unknown; rate?: unknown }>)
          .filter(
            (r) =>
              typeof r?.zoneId === "string" &&
              r.zoneId.trim() !== "" &&
              typeof r?.rate === "number" &&
              Number.isFinite(r.rate) &&
              r.rate >= 0,
          )
          .map((r) => ({ zoneId: r.zoneId as string, rate: r.rate as number }))
      : [];

    await prisma.$transaction(async (tx) => {
      // Replace all existing zone rates for this driver
      await tx.driverZoneRate.deleteMany({ where: { driverId } });
      if (rates.length > 0) {
        await tx.driverZoneRate.createMany({
          data: rates.map((r) => ({
            driverId,
            zoneId: r.zoneId,
            rate: r.rate,
          })),
          skipDuplicates: true,
        });
      }
    });

    return NextResponse.json(
      { success: true, count: rates.length },
      { status: 200 },
    );
  } catch (error) {
    console.error("PUT driver zone rates error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
