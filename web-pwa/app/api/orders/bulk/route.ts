import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createExchangeOrderFromDelivered } from "@/lib/exchange";
import { orderIdForFinancialStatus } from "@/lib/order-id";
import { requireAuthenticatedSession } from "@/lib/server-permissions";

// ─── PATCH /api/orders/bulk ───────────────────────────────────────────────────
export async function PATCH(request: Request) {
  const auth = await requireAuthenticatedSession(request);
  if (auth instanceof Response) return auth;
  try {
    const body = await request.json();
    const { items } = body as { items?: Array<Record<string, unknown>> };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "items array is required and must not be empty" },
        { status: 400 },
      );
    }

    // ── Resolve authenticated user from the (required) session ────────────
    // A valid session is mandatory (see guard above); unauthenticated requests
    // can no longer fall back to acting as an admin.
    const actionUserId = auth.user.id;
    let actionDriverId: string | null | undefined = undefined;

    const driverProfile = await prisma.driverProfile.findUnique({
      where: { userId: actionUserId },
      select: { id: true },
    });
    if (driverProfile) actionDriverId = driverProfile.id;

    // ── Process each item independently ───────────────────────────────────
    const results: Array<{
      id: string;
      success: boolean;
      error?: string;
      order?: Record<string, unknown>;
    }> = [];

    for (const item of items) {
      const id = item.id as string;
      const location = item.location as string | undefined;
      const financialStatus = item.financialStatus as string | undefined;
      const collectedUsd = item.collectedUsd as number | undefined;
      const collectedLbp = item.collectedLbp as number | undefined;
      const driverActionLog = item.driverActionLog as string | undefined;

      if (!id) {
        results.push({ id: "", success: false, error: "Missing order id" });
        continue;
      }

      try {
        const existing = await prisma.order.findUnique({ where: { id } });
        if (!existing) {
          results.push({ id, success: false, error: "Order not found" });
          continue;
        }

        // ── Build update data from provided fields ──────────────────────
        const updateData: Record<string, unknown> = {};

        if (location !== undefined) updateData.location = location;
        if (financialStatus !== undefined)
          updateData.financialStatus = financialStatus;
        if (collectedUsd !== undefined)
          updateData.collectedUsd =
            typeof collectedUsd === "string"
              ? parseFloat(collectedUsd)
              : collectedUsd;
        if (collectedLbp !== undefined)
          updateData.collectedLbp =
            typeof collectedLbp === "string"
              ? parseFloat(collectedLbp)
              : collectedLbp;

        // ── Server-side financial status synchronization ────────────────
        const changes: string[] = [];

        if (updateData.location && updateData.location !== existing.location) {
          if (updateData.location === "DELIVERED") {
            changes.push("Marked as Delivered");
            updateData.financialStatus = "WD";
            if (!updateData.deliveredAt) {
              updateData.deliveredAt = new Date();
            }
            // Collected defaults to the original order amount unless the driver
            // explicitly recorded a different collected price.
            if (updateData.collectedUsd === undefined) {
              updateData.collectedUsd = existing.amountUsd ?? 0;
            }
            if (updateData.collectedLbp === undefined) {
              updateData.collectedLbp = existing.amountLbp ?? 0;
            }
          } else if (
            updateData.location === "ASSIGNED" ||
            updateData.location === "WITH_DRIVER"
          ) {
            updateData.financialStatus = "UD";
            changes.push("Returned to Driver");
            if (existing.deliveredAt) {
              updateData.deliveredAt = null;
            }
          } else if (updateData.location === "RETURN") {
            changes.push("Marked as Return");
            updateData.financialStatus = existing.driverId ? "RWD" : "Re";
          } else if (updateData.location === "WAREHOUSE") {
            changes.push("Returned to Warehouse");
          } else {
            changes.push(`Location changed to ${updateData.location}`);
          }
        }

        if (collectedUsd !== undefined || collectedLbp !== undefined) {
          changes.push(
            `Collected: $${updateData.collectedUsd ?? existing.collectedUsd} | LL${updateData.collectedLbp ?? existing.collectedLbp}`,
          );
        }

        const actionNote = driverActionLog
          ? driverActionLog
          : changes.length > 0
            ? changes.join(" | ")
            : "Order Updated (Bulk)";

        updateData.orderId = orderIdForFinancialStatus(
          existing.orderId,
          String(updateData.financialStatus ?? existing.financialStatus),
        );

        const newLocation =
          (updateData.location as string) || existing.location;
        const newDriverId =
          actionDriverId ??
          (updateData.driverId as string | null) ??
          existing.driverId;

        const updatedOrder = await prisma.order.update({
          where: { id },
          data: {
            ...updateData,
            history: {
              create: {
                action: actionNote,
                location: newLocation,
                driverId: newDriverId,
                userId: actionUserId,
              },
            },
          },
        });

        // ── Exchange orders ──────────────────────────────────────────
        // When a bulk-delivered exchange order (hasExchange) is delivered,
        // create the "<orderId>-Exchange" proof order (idempotent).
        if (
          newLocation === "DELIVERED" &&
          existing.hasExchange &&
          actionUserId
        ) {
          await createExchangeOrderFromDelivered(existing, actionUserId);
        }

        results.push({
          id,
          success: true,
          order: updatedOrder,
        });
      } catch (error: unknown) {
        console.error(
          `[PATCH /api/orders/bulk] Item ${id} failed:`,
          error,
        );
        results.push({
          id,
          success: false,
          error: "Failed to update order",
        });
      }
    }

    return NextResponse.json({ results }, { status: 200 });
  } catch (error: unknown) {
    console.error("[PATCH /api/orders/bulk] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
