import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/helpers/auth";
import { isImageFile, saveMerchantLogo } from "@/lib/logoUpload";
import { requireServerPermission } from "@/lib/server-permissions";
import {
  PRIVILEGED_PERMISSIONS,
  VALID_USER_ROLES,
  unknownPermissions,
} from "@/lib/permissions";

const prisma = new PrismaClient();

// Helper: read a string field from a FormData payload (empty → null)
function formString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

// PUT /api/admin/employees/[id] — Update an employee (user)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "MANAGE_USERS");
  if (auth instanceof Response) return auth;
  try {
    const resolvedParams = await params;
    const id = resolvedParams.id;

    // Accept both `application/json` and `multipart/form-data` (for logo upload).
    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");

    let username = "";
    let password = "";
    let role = "";
    let permissionGroupId: string | null | undefined;
    let customPermissions: string[] | undefined;
    let logoUrl: string | null = null;

    if (isMultipart) {
      const formData = await request.formData();
      username = formString(formData, "username") ?? "";
      password = formString(formData, "password") ?? "";
      role = formString(formData, "role") ?? "";
      const groupValue = formData.get("permissionGroupId");
      permissionGroupId =
        typeof groupValue === "string" ? groupValue || null : undefined;
      const custom = formString(formData, "customPermissions");
      customPermissions = custom ? JSON.parse(custom) : undefined;
      const logo = formData.get("logo");
      if (isImageFile(logo)) logoUrl = await saveMerchantLogo(logo);
    } else {
      const body = await request.json();
      username = body.username || "";
      password = body.password || "";
      role = body.role || "";
      permissionGroupId = body.permissionGroupId;
      customPermissions = body.customPermissions;
      logoUrl = body.logoUrl ?? null;
    }

    // Load the target user up front: needed for privilege-escalation checks
    // (self-edit, admin targets, role changes) and to return a clean 404.
    const target = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        permissionGroupId: true,
        customPermissions: true,
      },
    });
    if (!target) {
      return NextResponse.json(
        { error: "Employee not found" },
        { status: 404 },
      );
    }

    // Validate role against the known role set (role is a plain String in the
    // schema, so arbitrary values are rejected server-side).
    if (role && !VALID_USER_ROLES.includes(role)) {
      return NextResponse.json(
        {
          error: `Invalid role. Must be one of: ${VALID_USER_ROLES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Validate every permission string against the SYSTEM_PERMISSIONS catalog.
    const badPermissions = unknownPermissions(
      customPermissions ?? target.customPermissions,
    );
    if (badPermissions.length > 0) {
      return NextResponse.json(
        { error: `Invalid permissions: ${badPermissions.join(", ")}` },
        { status: 400 },
      );
    }

    // Resolve the permission group this update would leave the user in.
    let effectiveGroupId: string | null = target.permissionGroupId;
    if (permissionGroupId !== undefined) {
      effectiveGroupId = permissionGroupId || null;
    }
    const effectiveGroup = effectiveGroupId
      ? await prisma.permissionGroup.findUnique({
          where: { id: effectiveGroupId },
          select: { id: true, name: true, permissions: true },
        })
      : null;
    if (effectiveGroupId && !effectiveGroup) {
      return NextResponse.json(
        { error: "Selected permission group does not exist" },
        { status: 400 },
      );
    }

    // The effective permission set after this update (group ∪ custom).
    const effectiveCustom =
      customPermissions !== undefined
        ? customPermissions
        : target.customPermissions;
    const effectivePermissions = [
      ...(effectiveGroup?.permissions ?? []),
      ...effectiveCustom,
    ];

    // Privilege-escalation policy: a non-ADMIN actor (someone holding
    // MANAGE_USERS via group/custom permissions) may not edit themselves,
    // may not edit users with the ADMIN role, may not change any user's role,
    // and may not grant privileged permissions (directly or via group).
    if (auth.user.role !== "ADMIN") {
      if (target.id === auth.user.id) {
        return NextResponse.json(
          { error: "You cannot edit your own account." },
          { status: 403 },
        );
      }
      if (target.role === "ADMIN") {
        return NextResponse.json(
          { error: "Only an ADMIN can edit a user with the ADMIN role." },
          { status: 403 },
        );
      }
      if (role && role !== target.role) {
        return NextResponse.json(
          { error: "Only an ADMIN can change a user's role." },
          { status: 403 },
        );
      }
      if (effectivePermissions.some((p) => PRIVILEGED_PERMISSIONS.includes(p))) {
        return NextResponse.json(
          {
            error: `Only an ADMIN can grant: ${PRIVILEGED_PERMISSIONS.join(", ")}`,
          },
          { status: 403 },
        );
      }
    }

    // Build conditional update payload
    const updateData: Record<string, unknown> = {};

    if (username) updateData.username = username;
    if (role) updateData.role = role;
    if (permissionGroupId !== undefined) {
      updateData.permissionGroupId = permissionGroupId || null;
    }
    if (customPermissions !== undefined) {
      updateData.customPermissions = customPermissions;
    }
    if (password && password.trim() !== "") {
      updateData.password = await hashPassword(password);
    }

    // Ensure at least one field is being updated
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields provided for update" },
        { status: 400 },
      );
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        permissionGroupId: true,
        permissionGroup: {
          select: { id: true, name: true, permissions: true },
        },
        customPermissions: true,
      },
    });

    // Persist the logo on the merchant record linked to this user
    if (role === "MERCHANT" && logoUrl) {
      await prisma.merchant.upsert({
        where: { userId: user.id },
        create: { userId: user.id, merchantName: user.username, logoUrl },
        update: { logoUrl },
      });
    }

    return NextResponse.json(user, { status: 200 });
  } catch (error) {
    console.error("PUT /api/admin/employees Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// DELETE /api/admin/employees/[id] — Delete an employee (user)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireServerPermission(request, "MANAGE_USERS");
  if (auth instanceof Response) return auth;
  try {
    const resolvedParams = await params;
    const id = resolvedParams.id;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!target) {
      return NextResponse.json(
        { error: "Employee not found" },
        { status: 404 },
      );
    }

    // Nobody may delete their own account (would also break the session).
    if (target.id === auth.user.id) {
      return NextResponse.json(
        { error: "You cannot delete your own account." },
        { status: 403 },
      );
    }

    if (target.role === "ADMIN" && auth.user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only an ADMIN can delete a user with the ADMIN role." },
        { status: 403 },
      );
    }

    // Never leave the system without an ADMIN.
    if (target.role === "ADMIN") {
      const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot delete the last ADMIN user." },
          { status: 400 },
        );
      }
    }

    try {
      await prisma.user.delete({ where: { id } });
    } catch (deleteError: unknown) {
      // RESTRICT foreign keys (Order.creatorId, OrderHistory.userId,
      // DriverProfile.userId) make hard-deleting users with history
      // impossible; surface a clean 409 instead of a 500.
      if (
        typeof deleteError === "object" &&
        deleteError !== null &&
        "code" in deleteError &&
        (deleteError as { code?: string }).code === "P2003"
      ) {
        return NextResponse.json(
          {
            error:
              "Cannot delete this user: they still have related records (orders, driver profile, or activity history).",
          },
          { status: 409 },
        );
      }
      throw deleteError;
    }

    return NextResponse.json(
      { message: "Employee deleted successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("DELETE /api/admin/employees Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
