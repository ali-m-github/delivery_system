import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createExchangeOrderFromDelivered } from "@/lib/exchange";
import { orderIdForFinancialStatus } from "@/lib/order-id";
import { hasPermission } from "@/lib/permissions";
import { requireAuthenticatedSession } from "@/lib/server-permissions";

// ─── Per-role edit boundaries (must stay in sync with PATCH /api/orders) ────
// The bulk endpoint edits the same rows as the single-order endpoint, so it
// enforces the same role/ownership/permission model:
//  • DRIVER   → own orders only, location restricted to the driver flow
//  • MERCHANT → own orders only (none of the bulk fields are merchant-editable)
//  • staff    → ORDERS_EDIT; monetary fields additionally need ORDERS_FINANCIAL
const DRIVER_ALLOWED_LOCATIONS = new Set<string>([
  "DELIVERED",
  "RETURN",
  "WITH_DRIVER",
  "ASSIGNED",
  "ASSIGNED_TR",
]);
const BULK_FINANCIAL_FIELDS = ["collectedUsd", "collectedLbp"] as const;

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
    const actor = auth.user;
    const actorIsAdmin = actor.role === "ADMIN";
    let actionDriverId: string | null | undefined = undefined;
    let actorMerchantId: string | null = null;

    if (actor.role === "DRIVER") {
      const driverProfile = await prisma.driverProfile.findUnique({
        where: { userId: actionUserId },
        select: { id: true },
      });
      actionDriverId = driverProfile?.id ?? null;
    } else if (actor.role === "MERCHANT") {
      const merchant = await prisma.merchant.findUnique({
        where: { userId: actionUserId },
        select: { id: true },
      });
      actorMerchantId = merchant?.id ?? null;
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
      // NOTE: `item.financialStatus` may arrive in payloads for legacy/compat
      // reasons; it is intentionally never read or written — the server
      // derives financialStatus from the resulting location (see below).
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

        // ── Role/ownership scoping (mirrors single-order PATCH) ─────────────
        if (actor.role === "DRIVER") {
          const isOwnOrder =
            actionDriverId !== null && existing.driverId === actionDriverId;
          if (!isOwnOrder) {
            results.push({
              id,
              success: false,
              error: "Drivers can only update their own orders",
            });
            continue;
          }
          if (
            location !== undefined &&
            !DRIVER_ALLOWED_LOCATIONS.has(location)
          ) {
            results.push({
              id,
              success: false,
              error:
                "Drivers can only move their orders to DELIVERED, RETURN, WITH_DRIVER, ASSIGNED or ASSIGNED_TR",
            });
            continue;
          }
        } else if (actor.role === "MERCHANT") {
          if (!actorMerchantId || existing.merchantId !== actorMerchantId) {
            results.push({
              id,
              success: false,
              error: "Merchants can only update their own orders",
            });
            continue;
          }
          // None of the bulk fields (location / collected*) are in the
          // merchant field whitelist, so a merchant bulk edit can never be
          // legitimate — fail the item explicitly instead of a silent no-op.
          results.push({
            id,
            success: false,
            error:
              "Merchants cannot update order location or collected amounts",
          });
          continue;
        } else {
          // ADMIN and staff share the staff path; ADMIN passes via the ADMIN
          // bypass inside hasPermission, so full authority is preserved.
          if (!hasPermission(actor, "ORDERS_EDIT")) {
            results.push({
              id,
              success: false,
              error:
                "Staff users require the ORDERS_EDIT permission to update orders",
            });
            continue;
          }
          // Financial field gate (staff only — ADMIN bypasses).
          if (!actorIsAdmin) {
            const touchedFinancial = BULK_FINANCIAL_FIELDS.filter(
              (f) => (f === "collectedUsd" ? collectedUsd : collectedLbp) !== undefined,
            );
            if (
              touchedFinancial.length > 0 &&
              !hasPermission(actor, "ORDERS_FINANCIAL")
            ) {
              results.push({
                id,
                success: false,
                error: `Financial fields (${touchedFinancial.join(", ")}) require the ORDERS_FINANCIAL permission`,
              });
              continue;
            }
          }
        }

        // ── Financial state protection (mirrors single-order PATCH) ────────
        // WO = cleared in the payout workflow; only admins may touch it here.
        if (existing.financialStatus === "WO" && !actorIsAdmin) {
          results.push({
            id,
            success: false,
            error:
              'Only administrators can modify orders with status "WO" (cleared payout). Contact an admin to roll back this order.',
          });
          continue;
        }

        // ── Payout integrity ───────────────────────────────────────────────
        // An order linked to a driver payout (driverPayoutId != null) is owned
        // by the payout workflow. Bulk edits write location/financialStatus/
        // collected directly with NO payout reconciliation: changing
        // collectedUsd/collectedLbp would desync the payout's stored totals
        // from its order ledger, and a location change would silently detach
        // or alter the payout lifecycle. The payout-recalculation logic lives
        // in the single-order PATCH /api/orders and the payout/return
        // endpoints, where it is atomic — it is deliberately NOT duplicated
        // here.
        //
        // This restriction applies to EVERY role, INCLUDING ADMIN: even a
        // legitimate admin edit through this bulk endpoint must never
        // desynchronize an existing payout. Orders not linked to any payout
        // keep their normal, harmless behavior.
        if (existing.driverPayoutId !== null) {
          results.push({
            id,
            success: false,
            error:
              "Order is linked to a driver payout; bulk edit cannot affect its financials or lifecycle. Use PATCH /api/orders or the dedicated payout/return workflow (atomic reconciliation).",
          });
          continue;
        }

        // ── Build update data from provided fields ──────────────────────
        // NOTE: financialStatus is never taken from the payload — it is
        // derived server-side from the resulting location below.
        const updateData: Record<string, unknown> = {};

        if (location !== undefined) updateData.location = location;
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

        // ── Value validation (mirrors single-order PATCH) ─────────────────
        let invalidValue: string | null = null;
        if (
          location !== undefined &&
          (typeof location !== "string" || location.trim() === "")
        ) {
          invalidValue = "location";
        }
        for (const field of BULK_FINANCIAL_FIELDS) {
          const value = updateData[field];
          if (value !== undefined) {
            const num = typeof value === "number" ? value : Number(value);
            if (!Number.isFinite(num) || num < 0) {
              invalidValue = field;
              break;
            }
            updateData[field] = num;
          }
        }
        if (invalidValue) {
          results.push({
            id,
            success: false,
            error: `Invalid value for ${invalidValue}`,
          });
          continue;
        }
        if (typeof location === "string") updateData.location = location.trim();

        // ── Server-side financial status synchronization ────────────────
        // financialStatus is derived from the resulting location (the
        // client value, if any, is ignored) — same rules as the
        // single-order endpoint.
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
            updateData.location === "ASSIGNED_TR" ||
            updateData.location === "WITH_DRIVER"
          ) {
            updateData.financialStatus = "UD";
            if (
              updateData.location === "ASSIGNED_TR" &&
              updateData.driverId !== undefined &&
              updateData.driverId !== existing.driverId
            ) {
              changes.push("Assigned to Driver (Transit)");
            } else {
              changes.push("Returned to Driver");
            }
            if (existing.deliveredAt) {
              updateData.deliveredAt = null;
            }
          } else if (updateData.location === "RETURN") {
            changes.push("Marked as Return");
            updateData.financialStatus = existing.driverId ? "RWD" : "Re";
          } else if (updateData.location === "WAREHOUSE") {
            changes.push("Returned to Warehouse");
            // Back in the warehouse => not delivered, back in the normal flow
            // (mirrors the single-order endpoint).
            updateData.financialStatus = "UD";
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
