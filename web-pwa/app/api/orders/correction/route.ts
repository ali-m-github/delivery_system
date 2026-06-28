import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const { orderId, newMerchantId, adminUserId } = await request.json();

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

    // 1. Fetch OLD merchant's zone rate to calculate the exact net amount they were incorrectly paid
    const oldZoneRate = await prisma.merchantZoneRate.findUnique({
      where: {
        merchantId_zoneId: {
          merchantId: originalOrder.merchantId,
          zoneId: originalOrder.zoneId,
        },
      },
    });
    const oldShipping = oldZoneRate?.rate || 0;
    const netPaidUsd = originalOrder.amountUsd - oldShipping;

    // 2. Fetch NEW merchant's zone rate to calculate the exact net amount they should receive
    const newZoneRate = await prisma.merchantZoneRate.findUnique({
      where: {
        merchantId_zoneId: {
          merchantId: newMerchantId,
          zoneId: originalOrder.zoneId,
        },
      },
    });
    const newShipping = newZoneRate?.rate || 0;
    const netOwedUsd = originalOrder.amountUsd - newShipping;

    // 3. Generate the Deduction (D) and Correction (C) Orders simultaneously
    const [deductionOrder, correctionOrder] = await prisma.$transaction([
      prisma.order.create({
        data: {
          orderId: `D-${originalOrder.orderId}`,
          customerName: originalOrder.customerName,
          customerPhone: originalOrder.customerPhone,
          customerAddress: originalOrder.customerAddress,
          city: originalOrder.city,
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
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Correction failed" },
      { status: 500 },
    );
  }
}
