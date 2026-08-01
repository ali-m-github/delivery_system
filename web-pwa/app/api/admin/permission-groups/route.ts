import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/admin/permission-groups — Fetch all permission groups
export async function GET() {
  try {
    const groups = await prisma.permissionGroup.findMany({
      include: {
        _count: { select: { users: true } },
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(groups, { status: 200 });
  } catch (error) {
    console.error("GET /api/admin/permission-groups Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// POST /api/admin/permission-groups — Create a permission group
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, permissions } = body;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "Group name is required" },
        { status: 400 },
      );
    }

    const group = await prisma.permissionGroup.create({
      data: {
        name: name.trim(),
        permissions: Array.isArray(permissions) ? permissions : [],
      },
    });

    return NextResponse.json(group, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/permission-groups Error:", error);
    // Prisma P2002 = unique constraint violation (duplicate name)
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "A permission group with that name already exists" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
