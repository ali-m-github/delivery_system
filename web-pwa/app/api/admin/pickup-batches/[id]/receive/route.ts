import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// PATCH /api/admin/pickup-batches/[id]/receive — Warehouse intake reconciliation.
// Body: { receivedOrderIds: string[], discrepancyNotes?: string }
//   receivedOrderIds — the batch orders the warehouse physically verified.
//   - Every order matched  -> batch COMPLETED, orders location="WAREHOUSE",
//     financialStatus="UD" (they join the normal warehouse flow).
//   - Anything missing     -> batch DISCREPANCY with discrepancyNote; matched
//     orders still move to WAREHOUSE, missing orders stay PICKED_UP so the
//     gap is visible and follow-up (driver/merchant) can resolve it.
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
    const receivedIds: string[] = Array.isArray(body.receivedOrderIds)
      ? (body.receivedOrderIds as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [];

    const batch = await prisma.pickupBatch.findUnique({
      where: { id },
      include: {
        orders: { select: { id: true, orderId: true, location: true } },
      },
    });
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }
    if (batch.status !== "PICKED_UP") {
      return NextResponse.json(
        {
          error:
            batch.status === "COMPLETED" || batch.status === "DISCREPANCY"
              ? `Batch intake was already processed (${batch.status})`
              : `Batch has not been collected by a driver yet (${batch.status})`,
        },
        { status: 409 },
      );
    }

    const receivedSet = new Set(receivedIds);
    const invalid = batch.orders.filter((o) => !receivedSet.has(o.id) && receivedIds.includes(o.id));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: "One or more orders do not belong to this batch" },
        { status: 400 },
      );
    }

    const matched = batch.orders.filter((o) => receivedSet.has(o.id));
    const missing = batch.orders.filter((o) => !receivedSet.has(o.id));
    const allMatched = missing.length === 0;

    const note =
      typeof body.discrepancyNotes === "string" ? body.discrepancyNotes.trim() : "";
    const discrepancyNote = allMatched
      ? null
      : note ||
        `Missing at warehouse intake: ${missing.map((o) => o.orderId).join(", ")}`;

    const result = await prisma.$transaction(async (tx) => {
      if (matched.length > 0) {
        await tx.order.updateMany({
          where: { id: { in: matched.map((o) => o.id) } },
          data: { location: "WAREHOUSE", financialStatus: "UD" },
        });

        await tx.orderHistory.createMany({
          data: matched.map((o) => ({
            orderId: o.id,
            action: `Received at warehouse via Pickup Batch ${batch.batchNumber}`,
            location: "WAREHOUSE",
            userId: actor.id,
            meta: {
              action: "PICKUP_RECEIVE",
              performedBy: actor.role,
              batchId: batch.id,
              batchNumber: batch.batchNumber,
              timestamp: new Date().toISOString(),
            },
          })),
        });
      }

      if (missing.length > 0) {
        await tx.orderHistory.createMany({
          data: missing.map((o) => ({
            orderId: o.id,
            action: `MISSING at warehouse intake of Pickup Batch ${batch.batchNumber}`,
            location: o.location,
            userId: actor.id,
            meta: {
              action: "PICKUP_DISCREPANCY",
              performedBy: actor.role,
              batchId: batch.id,
              batchNumber: batch.batchNumber,
              timestamp: new Date().toISOString(),
            },
          })),
        });
      }

      const updated = await tx.pickupBatch.update({
        where: { id: batch.id },
        data: {
          status: allMatched ? "COMPLETED" : "DISCREPANCY",
          receivedCount: matched.length,
          discrepancyNote,
        },
      });

      return { updated, matched, missing };
    });

    return NextResponse.json({
      ok: true,
      allMatched,
      matched: result.matched.length,
      missing: result.missing.map((o) => ({ id: o.id, orderId: o.orderId })),
      batch: {
        id: result.updated.id,
        status: result.updated.status,
        receivedCount: result.updated.receivedCount,
        discrepancyNote: result.updated.discrepancyNote,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PATCH /api/admin/pickup-batches/:id/receive] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
