import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Next.js 15+ requires params to be a Promise
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    // Await the params before extracting the ID
    const resolvedParams = await context.params;

    const seller = await prisma.merchant.findUnique({
      where: { id: resolvedParams.id },
      include: {
        zoneRates: { include: { zone: true } },
        orders: { include: { driver: true }, orderBy: { createdAt: "desc" } },
      },
    });

    if (!seller)
      return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    return NextResponse.json(seller, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
