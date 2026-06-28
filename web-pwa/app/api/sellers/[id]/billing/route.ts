import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await context.params;

    // Fetch orders that the warehouse holds cash for but hasn't paid out yet
    const pendingOrders = await prisma.order.findMany({
      where: {
        merchantId: resolvedParams.id,
        financialStatus: "Settled",
      },
    });

    let totalCollectedUsd = 0;
    let totalCollectedLbp = 0;
    let totalFeesUsd = 0;

    pendingOrders.forEach((order) => {
      totalCollectedUsd += order.collectedUsd || 0;
      totalCollectedLbp += order.collectedLbp || 0;
      // Subtracting base delivery fees (amountUsd)
      totalFeesUsd += order.amountUsd || 0;
    });

    return NextResponse.json(
      {
        orderCount: pendingOrders.length,
        orderIds: pendingOrders.map((o) => o.id),
        totalCollectedUsd,
        totalCollectedLbp,
        totalFeesUsd,
        netPayoutUsd: totalCollectedUsd - totalFeesUsd,
      },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const resolvedParams = await context.params;

    // Clear the ledger
    const result = await prisma.order.updateMany({
      where: {
        merchantId: resolvedParams.id,
        financialStatus: "Settled",
      },
      data: {
        financialStatus: "Paid",
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: `Successfully paid out ${result.count} orders.`,
      },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
