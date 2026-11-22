import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateTrackToken } from "@/lib/tracking";
import { requireServerPermission } from "@/lib/server-permissions";
import {
  loadMerchantRateRules,
  resolveMerchantShippingRate,
} from "@/lib/merchantRates";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

export async function POST(request: Request) {
  const auth = await requireServerPermission(request, "ORDERS_FINANCIAL");
  if (auth instanceof Response) return auth;
  try {
    // The creator is always the authenticated user; the client-supplied
    // adminUserId is no longer accepted.
    const { orderId, newMerchantId } = await request.json();
    const adminUserId = auth.user.id;

    const originalOrder = await prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!originalOrder)
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (!originalOrder.merchantId)
      return NextResponse.json(
        { error: "Original order has no merchant assigned" },
        { status: 400 },
      );

    // 1+2. Resolve each merchant's shipping charge for this order via the
    // zone-rate RULES (lib/merchantRates.ts): the rule matching the order's
    // zone and creation date, falling back to the universal zone price —
    // the same figures the statements were (or will be) built with.
    const [orderZone, oldRules, newRules] = await Promise.all([
      prisma.zone.findUnique({
        where: { id: originalOrder.zoneId },
        select: { name: true, basePriceUsd: true, basePriceLbp: true },
      }),
      loadMerchantRateRules(originalOrder.merchantId),
      loadMerchantRateRules(newMerchantId),
    ]);

    const oldShipping = resolveMerchantShippingRate(
      oldRules,
      orderZone?.name,
      orderZone,
      originalOrder.createdAt,
    ).usd;
    const netPaidUsd = originalOrder.amountUsd - oldShipping;

    const newShipping = resolveMerchantShippingRate(
      newRules,
      orderZone?.name,
      orderZone,
      originalOrder.createdAt,
    ).usd;
    const netOwedUsd = originalOrder.amountUsd - newShipping;

    // 3. Generate the Deduction (D) and Correction (C) Orders simultaneously
    const [deductionToken, correctionToken] = await Promise.all([
      generateTrackToken(),
      generateTrackToken(),
    ]);
    const [deductionOrder, correctionOrder] = await prisma.$transaction([
      prisma.order.create({
        data: {
          orderId: `D-${originalOrder.orderId}`,
          trackToken: deductionToken,
          customerName: originalOrder.customerName,
          customerPhone: originalOrder.customerPhone,
          customerAddress: originalOrder.customerAddress,
          zoneId: originalOrder.zoneId,
          amountUsd: -netPaidUsd, // Negative value to deduct from wrong seller's balance
          merchantId: originalOrder.merchantId,
          creatorId: adminUserId,
          location: "DELIVERED",
          financialStatus: "UD",
          isCorrection: true, // Flags this so shipping isn't charged again
          notes: `Automated Deduction for correcting order ${originalOrder.orderId}`,
        },
      }),
      prisma.order.create({
        data: {
          orderId: `C-${originalOrder.orderId}`,
          trackToken: correctionToken,
          customerName: originalOrder.customerName,
          customerPhone: originalOrder.customerPhone,
          customerAddress: originalOrder.customerAddress,

          zoneId: originalOrder.zoneId,
          amountUsd: netOwedUsd, // Positive value added to correct seller's balance
          merchantId: newMerchantId,
          creatorId: adminUserId,
          location: "DELIVERED",
          financialStatus: "UD",
          isCorrection: true,
          notes: `Automated Correction reassigning from order ${originalOrder.orderId}`,
        },
      }),
    ]);

    // 4. Mark the original order so there is a paper trail
    await prisma.order.update({
      where: { id: orderId },
      data: {
        notes: `${originalOrder.notes || ""} | Corrected and transferred to new merchant.`,
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    console.error("[POST /api/orders/correction] Error:", error);
    return NextResponse.json(
      { error: "Correction failed" },
      { status: 500 },
    );
  }
}
