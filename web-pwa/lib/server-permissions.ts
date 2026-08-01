import prisma from "@/lib/prisma";
import { verifySessionToken } from "@/helpers/auth";
import { hasPermission, type PermissionedUser } from "@/lib/permissions";

// ─── Server-side session token extraction ─────────────────────────────────────
// Extracts the `session` cookie from an incoming Next.js Request. Used instead
// of `next/headers().cookies()` so this guard works in any route handler that
// receives a raw `Request`.
function getSessionToken(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export type AuthenticatedUser = PermissionedUser & {
  id: string;
  role: string;
};

/**
 * Server-side RBAC guard for API route handlers.
 *
 * 1. Authenticates the session cookie via `verifySessionToken`.
 * 2. Loads the user's `PermissionGroup` + `customPermissions` from the database.
 * 3. Evaluates the permission using the shared `hasPermission` logic.
 *
 * Returns a `Response` with 401 (unauthenticated) or 403 (forbidden), or an
 * object `{ user }` when the caller holds the required permission.
 *
 * IMPORTANT: This MUST be awaited at the absolute start of the route handler —
 * before any `req.json()` payload parsing or database mutation.
 */
export async function requireServerPermission(
  req: Request,
  requiredPermission: string,
): Promise<Response | { user: AuthenticatedUser }> {
  const token = getSessionToken(req);
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await verifySessionToken(token);
  if (!payload?.userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      role: true,
      permissionGroup: { select: { permissions: true } },
      customPermissions: true,
    },
  });

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!hasPermission(user, requiredPermission)) {
    return new Response("Forbidden", { status: 403 });
  }

  return { user };
}
