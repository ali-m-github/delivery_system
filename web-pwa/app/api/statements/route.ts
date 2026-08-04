import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computeOrderProfit, resolveDriverSellerException } from "@/lib/profit";
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const merchantId = searchParams.get("merchantId");
  const paymentStatus = searchParams.get("paymentStatus");

  try {
    const statements = await prisma.merchantPayout.findMany({
      where: {
        ...(merchantId ? { merchantId } : {}),
        // Optional: filter by payment state. "AVAILABLE" = UNPAID or REJECTED
        // (not approved and not pending approval → can be paid / deducted).
        ...(paymentStatus
          ? paymentStatus === "AVAILABLE"
            ? {
                paymentStatus: {
                  notIn: ["PAID", "PENDING_APPROVAL"],
                },
              }
            : { paymentStatus }
          : {}),
      },
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

    // 2. Generate a GLOBALLY-unique sequential index so statement numbers never
    //    collide across sellers (e.g., CashTest #1 vs Tloba #1). The next index
    //    is the max across ALL statements + 1.
    const lastPayout = await prisma.merchantPayout.findFirst({
      orderBy: { sequentialIndex: "desc" },
    });
    const nextIndex = lastPayout ? lastPayout.sequentialIndex + 1 : 1;

    // 3. Execute the Atomic Transaction
    // An atomic transaction ensures that if the orders fail to update, the statement is NOT created (preventing ghost ledgers).
    const transaction = await prisma.$transaction(async (tx) => {
      // A1. Fetch the merchant + selected orders to compute the company profit.
      // Profit = profitRate per delivered/PS order, EXCEPT orders where the
      // driver's seller rate exception equals (sellerRate + profitRate) — those
      // contribute 0 profit (the driver keeps the whole fee).
      const merchant = await tx.merchant.findUnique({
        where: { id: merchantId },
        select: { defaultSellerRate: true, defaultProfitRate: true },
      });
      const profitOrders = await tx.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, driverId: true },
      });

      let profitUsd = 0;
      for (const o of profitOrders) {
        const driverException = await resolveDriverSellerException(
          o.driverId,
          merchantId,
        );
        profitUsd += computeOrderProfit(
          {
            defaultSellerRate: merchant?.defaultSellerRate ?? 0,
            defaultProfitRate: merchant?.defaultProfitRate ?? 0,
          },
          driverException,
        );
      }

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
          profitUsd,
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
