import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";
import { unknownPermissions } from "@/lib/permissions";

// GET /api/admin/permission-groups — Fetch all permission groups
export async function GET(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_USERS");
  if (auth instanceof Response) return auth;
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

// POST /api/admin/permission-groups — Create a permission group.
// Groups are the privilege-assignment mechanism, so creating them is
// restricted to the ADMIN role (not merely MANAGE_USERS).
export async function POST(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_USERS");
  if (auth instanceof Response) return auth;

  if (auth.user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Only an ADMIN can create permission groups." },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const { name, permissions } = body;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "Group name is required" },
        { status: 400 },
      );
    }

    // Validate every permission string against the SYSTEM_PERMISSIONS catalog.
    const permList = Array.isArray(permissions) ? permissions : [];
    const badPermissions = unknownPermissions(permList);
    if (badPermissions.length > 0) {
      return NextResponse.json(
        { error: `Invalid permissions: ${badPermissions.join(", ")}` },
        { status: 400 },
      );
    }

    const group = await prisma.permissionGroup.create({
      data: {
        name: name.trim(),
        permissions: permList,
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
