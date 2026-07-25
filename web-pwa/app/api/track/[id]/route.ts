import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { orderId: id },
    select: {
      id: true,
      orderId: true,
      location: true,
      updatedAt: true,
      createdAt: true,
      customerName: true,
      zone: {
        select: {
          name: true,
        },
      },
      driver: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      history: {
        select: {
          action: true,
          location: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json(order);
}
