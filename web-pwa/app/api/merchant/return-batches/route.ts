import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerRole } from "@/lib/server-permissions";

// GET /api/merchant/return-batches — the authenticated merchant's
// Return-to-Seller handoff batches (Phase 2 of the Return Batch Pipeline).
//
// Supports:
//   ?status=PENDING|COMPLETED|SETTLED   (default: all)
//   ?search=<order id token>            (matches batches CONTAINING that order)
//
// Each batch carries its full order breakdown (recipient, phone, COD, return
// reason from the scanner OrderHistory meta) and the settlement link
// (CashPayoutBatch reference) when the deductions were paid out.
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

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "";
    const search = searchParams.get("search") || "";

    const where: Record<string, unknown> = { merchantId: merchant.id };
    if (status) where.status = status;

    // Optional order-id search: resolve the merchant's matching orders first,
    // then restrict to the batches that contain them.
    const token = search.trim();
    if (token) {
      const matchingOrders = await prisma.order.findMany({
        where: {
          merchantId: merchant.id,
          returnBatchId: { not: null },
          orderId: { contains: token, mode: "insensitive" },
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
    console.error("[GET /api/merchant/return-batches] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
