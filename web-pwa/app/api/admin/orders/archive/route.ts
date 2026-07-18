import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { orderIds, deleteAll } = body;

    // Safety Check 1: Must explicitly request either specific IDs or a full wipe
    if (!deleteAll && (!Array.isArray(orderIds) || orderIds.length === 0)) {
      return NextResponse.json(
        { error: "No order IDs provided for deletion." },
        { status: 400 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deleteCondition: any = {
      location: {
        equals: "archive",
        mode: "insensitive",
      },
    };

    // If not deleting all, restrict to the specific selected IDs
    if (!deleteAll) {
      deleteCondition.id = { in: orderIds.map((id: unknown) => String(id)) };
    }

    // Execute permanent database removal
    const deleted = await prisma.order.deleteMany({
      where: deleteCondition,
    });

    return NextResponse.json(
      { success: true, count: deleted.count },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Permanent Archive Deletion Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete archived orders." },
      { status: 500 },
    );
  }
}
