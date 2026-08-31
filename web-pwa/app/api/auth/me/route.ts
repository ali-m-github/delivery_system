import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/helpers/auth";
import { isValidPermission, SYSTEM_PERMISSIONS } from "@/lib/permissions";

// GET /api/auth/me — Current session user plus their *effective* permission
// set (ADMIN bypass ∪ group permissions ∪ custom permissions), computed
// fresh from the database on every call so permission changes made in the
// admin UI are reflected immediately without waiting for the JWT to expire.
export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("session")?.value;

    if (!token) {
      return NextResponse.json({ error: "No token found" }, { status: 401 });
    }

    const payload = await verifySessionToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: {
        id: true,
        username: true,
        role: true,
        permissions: true,
        permissionGroup: {
          select: { id: true, name: true, permissions: true },
        },
        customPermissions: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    // Effective set: ADMIN gets the full catalog (bypass); everyone else gets
    // (group ∪ custom), filtered to known permission strings so stale or
    // typo'd entries can never surface as real capabilities.
    const effectivePermissions =
      user.role === "ADMIN"
        ? [...SYSTEM_PERMISSIONS]
        : [
            ...(user.permissionGroup?.permissions ?? []),
            ...user.customPermissions,
          ].filter(
            (p, i, arr) => isValidPermission(p) && arr.indexOf(p) === i,
          );

    return NextResponse.json(
      { ...user, effectivePermissions },
      { status: 200 },
    );
  } catch (error) {
    console.error("GET /api/auth/me Error:", error);
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }
}
