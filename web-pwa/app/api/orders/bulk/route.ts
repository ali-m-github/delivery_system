import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { createExchangeOrderFromDelivered } from "@/lib/exchange";

// ─── PATCH /api/orders/bulk ───────────────────────────────────────────────────
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { items } = body as { items?: Array<Record<string, unknown>> };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "items array is required and must not be empty" },
        { status: 400 },
      );
    }

    // ── Resolve authenticated user from session cookie ────────────────────
    const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    let actionUserId = adminUser?.id;
    let actionDriverId: string | null | undefined = undefined;

    try {
      const cookieStore = await cookies();
      const token = cookieStore.get("session")?.value;
      if (token) {
        const secret = new TextEncoder().encode(process.env.JWT_SECRET);
        const { payload } = await jwtVerify(token, secret);
        const sessionUserId = payload.id as string;
        if (sessionUserId) {
          actionUserId = sessionUserId;
          const driverProfile = await prisma.driverProfile.findUnique({
            where: { userId: sessionUserId },
            select: { id: true },
          });
          if (driverProfile) actionDriverId = driverProfile.id;
        }
      }
    } catch {
      // Session lookup is best-effort; fall back to admin user
    }

    if (!actionUserId) {
      return NextResponse.json(
        { error: "Unable to resolve action user" },
        { status: 401 },
      );
    }

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
      } catch (error: any) {
        console.error(
          `[PATCH /api/orders/bulk] Item ${id} failed:`,
          error.message,
        );
        results.push({
          id,
          success: false,
          error: error.message || "Failed to update order",
        });
      }
    }

    return NextResponse.json({ results }, { status: 200 });
  } catch (error: any) {
    console.error("[PATCH /api/orders/bulk] Error:", error.message);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    );
  }
}
