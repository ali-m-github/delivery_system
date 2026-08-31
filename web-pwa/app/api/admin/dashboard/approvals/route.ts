import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// GET — fetch pending merchant approvals data for admin dashboard
export async function GET(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_MERCHANTS");
  if (auth instanceof Response) return auth;
  try {
    // Users with role MERCHANT who are not linked to any merchant
    const pendingUsers = await prisma.user.findMany({
      where: {
        role: "MERCHANT",
        merchant: null,
      },
      select: {
        id: true,
        username: true,
        email: true,
      },
      orderBy: { username: "asc" },
    });

    // Merchants that do NOT have a linked user (orphaned merchant ledgers)
    const availableSellers = await prisma.merchant.findMany({
      where: { userId: null },
      select: {
        id: true,
        merchantId: true,
        merchantName: true,
      },
      orderBy: { merchantName: "asc" },
    });

    return NextResponse.json(
      { pendingUsers, availableSellers },
      { status: 200 },
    );
  } catch (error) {
    console.error("Dashboard Approvals GET Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
