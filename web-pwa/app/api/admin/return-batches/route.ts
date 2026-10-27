import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";
import { beirutBatchTimestamp } from "@/lib/sequences";
import { orderIdForFinancialStatus } from "@/lib/order-id";
import {
  ConcurrencyConflictError,
  withConcurrencyRetries,
} from "@/lib/concurrency";

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

// ─── POST /api/admin/return-batches ─────────────────────────────────────────
// Bulk Return-to-Seller batch created from the Orders page Returns tab
// (select rows → "↩ Returned to Seller (n)"). Mirrors the scanner's
// RETURN_TO_SELLER action (app/api/admin/orders/universal-scan/route.ts):
// one ReturnBatch per merchant, strict single-merchant selection, batch
// numbers "Returns-M<merchantId>-<YYYYMMDD-HHmm>" in Beirut time.
//
// Unlike the scanner (which only moves location), this also marks the orders'
// financialStatus RTS (+ "R" orderId suffix) immediately — same as the old
// bare status flip — so the Returns tab shows them as RTS while they are
// linked to the batch and later settle as ONE deduction unit in the cash
// payout workspace.
//
// Body: { orderIds: string[] }  (DB order ids of Re/EX return orders)
export async function POST(request: Request) {
  // Financial transition of delivered/returned orders — same permission as
  // the sibling PATCH /api/admin/orders/returns status machine.
  const auth = await requireServerPermission(request, "ACTION_ORDER_RETURN");
  if (auth instanceof Response) return auth;
  const actionUserId = auth.user.id;

  try {
    const body = await request.json();
    const { orderIds } = body as { orderIds?: string[] };

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "orderIds array is required" },
        { status: 400 },
      );
    }

    // ── Friendly pre-validation (the transaction below re-reads + guards) ──
    const existingOrders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        orderId: true,
        financialStatus: true,
        returnBatchId: true,
        returnDeductionBatchId: true,
        merchantId: true,
      },
    });

    if (existingOrders.length !== orderIds.length) {
      return NextResponse.json(
        {
          error: `${orderIds.length - existingOrders.length} selected order(s) no longer exist — refresh the list.`,
        },
        { status: 400 },
      );
    }

    if (
      existingOrders.some(
        (o) => o.returnBatchId !== null || o.returnDeductionBatchId !== null,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "One or more selected orders are already part of a Return batch or were already deducted in a payout — refresh the list.",
        },
        { status: 400 },
      );
    }

    const ineligible = existingOrders.filter(
      (o) => !["Re", "EX"].includes(o.financialStatus),
    );
    if (ineligible.length > 0) {
      return NextResponse.json(
        {
          error: `${ineligible.length} order(s) are not eligible — only warehouse returns (Re) or exchanges (EX) can be batched. Found: ${ineligible
            .map((o) => o.financialStatus)
            .join(", ")}`,
        },
        { status: 400 },
      );
    }

    const merchantIds = Array.from(
      new Set(
        existingOrders
          .map((o) => o.merchantId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (merchantIds.length === 0) {
      return NextResponse.json(
        { error: "Orders must have a valid seller attached" },
        { status: 400 },
      );
    }
    if (merchantIds.length > 1) {
      return NextResponse.json(
        {
          error:
            "All selected orders must belong to the same seller — filter by Seller first, then select that seller's orders.",
        },
        { status: 400 },
      );
    }

    const targetMerchantId = merchantIds[0];
    const merchant = await prisma.merchant.findUnique({
      where: { id: targetMerchantId },
      select: { id: true, merchantId: true, merchantName: true },
    });
    if (!merchant) {
      return NextResponse.json(
        { error: "Orders must have a valid seller attached" },
        { status: 400 },
      );
    }

    // ── Create the batch (retry on unique-number collisions / CAS conflicts) ──
    const baseBatchNumber = `Returns-M${merchant.merchantId}-${beirutBatchTimestamp(new Date())}`;
    let attempt = 0;

    const created = await withConcurrencyRetries(async () => {
      attempt += 1;
      const batchNumber =
        attempt === 1 ? baseBatchNumber : `${baseBatchNumber}-${attempt + 1}`;

      return prisma.$transaction(async (tx) => {
        const batch = await tx.returnBatch.create({
          data: {
            batchNumber,
            merchantId: merchant.id,
            totalOrders: orderIds.length,
            status: "PENDING",
          },
        });

        // CAS guard: claim each order only if it is still an unbatched Re/EX.
        // A mismatch means another request batched/settled rows under us.
        const claimed = await tx.order.updateMany({
          where: {
            id: { in: orderIds },
            financialStatus: { in: ["Re", "EX"] },
            returnBatchId: null,
            returnDeductionBatchId: null,
          },
          data: { returnBatchId: batch.id },
        });
        if (claimed.count !== orderIds.length) {
          throw new ConcurrencyConflictError();
        }

        // Mark RTS + orderId suffix per order (same as the old status-flip
        // path; settlement later re-applies this idempotently).
        for (const o of existingOrders) {
          await tx.order.update({
            where: { id: o.id },
            data: {
              orderId: orderIdForFinancialStatus(o.orderId, "RTS"),
              financialStatus: "RTS",
            },
          });
        }

        await tx.orderHistory.createMany({
          data: existingOrders.map((o) => ({
            orderId: o.id,
            action:
              o.financialStatus === "EX"
                ? "Exchange to Seller: EX → RTS"
                : "Returned to Seller: Re → RTS",
            location: "RETURN",
            userId: actionUserId,
            meta: {
              batchNumber,
              merchantName: merchant.merchantName,
              source: "orders-tab-returns-bulk",
              timestamp: new Date().toISOString(),
            },
          })),
        });

        return batch;
      });
    });

    return NextResponse.json(
      {
        success: true,
        batchId: created.id,
        batchNumber: created.batchNumber,
        count: orderIds.length,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[POST /api/admin/return-batches] Error:", message);
    if (error instanceof ConcurrencyConflictError) {
      return NextResponse.json(
        {
          error:
            "Some selected orders were changed by another user while you were submitting — please refresh and try again.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
