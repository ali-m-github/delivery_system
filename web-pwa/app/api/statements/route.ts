import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const merchantId = searchParams.get("merchantId");

  try {
    const statements = await prisma.merchantPayout.findMany({
      where: merchantId ? { merchantId } : undefined,
      include: {
        merchant: {
          include: { zoneRates: true },
        },
        orders: {
          include: { driver: true, zone: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(statements, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to fetch statements." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      merchantId,
      orderIds,
      totalUsd,
      totalLbp,
      shippingUsd,
      shippingLbp,
      netUsd,
      netLbp,
    } = body;

    // 1. Validate Input
    if (!merchantId || !orderIds || orderIds.length === 0) {
      return NextResponse.json(
        { error: "Missing required payload data." },
        { status: 400 },
      );
    }

    // 2. Fetch the current highest sequential index for this specific merchant to generate statement numbers (e.g., Statement #1, Statement #2)
    const lastPayout = await prisma.merchantPayout.findFirst({
      where: { merchantId },
      orderBy: { sequentialIndex: "desc" },
    });
    const nextIndex = lastPayout ? lastPayout.sequentialIndex + 1 : 1;

    // 3. Execute the Atomic Transaction
    // An atomic transaction ensures that if the orders fail to update, the statement is NOT created (preventing ghost ledgers).
    const transaction = await prisma.$transaction(async (tx) => {
      // A. Create the Payout Ledger Entry
      const payout = await tx.merchantPayout.create({
        data: {
          merchantId,
          sequentialIndex: nextIndex,
          totalUsd,
          totalLbp,
          shippingUsd,
          shippingLbp,
          netUsd,
          netLbp,
          status: "PAID",
        },
      });

      // B. Update the Selected Orders
      // Locks them to the new payout ID and changes financial status to PS (Paid to Seller)
      await tx.order.updateMany({
        where: { id: { in: orderIds } },
        data: {
          financialStatus: "PS",
          merchantPayoutId: payout.id,
        },
      });

      return payout;
    });

    return NextResponse.json(transaction, { status: 201 });
  } catch (error: any) {
    console.error("Payout Transaction Error:", error);
    return NextResponse.json(
      { error: "Failed to process settlement." },
      { status: 500 },
    );
  }
}
