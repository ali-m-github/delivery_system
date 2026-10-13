import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// PATCH /api/admin/pickup-batches/[id]/assign — Assign a driver to a batch.
// Body: { driverId: string } — DriverProfile.id. Only PENDING batches can be
// (re)assigned; once a driver has collected, custody has moved and the
// assignment is locked.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireServerPermission(request, "MANAGE_ORDERS");
    if (auth instanceof Response) return auth;
    const actor = auth.user;

    const { id } = await params;
    const body = await request.json();
    const driverId =
      typeof body.driverId === "string" ? body.driverId.trim() : "";

    if (!driverId) {
      return NextResponse.json({ error: "driverId is required" }, { status: 400 });
    }

    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!driver) {
      return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    }

    const batch = await prisma.pickupBatch.findUnique({
      where: { id },
      select: { id: true, batchNumber: true, status: true },
    });
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }
    if (batch.status !== "PENDING") {
      return NextResponse.json(
        { error: `Batch is already ${batch.status} and cannot be reassigned` },
        { status: 409 },
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.pickupBatch.update({
        where: { id },
        data: { driverId },
        include: {
          orders: { select: { id: true, orderId: true } },
        },
      });

      await tx.orderHistory.createMany({
        data: result.orders.map((o) => ({
          orderId: o.id,
          action: `Pickup Batch ${batch.batchNumber} assigned to driver ${driver.firstName} ${driver.lastName}`.trim(),
          location: "CP",
          driverId,
          userId: actor.id,
          meta: {
            action: "PICKUP_ASSIGN",
            performedBy: actor.role,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            timestamp: new Date().toISOString(),
          },
        })),
      });

      return result;
    });

    return NextResponse.json({ batch: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PATCH /api/admin/pickup-batches/:id/assign] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
