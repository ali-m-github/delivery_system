import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { nextPickupBatchNumber } from "@/lib/sequences";
import { requireServerRole } from "@/lib/server-permissions";

// ─── Two-Point Chain-of-Custody: merchant pickup batches ────────────────────
// POST creates a PickupBatch from a set of the merchant's CP-staged orders;
// GET returns the merchant's batch history with per-order reconciliation data.

// POST /api/merchant/pickup-batches — Request a pickup for selected CP orders
// Body: { orderIds: string[] } — internal order ids (cuid) or human orderIds.
export async function POST(request: Request) {
  try {
    const auth = await requireServerRole(request, "MERCHANT");
    if (auth instanceof Response) return auth;
    const user = auth.user;

    const merchant = await prisma.merchant.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!merchant) {
      return NextResponse.json(
        { error: "No merchant profile linked to your account" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const rawIds: string[] = Array.isArray(body.orderIds)
      ? (body.orderIds as unknown[]).map((id) => String(id).trim()).filter(Boolean)
      : [];

    if (rawIds.length === 0) {
      return NextResponse.json(
        { error: "No orders selected" },
        { status: 400 },
      );
    }
    if (rawIds.length > 200) {
      return NextResponse.json(
        { error: "A pickup batch may contain at most 200 orders" },
        { status: 400 },
      );
    }

    // Accept either the internal cuid or the human-readable orderId.
    const orders = await prisma.order.findMany({
      where: {
        merchantId: merchant.id,
        OR: [{ id: { in: rawIds } }, { orderId: { in: rawIds } }],
      },
      select: { id: true, orderId: true, location: true, pickupBatchId: true },
    });

    if (orders.length !== rawIds.length) {
      return NextResponse.json(
        { error: "One or more orders were not found for this merchant" },
        { status: 400 },
      );
    }

    const invalid = orders.filter(
      (o) => o.location !== "CP" || o.pickupBatchId !== null,
    );
    if (invalid.length > 0) {
      return NextResponse.json(
        {
          error: `Orders must be in the CP pickup box and not already in a batch: ${invalid
            .map((o) => o.orderId)
            .join(", ")}`,
        },
        { status: 400 },
      );
    }

    // batchNumber is @unique; a P2002 means another request allocated the same
    // number concurrently — regenerate and retry (same pattern as order IDs).
    let batch;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        batch = await prisma.$transaction(async (tx) => {
          const batchNumber = await nextPickupBatchNumber(tx);
          const created = await tx.pickupBatch.create({
            data: {
              batchNumber,
              merchantId: merchant.id,
              totalOrders: orders.length,
            },
          });

          await tx.order.updateMany({
            where: { id: { in: orders.map((o) => o.id) } },
            data: { pickupBatchId: created.id },
          });

          // Audit trail on every order so the chain-of-custody is visible in
          // the standard order-history modal.
          await tx.orderHistory.createMany({
            data: orders.map((o) => ({
              orderId: o.id,
              action: `Pickup Batch Requested (${created.batchNumber})`,
              location: "CP",
              userId: user.id,
              meta: { batchId: created.id, batchNumber: created.batchNumber },
            })),
          });

          return created;
        });
        break;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002" &&
          attempt < 5
        ) {
          continue;
        }
        throw e;
      }
    }

    if (!batch) {
      return NextResponse.json(
        { error: "Could not allocate a batch number, please retry" },
        { status: 500 },
      );
    }

    return NextResponse.json({ batch }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[POST /api/merchant/pickup-batches] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/merchant/pickup-batches — Batch history with item breakdown
export async function GET(request: Request) {
  try {
    const auth = await requireServerRole(request, "MERCHANT");
    if (auth instanceof Response) return auth;
    const user = auth.user;

    const merchant = await prisma.merchant.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!merchant) {
      return NextResponse.json(
        { error: "No merchant profile linked to your account" },
        { status: 403 },
      );
    }

    const batches = await prisma.pickupBatch.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: "desc" },
      include: {
        driver: {
          select: { id: true, firstName: true, lastName: true },
        },
        orders: {
          select: {
            id: true,
            orderId: true,
            customerName: true,
            location: true,
            financialStatus: true,
          },
          orderBy: { orderId: "asc" },
        },
      },
    });

    return NextResponse.json({ batches });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[GET /api/merchant/pickup-batches] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
