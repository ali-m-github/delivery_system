import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// GET /api/admin/treasury — List all TreasuryBoxes
export async function GET() {
  try {
    const boxes = await prisma.treasuryBox.findMany({
      include: {
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(boxes, { status: 200 });
  } catch (error: any) {
    console.error("GET treasury error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/admin/treasury — Create a new TreasuryBox
export async function POST(request: Request) {
  try {
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
