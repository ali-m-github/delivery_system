import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/server-permissions";
import DriverClient from "./DriverClient";

export default async function DriverPage() {
  // ── Read & verify session cookie ──────────────────────────────────────
  // Verifies the session and loads the CURRENT user record from the database.
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  // ── Fetch driver profile with zone assignments (with zone names) ────────
  const driverWithZones = await prisma.driverProfile.findUnique({
    where: { userId: user.id },
    include: {
      assignedZones: {
        include: {
          zone: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  if (!driverWithZones) {
    return (
      <div className="max-w-md mx-auto w-full min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-400 text-lg font-semibold">
            No driver profile found.
          </p>
          <p className="text-gray-500 text-sm mt-2">
            Your account is not linked to a driver profile.
          </p>
        </div>
      </div>
    );
  }

  // Extract assigned zone IDs and build a map of zone id -> zone name
  const assignedZoneIds = driverWithZones.assignedZones.map((az) => az.zoneId);
  const assignedZonesWithNames = driverWithZones.assignedZones.map((az) => ({
    id: az.zone.id,
    name: az.zone.name,
  }));

  // Build delivery filter for orders already assigned to this driver.
  // NOTE: We do NOT filter by assignedZones here because a driver must be able
  // to see ALL orders assigned to them, even if the order's zone isn't in
  // their assigned zones. The zone restriction only applies to warehouse
  // orders (what they can pick up), not to their own deliveries.
  const deliveryWhere = {
    location: { in: ["WITH_DRIVER", "ASSIGNED", "DELIVERED"] },
    financialStatus: { notIn: ["PS", "WO", "Arc"] },
  };

  // ── Fetch warehouse orders from assigned zones ─────────────────────────
  const warehouseOrders =
    assignedZoneIds.length > 0
      ? await prisma.order.findMany({
          where: {
            location: "WAREHOUSE",
            zoneId: { in: assignedZoneIds },
            driverId: null,
          },
          include: {
            zone: {
              select: { id: true, name: true },
            },
            merchant: {
              select: { id: true, merchantName: true },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 500,
        })
      : [];

  // ── Fetch driver profile with active deliveries & zone rates ──────────
  const driver = await prisma.driverProfile.findUnique({
    where: { userId: user.id },
    include: {
      deliveries: {
        where: deliveryWhere,
      },
      zoneRates: true,
      driverSellerRates: true,
    },
  });

  if (!driver) {
    return (
      <div className="max-w-md mx-auto w-full min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-400 text-lg font-semibold">
            No driver profile found.
          </p>
          <p className="text-gray-500 text-sm mt-2">
            Your account is not linked to a driver profile.
          </p>
        </div>
      </div>
    );
  }

  // ── Merge cash-seller rate exceptions into the driver's seller rates ──
  // Cash-seller rates (keyed by the driver's User) override any standard
  // DriverSellerRate for the same merchant, and a $0 exception is a valid
  // override. This keeps the driver's payout preview in sync with the
  // server-side commission calculation.
  const cashSellerRates = await prisma.driverCashSellerRate.findMany({
    where: { driverId: user.id },
    select: { merchantId: true, rateUsd: true },
  });
  const sellerRateMap = new Map<string, number>();
  for (const sr of driver.driverSellerRates) {
    sellerRateMap.set(sr.merchantId, sr.rateUsd);
  }
  for (const cr of cashSellerRates) {
    sellerRateMap.set(cr.merchantId, cr.rateUsd);
  }
  (driver as any).driverSellerRates = Array.from(sellerRateMap.entries()).map(
    ([merchantId, rateUsd]) => ({ merchantId, rateUsd }),
  );

  // ── Serialize for client component ────────────────────────────────────
  const plainDriver = JSON.parse(JSON.stringify(driver));
  const plainWarehouseOrders = JSON.parse(JSON.stringify(warehouseOrders));
  const plainAssignedZones = JSON.parse(JSON.stringify(assignedZonesWithNames));

  return (
    <DriverClient
      driver={plainDriver}
      warehouseOrders={plainWarehouseOrders}
      assignedZones={plainAssignedZones}
    />
  );
}
