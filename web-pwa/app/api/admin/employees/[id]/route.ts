import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/helpers/auth";
import { isImageFile, saveMerchantLogo } from "@/lib/logoUpload";

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
  try {
    const resolvedParams = await params;
    const id = resolvedParams.id;

    // Accept both `application/json` and `multipart/form-data` (for logo upload).
    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");

    let username = "";
    let password = "";
    let role = "";
    let permissions: string[] | undefined;
    let permissionGroupId: string | null | undefined;
    let customPermissions: string[] | undefined;
    let logoUrl: string | null = null;

    if (isMultipart) {
      const formData = await request.formData();
      username = formString(formData, "username") ?? "";
      password = formString(formData, "password") ?? "";
      role = formString(formData, "role") ?? "";
      const perms = formString(formData, "permissions");
      permissions = perms ? JSON.parse(perms) : undefined;
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
      permissions = body.permissions;
      permissionGroupId = body.permissionGroupId;
      customPermissions = body.customPermissions;
      logoUrl = body.logoUrl ?? null;
    }

    // Build conditional update payload
    const updateData: Record<string, unknown> = {};

    if (username) updateData.username = username;
    if (role) updateData.role = role;
    if (permissions !== undefined) updateData.permissions = permissions;
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
        permissions: true,
        permissionGroupId: true,
        permissionGroup: { select: { id: true, name: true } },
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
  try {
    const resolvedParams = await params;
    const id = resolvedParams.id;

    await prisma.user.delete({ where: { id } });

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
