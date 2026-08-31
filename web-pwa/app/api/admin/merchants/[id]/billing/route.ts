import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "MANAGE_FINANCE");
  if (auth instanceof Response) return auth;
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
      totalCollectedUsd += order.collectedUsd ?? 0;
      totalCollectedLbp += order.collectedLbp ?? 0;
      // Subtracting base delivery fees (amountUsd)
      totalFeesUsd += order.amountUsd ?? 0;
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
  } catch (error: unknown) {
    console.error("GET /api/admin/merchants/[id]/billing Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "MANAGE_FINANCE");
  if (auth instanceof Response) return auth;
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
  } catch (error: unknown) {
    console.error("POST /api/admin/merchants/[id]/billing Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
