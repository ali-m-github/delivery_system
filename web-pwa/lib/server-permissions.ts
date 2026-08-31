import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { verifySessionToken } from "@/helpers/auth";
import {
  hasPermission,
  isValidPermission,
  type PermissionedUser,
} from "@/lib/permissions";

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

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function forbiddenResponse(): Response {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Authenticates the session cookie and loads the user from the database.
 * Shared by `requireServerPermission`, `requireAuthenticatedSession`, and the
 * server-action helpers.
 */
async function loadSessionUser(
  req: Request,
): Promise<Response | { user: AuthenticatedUser }> {
  const token = getSessionToken(req);
  if (!token) return unauthorizedResponse();

  const payload = await verifySessionToken(token);
  if (!payload?.id) return unauthorizedResponse();

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: {
      id: true,
      role: true,
      permissionGroup: { select: { permissions: true } },
      customPermissions: true,
    },
  });

  if (!user) return unauthorizedResponse();

  return { user };
}

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
  // Defensive: a typo'd/unknown permission must never authorize anyone (the
  // ADMIN bypass in hasPermission would otherwise silently grant access).
  if (!isValidPermission(requiredPermission)) {
    console.error(
      `requireServerPermission: unknown permission "${requiredPermission}" — rejecting request.`,
    );
    return forbiddenResponse();
  }

  const auth = await loadSessionUser(req);
  if (auth instanceof Response) return auth;

  if (!hasPermission(auth.user, requiredPermission)) {
    return forbiddenResponse();
  }

  return auth;
}

/**
 * Authentication-only guard for API route handlers that must not be public but
 * have no single clean permission mapping (e.g. endpoints used by multiple
 * roles such as drivers and merchants).
 *
 * Returns a 401 `Response` when the caller is not authenticated, or an object
 * `{ user }` with the database user record (including `role`) when the session
 * is valid. Routes that need to restrict what a role can touch should scope the
 * query using `user.role` / `user.id` after this guard.
 */
export async function requireAuthenticatedSession(
  req: Request,
): Promise<Response | { user: AuthenticatedUser }> {
  return loadSessionUser(req);
}

// ─── Server-action guards ─────────────────────────────────────────────────────
// Server actions cannot receive a raw `Request`, so these read the `session`
// cookie via `next/headers` and surface failures by throwing `Error` — the
// same way the existing actions surface validation failures to the UI.

async function loadActionUser(): Promise<AuthenticatedUser> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) throw new Error("Unauthorized");

  const payload = await verifySessionToken(token);
  if (!payload?.id) throw new Error("Unauthorized");

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: {
      id: true,
      role: true,
      permissionGroup: { select: { permissions: true } },
      customPermissions: true,
    },
  });

  if (!user) throw new Error("Unauthorized");

  return user;
}

/**
 * Server-action authentication guard. Throws `Error("Unauthorized")` when the
 * caller has no valid session. MUST be awaited at the top of the action.
 */
export async function requireActionSession(): Promise<AuthenticatedUser> {
  return loadActionUser();
}

/**
 * Server-action RBAC guard. Throws `Error("Unauthorized")` /
 * `Error("Forbidden")`; ADMIN bypasses the permission map via `hasPermission`.
 */
export async function requireActionPermission(
  requiredPermission: string,
): Promise<AuthenticatedUser> {
  // Defensive: unknown permission → deny (see requireServerPermission).
  if (!isValidPermission(requiredPermission)) {
    console.error(
      `requireActionPermission: unknown permission "${requiredPermission}" — denying.`,
    );
    throw new Error("Forbidden");
  }

  const user = await loadActionUser();
  if (!hasPermission(user, requiredPermission)) {
    throw new Error("Forbidden");
  }
  return user;
}
