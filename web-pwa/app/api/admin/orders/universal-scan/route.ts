import { NextRequest, NextResponse } from "next/server";
import type { ReturnBatch } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";
import { beirutBatchTimestamp } from "@/lib/sequences";

// ─── POST /api/admin/orders/universal-scan ────────────────────────────────────
// Central endpoint for the Universal Staff Scanner tray. Every action here is
// performed by a staff member holding a physical scanner, so each mutation also
// writes an OrderHistory row whose action is prefixed "SC_" and whose meta
// carries { isScannerAction: true, staffName, ... } (rendered as an [SC] badge
// in components/OrderHistoryModal.tsx).
//
// staffName is ALWAYS derived from the authenticated session — never trusted
// from the request body.
//
// Required permission: MANAGE_ORDERS (same guard as the pickup-batch intake
// routes, since RECEIVE_PICKUP reconciles PickupBatch rows).
//
// Request body:
//   {
//     action: "RECEIVE_PICKUP" | "ASSIGN_DRIVER" | "RETURNS_WAREHOUSE"
//           | "RETURN_TO_SELLER" | "MARK_DELIVERED",
//     orderIds: string[],          // DB order ids (required, non-empty)
//     driverId?: string,           // DriverProfile.id — ASSIGN_DRIVER only
//     assignmentType?: "DR" | "TR",// DR = delivery run (WITH_DRIVER),
//                                  // TR = transfer run (ASSIGNED_TR)
//   }

const VALID_ACTIONS = new Set([
  "RECEIVE_PICKUP",
  "ASSIGN_DRIVER",
  "RETURNS_WAREHOUSE",
  "RETURN_TO_SELLER",
  "MARK_DELIVERED",
]);

