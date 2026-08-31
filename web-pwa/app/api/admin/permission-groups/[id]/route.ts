import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServerPermission } from "@/lib/server-permissions";
import { unknownPermissions } from "@/lib/permissions";

// PUT /api/admin/permission-groups/[id] — Update a permission group.
// Groups are the privilege-assignment mechanism, so editing them is
// restricted to the ADMIN role (not merely MANAGE_USERS).
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "MANAGE_USERS");
  if (auth instanceof Response) return auth;

  if (auth.user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Only an ADMIN can edit permission groups." },
      { status: 403 },
    );
  }

  try {
    const resolvedParams = await params;
    const id = resolvedParams.id;

    const body = await request.json();
    const { name, permissions } = body;

    if (name !== undefined && (!name || !name.trim())) {
      return NextResponse.json(
        { error: "Group name cannot be empty" },
        { status: 400 },
      );
    }

    // Validate every permission string against the SYSTEM_PERMISSIONS catalog.
    let permList: string[] | undefined;
    if (permissions !== undefined) {
      if (!Array.isArray(permissions)) {
        return NextResponse.json(
          { error: "permissions must be an array" },
          { status: 400 },
        );
      }
      const badPermissions = unknownPermissions(permissions);
      if (badPermissions.length > 0) {
        return NextResponse.json(
          { error: `Invalid permissions: ${badPermissions.join(", ")}` },
          { status: 400 },
        );
      }
      permList = permissions;
    }

    const group = await prisma.permissionGroup.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(permList !== undefined ? { permissions: permList } : {}),
      },
    });

    return NextResponse.json(group, { status: 200 });
  } catch (error) {
    console.error("PUT /api/admin/permission-groups Error:", error);
    // P2025 = record not found; P2002 = unique constraint violation (name)
    const code = (error as { code?: string }).code;
    if (code === "P2025") {
      return NextResponse.json(
        { error: "Permission group not found" },
        { status: 404 },
      );
    }
    if (code === "P2002") {
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

// DELETE /api/admin/permission-groups/[id] — Delete a permission group.
// The User → PermissionGroup relation has no onDelete rule (FK restrict),
// so assigned users are unassigned first, in the same transaction.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "MANAGE_USERS");
  if (auth instanceof Response) return auth;

  if (auth.user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Only an ADMIN can delete permission groups." },
      { status: 403 },
    );
  }

  try {
    const resolvedParams = await params;
    const id = resolvedParams.id;

    const result = await prisma.$transaction(async (tx) => {
      const group = await tx.permissionGroup.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!group) {
        return { notFound: true as const, unassigned: 0 };
      }
      // Unassign all users from this group, then delete the group.
      const { count } = await tx.user.updateMany({
        where: { permissionGroupId: id },
        data: { permissionGroupId: null },
      });
      await tx.permissionGroup.delete({ where: { id } });
      return { notFound: false as const, unassigned: count };
    });

    if (result.notFound) {
      return NextResponse.json(
        { error: "Permission group not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        message: "Permission group deleted successfully",
        unassignedUsers: result.unassigned,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("DELETE /api/admin/permission-groups Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
