import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// Shared Prisma client singleton (see lib/prisma.ts) — one client per process, reused across requests.

// GET /api/admin/treasury — List all TreasuryBoxes
export async function GET(request: Request) {
  try {
    // ── Server-side RBAC: require PAGE_ADMIN_TREASURY before exposing the
    //    sensitive cashbox/ledger view ──
    const auth = await requireServerPermission(request, "PAGE_ADMIN_TREASURY");
    if (auth instanceof Response) return auth;

    const boxes = await prisma.treasuryBox.findMany({
      include: {
        transactions: {
          include: {
            user: { select: { id: true, email: true, username: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(boxes, { status: 200 });
  } catch (error: unknown) {
    console.error("GET treasury error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// POST /api/admin/treasury — Create a new TreasuryBox
export async function POST(request: Request) {
  try {
    // ── Server-side RBAC: require ACTION_TREASURY_TRANSACT before any
    //    state-mutating cashbox operation ──
    const auth = await requireServerPermission(
      request,
      "ACTION_TREASURY_TRANSACT",
    );
    if (auth instanceof Response) return auth;

    const body = await request.json();
    const { name, isPositive } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const box = await prisma.treasuryBox.create({
      data: {
        name: name.trim(),
        isPositive:
          isPositive === true || isPositive === false ? isPositive : true,
      },
    });

    return NextResponse.json(box, { status: 201 });
  } catch (error: any) {
    console.error("POST treasury error:", error);
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "A treasury box with this name already exists" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
