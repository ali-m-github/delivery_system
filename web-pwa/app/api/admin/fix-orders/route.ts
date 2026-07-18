import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  const csvTrackingIds = [
    "9935233",
    "9935237",
    "9935292",
    "5219-2326",
    "5219-2332",
    "9935241",
    "5219-2430",
    "9935118",
    "9935124",
    "5219-2388",
    "5219-2384",
    "5219-2366",
    "10049814",
    "5219-2455",
    "10007618",
    "10007617",
    "9948642",
    "5219-2449",
    "9948803",
    "5219-2300",
    "5219-2350",
    "5219-2358",
    "9999998",
    "5219-2354",
    "5219-2347",
    "5219-2370",
    "5219-2372",
    "5219-2410",
    "5219-2289",
    "9948639",
    "9935249",
    "5219-2458",
  ];

  try {
    const result = await prisma.order.updateMany({
      where: {
        orderId: { in: csvTrackingIds },
      },
      data: {
        driverPayoutId: null,
        financialStatus: "WD",
      },
    });

    return NextResponse.json({
      message: "Success! Check the Delivered tab.",
      recordsUpdated: result.count,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update records" },
      { status: 500 },
    );
  }
}
