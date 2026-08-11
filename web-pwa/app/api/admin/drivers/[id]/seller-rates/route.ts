import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// PUT /api/admin/drivers/[id]/seller-rates
// Replace the driver's seller-specific flat rate exceptions in a single call.
//
// Guarded by ACTION_DRIVER_RATE_EDIT so only ADMINs (who bypass the permission
// map) or employees holding the permission via a Permission Group or their
// per-user Custom Permissions can change a driver's seller exception rates.
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
    const rawSellerRates: unknown = body.sellerRates;

    // Validate + normalize: keep only entries with a merchantId and a non-negative number rate
    const sellerRates: { merchantId: string; rateUsd: number }[] =
      Array.isArray(rawSellerRates)
        ? (rawSellerRates as Array<{ merchantId?: unknown; rateUsd?: unknown }>)
            .filter(
              (r) =>
                typeof r?.merchantId === "string" &&
                r.merchantId.trim() !== "" &&
                typeof r?.rateUsd === "number" &&
                Number.isFinite(r.rateUsd) &&
                r.rateUsd >= 0,
            )
            .map((r) => ({
              merchantId: r.merchantId as string,
              rateUsd: r.rateUsd as number,
            }))
        : [];

    await prisma.$transaction(async (tx) => {
      // Replace all existing seller rate exceptions for this driver
      await tx.driverSellerRate.deleteMany({ where: { driverId } });
      if (sellerRates.length > 0) {
        await tx.driverSellerRate.createMany({
          data: sellerRates.map((r) => ({
            driverId,
            merchantId: r.merchantId,
            rateUsd: r.rateUsd,
            rateLbp: 0,
          })),
          skipDuplicates: true,
        });
      }
    });

    return NextResponse.json(
      { success: true, count: sellerRates.length },
      { status: 200 },
    );
  } catch (error) {
    console.error("PUT driver seller rates error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
