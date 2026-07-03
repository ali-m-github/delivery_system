import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// DELETE /api/zones/overrides/[id] — remove a merchant zone rate override
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    await prisma.merchantZoneRate.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete Override Error:", error);
    return NextResponse.json(
      { error: "Failed to delete override" },
      { status: 500 },
    );
  }
}
