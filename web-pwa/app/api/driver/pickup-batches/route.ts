import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerRole } from "@/lib/server-permissions";

// GET /api/driver/pickup-batches — Pickup batches assigned to the acting driver.
// Admins assign batches to drivers (PATCH /api/admin/pickup-batches/[id]/assign);
// drivers only ever see batches where driverId points at their own profile.
export async function GET(request: Request) {
  try {
    const auth = await requireServerRole(request, "DRIVER");
    if (auth instanceof Response) return auth;
    const user = auth.user;

    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!driverProfile) {
      return NextResponse.json(
        { error: "Driver profile not found" },
        { status: 404 },
      );
    }

    const batches = await prisma.pickupBatch.findMany({
      where: {
        driverId: driverProfile.id,
        // Completed/discrepancy batches are history; drivers act on the rest.
        status: { in: ["PENDING", "PICKED_UP"] },
      },
      orderBy: { createdAt: "asc" },
      include: {
        merchant: {
          select: { id: true, merchantId: true, merchantName: true, phone: true, address: true },
        },
        orders: {
          select: {
            id: true,
            orderId: true,
            customerName: true,
            customerPhone: true,
            packages: true,
            location: true,
          },
          orderBy: { orderId: "asc" },
        },
      },
    });

    return NextResponse.json({ batches });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[GET /api/driver/pickup-batches] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
