import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// DELETE /api/zones/overrides/[id] — remove a merchant zone rate override
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "MANAGE_ZONES");
  if (auth instanceof Response) return auth;
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
