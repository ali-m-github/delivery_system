import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { requireServerPermission } from "@/lib/server-permissions";

const prisma = new PrismaClient();

// GET /api/admin/treasury/transactions — List treasury transactions with an
// optional status filter (e.g. ?status=PENDING_APPROVAL). Used by the Treasury
// page to surface pending approvals across every cash box.
export async function GET(request: Request) {
  try {
    // ── Server-side RBAC: require PAGE_ADMIN_TREASURY ──
    const auth = await requireServerPermission(request, "PAGE_ADMIN_TREASURY");
    if (auth instanceof Response) return auth;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const boxId = searchParams.get("boxId");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (boxId) where.boxId = boxId;

    const transactions = await prisma.treasuryTransaction.findMany({
      where,
      include: {
        box: { select: { id: true, name: true, isPositive: true } },
        user: { select: { id: true, email: true, username: true } },
        statement: {
          select: {
            id: true,
            sequentialIndex: true,
            netUsd: true,
            netLbp: true,
            merchant: { select: { merchantName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(transactions, { status: 200 });
  } catch (error: any) {
    console.error("GET treasury transactions error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
