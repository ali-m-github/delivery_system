import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// GET /api/admin/return-batches — Return-to-Seller handoff batches created by
// the Universal Staff Scanner (Phase 1/2 of the Return Batch Pipeline).
//
// Supports:
//   ?status=PENDING|COMPLETED|SETTLED   (default: all)
//   ?merchantId=<merchant uuid>         (optional scope)
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD      (batch createdAt range)
//   ?search=8627,78981891               (comma-separated order-id tokens —
//                                        matches batches CONTAINING those orders)
//
// Each batch carries its full order breakdown (recipient, phone, COD), the
// staff member who physically handed the packages over (from the
// SC_RETURNED_TO_SELLER_RTS OrderHistory meta), per-order return reason codes,
// and the settlement link (CashPayoutBatch reference) when settled.
export async function GET(request: Request) {
  try {
    const auth = await requireServerPermission(request, "MANAGE_ORDERS");
    if (auth instanceof Response) return auth;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "";
    const merchantId = searchParams.get("merchantId") || "";
    const from = searchParams.get("from") || "";
    const to = searchParams.get("to") || "";
    const search = searchParams.get("search") || "";

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (merchantId) where.merchantId = merchantId;

    const createdAt: { gte?: Date; lte?: Date } = {};
    if (from) createdAt.gte = new Date(from);
    if (to) createdAt.lte = new Date(`${to}T23:59:59.999Z`);
    if (Object.keys(createdAt).length) where.createdAt = createdAt;

    // Comma-separated order-id search: resolve matching orders first, then
    // restrict to the batches that contain them.
    const tokens = search
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length) {
      const matchingOrders = await prisma.order.findMany({
        where: {
          returnBatchId: { not: null },
          OR: tokens.map((t) => ({ orderId: { contains: t, mode: "insensitive" } })),
        },
        select: { returnBatchId: true },
      });
      const batchIds = Array.from(
        new Set(
          matchingOrders
            .map((o) => o.returnBatchId)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      where.id = { in: batchIds };
    }

    const batches = await prisma.returnBatch.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        merchant: {
          select: { id: true, merchantId: true, merchantName: true },
        },
        cashPayoutBatch: {
          select: { id: true, batchReference: true, createdAt: true },
        },
        orders: {
          select: {
            id: true,
            orderId: true,
            customerName: true,
            customerPhone: true,
            amountUsd: true,
            location: true,
            financialStatus: true,
            createdAt: true,
            history: {
              where: {
                action: {
                  in: ["SC_RETURNED_TO_SELLER_RTS", "RETURNED_TO_SELLER_RTS"],
                },
              },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { meta: true, createdAt: true },
            },
          },
          orderBy: { orderId: "asc" },
        },
      },
    });

    // Flatten the scanner audit meta: handedOverBy (staff who scanned the
    // handoff) and per-order reasonCode (driver exception reason, if any).
    const normalized = batches.map((batch) => {
      let handedOverBy: string | null = null;
      const orders = batch.orders.map((o) => {
        const meta = (o.history[0]?.meta ?? null) as {
          staffName?: string;
          reasonCode?: string;
        } | null;
        if (!handedOverBy && meta?.staffName) handedOverBy = meta.staffName;
        return {
          id: o.id,
          orderId: o.orderId,
          customerName: o.customerName,
          customerPhone: o.customerPhone,
          amountUsd: o.amountUsd,
          location: o.location,
          financialStatus: o.financialStatus,
          createdAt: o.createdAt,
          reasonCode: meta?.reasonCode ?? null,
        };
      });

      return {
        id: batch.id,
        batchNumber: batch.batchNumber,
        status: batch.status,
        totalOrders: batch.totalOrders,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
        merchant: batch.merchant,
        settlement: batch.cashPayoutBatch
          ? {
              cashPayoutBatchId: batch.cashPayoutBatch.id,
              batchReference: batch.cashPayoutBatch.batchReference,
              settledAt: batch.cashPayoutBatch.createdAt,
            }
          : null,
        handedOverBy,
        orders,
      };
    });

    return NextResponse.json({ batches: normalized });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[GET /api/admin/return-batches] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