export async function POST(request: NextRequest) {
  const auth = await requireServerPermission(request, "MANAGE_ORDERS");
  if (auth instanceof Response) return auth;
  const actor = auth.user;

  try {
    const body = await request.json();
    const { action, orderIds, driverId, assignmentType } = body as {
      action?: string;
      orderIds?: string[];
      driverId?: string;
      assignmentType?: "DR" | "TR";
    };

    if (!action || !VALID_ACTIONS.has(action)) {
      return NextResponse.json(
        { error: "Invalid scanner action" },
        { status: 400 },
      );
    }

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: "orderIds array is required and must not be empty" },
        { status: 400 },
      );
    }

    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        orderId: true,
        location: true,
        financialStatus: true,
        driverId: true,
        merchantId: true,
        pickupBatchId: true,
      },
    });

    if (orders.length === 0) {
      return NextResponse.json({ error: "Orders not found" }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    // Server-derived staff identity for the audit trail — never client input.
    const staffName = actor.username;

    // ══════════════════════════════════════════════════════════════════════
    // ACTION 1: RECEIVE PICKUP (cross-dock multi-batch auto-reconciliation)
    // ══════════════════════════════════════════════════════════════════════
    if (action === "RECEIVE_PICKUP") {
      const affectedBatchIds = Array.from(
        new Set(
          orders
            .map((o) => o.pickupBatchId)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      await prisma.$transaction(async (tx) => {
        await tx.order.updateMany({
          where: { id: { in: orders.map((o) => o.id) } },
          data: { location: "WAREHOUSE", financialStatus: "UD" },
        });

        await tx.orderHistory.createMany({
          data: orders.map((order) => ({
            orderId: order.id,
            action: "SC_RECEIVED_AT_WAREHOUSE",
            location: "WAREHOUSE",
            userId: actor.id,
            meta: {
              isScannerAction: true,
              staffName,
              previousLocation: order.location,
              timestamp: nowIso,
            },
          })),
        });

        // Reconcile every affected PickupBatch against the FULL batch, not just
        // the scanned subset: COMPLETED only when every order in the batch is
        // now at the warehouse, otherwise DISCREPANCY with the missing count.
        for (const batchId of affectedBatchIds) {
          const allBatchOrders = await tx.order.findMany({
            where: { pickupBatchId: batchId },
            select: { id: true, location: true },
          });

          const total = allBatchOrders.length;
          const warehouseReceived = allBatchOrders.filter(
            (o) => o.location === "WAREHOUSE",
          ).length;
          const isComplete = total > 0 && warehouseReceived >= total;

          await tx.pickupBatch.update({
            where: { id: batchId },
            data: {
              receivedCount: warehouseReceived,
              status: isComplete ? "COMPLETED" : "DISCREPANCY",
              discrepancyNote: isComplete
                ? null
                : `Missing ${total - warehouseReceived} package(s) on intake scan`,
            },
          });
        }
      });

      return NextResponse.json({
        success: true,
        count: orders.length,
        reconciledBatches: affectedBatchIds.length,
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION 2: ASSIGN DRIVER (Dr run = WITH_DRIVER, Tr run = ASSIGNED_TR)
    // ══════════════════════════════════════════════════════════════════════
    if (action === "ASSIGN_DRIVER") {
      if (!driverId) {
        return NextResponse.json(
          { error: "Please select a driver" },
          { status: 400 },
        );
      }

      // Order.driverId references DriverProfile.id (see schema.prisma), so the
      // picker's id must be resolved against driverProfile, not user.
      const driver = await prisma.driverProfile.findUnique({
        where: { id: driverId },
        select: { id: true, firstName: true, lastName: true, driverId: true },
      });
      if (!driver) {
        return NextResponse.json(
          { error: "Selected driver does not exist" },
          { status: 404 },
        );
      }

      const isTransferRun = assignmentType === "TR";
      const newLocation = isTransferRun ? "ASSIGNED_TR" : "WITH_DRIVER";
      const historyAction = isTransferRun
        ? "SC_ASSIGNED_DRIVER_TR"
        : "SC_ASSIGNED_DRIVER_DR";
      const driverName = `${driver.firstName} ${driver.lastName}`.trim();

      await prisma.$transaction(async (tx) => {
        await tx.order.updateMany({
          where: { id: { in: orders.map((o) => o.id) } },
          data: { driverId: driver.id, location: newLocation },
        });

        await tx.orderHistory.createMany({
          data: orders.map((order) => ({
            orderId: order.id,
            action: historyAction,
            location: newLocation,
            driverId: driver.id,
            userId: actor.id,
            meta: {
              isScannerAction: true,
              staffName,
              driverName,
              driverCode: driver.driverId,
              driverId: driver.id,
              assignmentType: isTransferRun ? "TR" : "DR",
              previousLocation: order.location,
              timestamp: nowIso,
            },
          })),
        });
      });

      return NextResponse.json({
        success: true,
        count: orders.length,
        location: newLocation,
        driverName,
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION 3a: RETURNS WAREHOUSE (physical returns cage)
    // ══════════════════════════════════════════════════════════════════════
    if (action === "RETURNS_WAREHOUSE") {
      await prisma.$transaction(async (tx) => {
        await tx.order.updateMany({
          where: { id: { in: orders.map((o) => o.id) } },
          data: { location: "RETURN", financialStatus: "UD" },
        });

        await tx.orderHistory.createMany({
          data: orders.map((order) => ({
            orderId: order.id,
            action: "SC_MOVED_TO_RETURNS_WAREHOUSE",
            location: "RETURN",
            userId: actor.id,
            meta: {
              isScannerAction: true,
              staffName,
              previousLocation: order.location,
              timestamp: nowIso,
            },
          })),
        });
      });

      return NextResponse.json({ success: true, count: orders.length });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION 3b: RETURN TO SELLER (RTS) — strict single-merchant batches
    // ══════════════════════════════════════════════════════════════════════
    if (action === "RETURN_TO_SELLER") {
      const uniqueMerchantIds = Array.from(
        new Set(
          orders
            .map((o) => o.merchantId)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      if (uniqueMerchantIds.length === 0) {
        return NextResponse.json(
          { error: "Orders must have a valid merchant attached" },
          { status: 400 },
        );
      }

      if (uniqueMerchantIds.length > 1) {
        return NextResponse.json(
          {
            error: `Mixed merchants detected (${uniqueMerchantIds.length} merchants). All orders in a Return to Seller batch MUST belong to the same merchant.`,
          },
          { status: 400 },
        );
      }

      const targetMerchantId = uniqueMerchantIds[0];
      const merchant = await prisma.merchant.findUnique({
        where: { id: targetMerchantId },
        select: { id: true, merchantId: true, merchantName: true },
      });
      if (!merchant) {
        return NextResponse.json(
          { error: "Orders must have a valid merchant attached" },
          { status: 400 },
        );
      }

      // "Returns-M102-20261013-1830" — numeric merchant ID + Beirut wall clock.
      const baseBatchNumber = `Returns-M${merchant.merchantId}-${beirutBatchTimestamp(new Date())}`;

      // Two RTS runs for the same merchant inside the same minute would
      // collide on the unique batchNumber; disambiguate with a counter. The
      // retry must wrap the ENTIRE transaction: a P2002 thrown inside an
      // interactive transaction aborts it, so retrying inside the callback
      // would operate on a closed transaction.
      let batchNumber = baseBatchNumber;
      let returnBatch: ReturnBatch | null = null;
      for (let attempt = 1; ; attempt++) {
        try {
          returnBatch = await prisma.$transaction(async (tx) => {
            const batch = await tx.returnBatch.create({
              data: {
                batchNumber,
                merchantId: merchant.id,
                totalOrders: orders.length,
                status: "PENDING",
              },
            });

            await tx.order.updateMany({
              where: { id: { in: orders.map((o) => o.id) } },
              data: { location: "RTS", returnBatchId: batch.id },
            });

            await tx.orderHistory.createMany({
              data: orders.map((order) => ({
                orderId: order.id,
                action: "SC_RETURNED_TO_SELLER_RTS",
                location: "RTS",
                userId: actor.id,
                meta: {
                  isScannerAction: true,
                  staffName,
                  batchNumber,
                  merchantName: merchant.merchantName,
                  previousLocation: order.location,
                  timestamp: nowIso,
                },
              })),
            });

            return batch;
          });
          break;
        } catch (err: unknown) {
          const isUniqueViolation =
            typeof err === "object" &&
            err !== null &&
            (err as { code?: string }).code === "P2002";
          if (!isUniqueViolation || attempt > 20) throw err;
          batchNumber = `${baseBatchNumber}-${attempt + 1}`;
        }
      }

      return NextResponse.json({
        success: true,
        batchNumber: returnBatch.batchNumber,
        count: orders.length,
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION 4: MARK DELIVERED (driver-assignment guardrail)
    // ══════════════════════════════════════════════════════════════════════
    if (action === "MARK_DELIVERED") {
      const unassignedOrders = orders.filter((o) => !o.driverId);

      if (unassignedOrders.length > 0) {
        const sampleNumbers = unassignedOrders
          .slice(0, 3)
          .map((o) => `#${o.orderId || o.id.slice(0, 6)}`)
          .join(", ");
        return NextResponse.json(
          {
            error: `Cannot mark as delivered: ${unassignedOrders.length} order(s) (${sampleNumbers}) are not assigned to any driver. Please assign a driver first.`,
          },
          { status: 400 },
        );
      }

      const deliveredAt = new Date();

      await prisma.$transaction(async (tx) => {
        await tx.order.updateMany({
          where: { id: { in: orders.map((o) => o.id) } },
          data: {
            location: "DELIVERED",
            financialStatus: "WD",
            deliveredAt,
          },
        });

        await tx.orderHistory.createMany({
          data: orders.map((order) => ({
            orderId: order.id,
            action: "SC_DELIVERED",
            location: "DELIVERED",
            driverId: order.driverId,
            userId: actor.id,
            meta: {
              isScannerAction: true,
              staffName,
              driverId: order.driverId,
              previousLocation: order.location,
              timestamp: nowIso,
            },
          })),
        });
      });

      return NextResponse.json({ success: true, count: orders.length });
    }

    return NextResponse.json({ error: "Invalid scanner action" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[POST /api/admin/orders/universal-scan] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 },
    );
  }
}
