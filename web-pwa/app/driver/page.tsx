import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import DriverClient from "./DriverClient";

export default async function DriverPage() {
  // ── Read & verify session cookie ──────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;

  if (!token) {
    redirect("/login");
  }

  let userId: string;
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    userId = payload.id as string;
  } catch {
    redirect("/login");
  }

  // ── Fetch driver profile with zone assignments (with zone names) ────────
  const driverWithZones = await prisma.driverProfile.findUnique({
    where: { userId },
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

  // Build delivery filter: only orders from assigned zones
  // If no zones assigned, show all orders (backward compat)
  const deliveryWhere = {
    location: { in: ["WITH_DRIVER", "ASSIGNED", "DELIVERED"] },
    financialStatus: { notIn: ["PS", "WO", "Arc"] },
    ...(assignedZoneIds.length > 0 ? { zoneId: { in: assignedZoneIds } } : {}),
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
    where: { userId },
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
