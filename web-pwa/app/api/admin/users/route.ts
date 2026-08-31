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

// GET /api/admin/users — Fetch all users (select fields)
export async function GET(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_USERS");
  if (auth instanceof Response) return auth;
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        permissionGroupId: true,
        permissionGroup: { select: { id: true, name: true, permissions: true } },
        customPermissions: true,
      },
      orderBy: { username: "asc" },
    });
    return NextResponse.json(users, { status: 200 });
  } catch (error) {
    console.error("GET /api/admin/users Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

// POST /api/admin/users — Create a new user (employee/admin)
export async function POST(request: Request) {
  const auth = await requireServerPermission(request, "MANAGE_USERS");
  if (auth instanceof Response) return auth;
  try {
    // Accept both `application/json` and `multipart/form-data` (for logo upload).
    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");

    let username = "";
    let email = "";
    let password = "";
    let role = "";
    let permissionGroupId: string | null = null;
    let customPermissions: string[] = [];
    let logoUrl: string | null = null;

    if (isMultipart) {
      const formData = await request.formData();
      username = formString(formData, "username") ?? "";
      email = formString(formData, "email") ?? "";
      password = formString(formData, "password") ?? "";
      role = formString(formData, "role") ?? "";
      permissionGroupId = formString(formData, "permissionGroupId");
      const custom = formString(formData, "customPermissions");
      customPermissions = custom ? JSON.parse(custom) : [];
      const logo = formData.get("logo");
      if (isImageFile(logo)) logoUrl = await saveMerchantLogo(logo);
    } else {
      const body = await request.json();
      username = body.username || "";
      email = body.email || "";
      password = body.password || "";
      role = body.role || "";
      permissionGroupId = body.permissionGroupId || null;
      customPermissions = Array.isArray(body.customPermissions)
        ? body.customPermissions
        : [];
      logoUrl = body.logoUrl ?? null;
    }

    // Validate required fields
    if (!username || !email || !password || !role) {
      return NextResponse.json(
        { error: "Missing required fields: username, email, password, role" },
        { status: 400 },
      );
    }

    // Validate role against the known role set (role is a plain String in the
    // schema, so arbitrary values are rejected server-side).
    if (!VALID_USER_ROLES.includes(role)) {
      return NextResponse.json(
        {
          error: `Invalid role. Must be one of: ${VALID_USER_ROLES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Privilege-escalation policy: only a true ADMIN may create users with a
    // privileged role (ADMIN / MERCHANT) or grant privileged permissions.
    // A non-admin holding MANAGE_USERS may only create staff (USER / EMPLOYEE)
    // and cannot grant MANAGE_USERS via custom permissions.
    if (auth.user.role !== "ADMIN") {
      if (role === "ADMIN" || role === "MERCHANT") {
        return NextResponse.json(
          {
            error:
              "You can only create users with the USER or EMPLOYEE role. Only an ADMIN can create privileged roles.",
          },
          { status: 403 },
        );
      }
      const privilegedCustom = customPermissions.filter((p) =>
        PRIVILEGED_PERMISSIONS.includes(p),
      );
      if (privilegedCustom.length > 0) {
        return NextResponse.json(
          {
            error: `Only an ADMIN can grant: ${privilegedCustom.join(", ")}`,
          },
          { status: 403 },
        );
      }
    }

    // Validate custom permission strings against the canonical catalog.
    const invalidCustom = unknownPermissions(customPermissions);
    if (invalidCustom.length > 0) {
      return NextResponse.json(
        { error: `Invalid permissions: ${invalidCustom.join(", ")}` },
        { status: 400 },
      );
    }

    // Validate the selected permission group exists; a non-admin actor may not
    // assign a group that contains privileged permissions.
    let groupPermissions: string[] = [];
    if (permissionGroupId) {
      const group = await prisma.permissionGroup.findUnique({
        where: { id: permissionGroupId },
        select: { permissions: true },
      });
      if (!group) {
        return NextResponse.json(
          { error: "Selected permission group does not exist" },
          { status: 400 },
        );
      }
      groupPermissions = group.permissions;
      if (auth.user.role !== "ADMIN") {
        const privilegedGroup = groupPermissions.filter((p) =>
          PRIVILEGED_PERMISSIONS.includes(p),
        );
        if (privilegedGroup.length > 0) {
          return NextResponse.json(
            {
              error: `Only an ADMIN can assign a permission group containing: ${privilegedGroup.join(", ")}`,
            },
            { status: 403 },
          );
        }
      }
    }

    // Check for existing user by email
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 },
      );
    }

    // Check for existing user by username
    const existingUsername = await prisma.user.findUnique({
      where: { username },
    });
    if (existingUsername) {
      return NextResponse.json(
        { error: "Username already taken" },
        { status: 409 },
      );
    }

    // Hash the password
    const hashedPassword = await hashPassword(password);

    // Create the user. The effective permission set is the union of the
    // assigned group's permissions and the per-user custom permissions
    // (evaluated by hasPermission) — no legacy `permissions` field.
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        role,
        permissionGroupId: permissionGroupId || null,
        customPermissions,
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        permissionGroupId: true,
        permissionGroup: { select: { id: true, name: true, permissions: true } },
        customPermissions: true,
      },
    });

    // Persist the logo on the merchant record linked to this user
    if (role === "MERCHANT" && logoUrl) {
      await prisma.merchant.upsert({
        where: { userId: user.id },
        create: { userId: user.id, merchantName: username, logoUrl },
        update: { logoUrl },
      });
    }

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/users Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
