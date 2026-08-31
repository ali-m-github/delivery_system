import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

// GET /api/admin/merchants/list — Fetch all active merchants as a simplified list
export async function GET(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_MERCHANTS");
  if (auth instanceof Response) return auth;
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
    console.error("GET /api/admin/merchants/list Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
