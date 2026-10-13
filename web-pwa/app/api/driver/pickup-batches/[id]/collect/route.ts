import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerRole } from "@/lib/server-permissions";

// PATCH /api/driver/pickup-batches/[id]/collect — Hybrid scan/manual collection.
// Body: { orderIds: string[] } — the subset of the batch's orders the driver
// has physically verified (via the camera scanner or the 1-tap Pick button).
// Each collected order moves to location="PICKED_UP" / financialStatus="UD".
// When every order in the batch is collected, the batch flips to PICKED_UP.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

    const { id } = await params;
    const body = await request.json();
    const rawIds: string[] = Array.isArray(body.orderIds)
      ? (body.orderIds as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [];
    if (rawIds.length === 0) {
      return NextResponse.json({ error: "No orders selected" }, { status: 400 });
    }

    const batch = await prisma.pickupBatch.findUnique({
      where: { id },
      include: { orders: { select: { id: true, orderId: true, location: true } } },
    });
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }
    // Admin-assignment model: only the assigned driver may collect.
    if (batch.driverId !== driverProfile.id) {
      return NextResponse.json(
        { error: "This batch is not assigned to you" },
        { status: 403 },
      );
    }
    if (batch.status !== "PENDING" && batch.status !== "PICKED_UP") {
      return NextResponse.json(
        { error: `Batch is already ${batch.status}` },
        { status: 409 },
      );
    }

    const batchOrderIds = new Set(batch.orders.map((o) => o.id));
    const invalid = rawIds.filter((oid) => !batchOrderIds.has(oid));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: "One or more orders do not belong to this batch" },
        { status: 400 },
      );
    }

    // Idempotent: re-scanning an already-collected order is a no-op, not an error.
    const toCollect = batch.orders.filter(
      (o) => rawIds.includes(o.id) && o.location !== "PICKED_UP",
    );
    if (toCollect.length === 0) {
      return NextResponse.json({ ok: true, alreadyCollected: true });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.order.updateMany({
        where: { id: { in: toCollect.map((o) => o.id) } },
        data: { location: "PICKED_UP", financialStatus: "UD" },
      });

      await tx.orderHistory.createMany({
        data: toCollect.map((o) => ({
          orderId: o.id,
          action: `Collected in Pickup Batch ${batch.batchNumber}`,
          location: "PICKED_UP",
          driverId: driverProfile.id,
          userId: user.id,
          meta: {
            action: "PICKUP_COLLECT",
            performedBy: "driver",
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            timestamp: new Date().toISOString(),
          },
        })),
      });

      const pickedUpCount =
        batch.orders.filter((o) => o.location === "PICKED_UP").length +
        toCollect.length;
      const allCollected = pickedUpCount >= batch.totalOrders;

      const updated = await tx.pickupBatch.update({
        where: { id: batch.id },
        data: {
          pickedUpCount,
          ...(allCollected && { status: "PICKED_UP" }),
        },
      });

      return { updated, allCollected };
    });

    return NextResponse.json({
      ok: true,
      collected: toCollect.length,
      allCollected: result.allCollected,
      batch: {
        id: result.updated.id,
        status: result.updated.status,
        pickedUpCount: result.updated.pickedUpCount,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PATCH /api/driver/pickup-batches/:id/collect] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
