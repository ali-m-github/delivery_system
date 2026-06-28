import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// GET /api/sellers/list — Fetch all active merchants (sellers) as a simplified list
export async function GET() {
  try {
    const sellers = await prisma.merchant.findMany({
      where: { isActive: true },
      select: {
        id: true,
        merchantId: true,
        merchantName: true,
      },
      orderBy: { merchantName: "asc" },
    });

    const result = sellers.map((s) => ({
      id: s.id,
      numericId: s.merchantId,
      name: s.merchantName,
    }));

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("GET /api/sellers/list Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
