import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";

// PATCH /api/zones/[id] — update zone base prices
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "MANAGE_ZONES");
  if (auth instanceof Response) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    const { basePriceUsd, basePriceLbp, name } = body;

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (basePriceUsd !== undefined) data.basePriceUsd = Number(basePriceUsd);
    if (basePriceLbp !== undefined) data.basePriceLbp = Number(basePriceLbp);

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }

    const updated = await prisma.zone.update({
      where: { id },
      data,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update Zone Error:", error);
    return NextResponse.json(
      { error: "Failed to update zone" },
      { status: 500 },
    );
  }
}
