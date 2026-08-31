import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import {
  SESSION_COOKIE,
  getSessionToken,
  verifySessionToken,
} from "@/lib/jwt";
import {
  hasPermission,
  isValidPermission,
  type PermissionedUser,
} from "@/lib/permissions";

export type AuthenticatedUser = PermissionedUser & {
  id: string;
  username: string;
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
      username: true,
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

/**
 * Role gate evaluated against the user's CURRENT database role (not the stale
 * `role` claim baked into the 24-hour token). Use this whenever an endpoint's
 * authorization depends on a role, so an admin's role change takes effect
 * immediately without waiting for the token to expire.
 *
 * Returns a 401 `Response` when unauthenticated, a 403 `Response` when the
 * user's DB role does not match, or `{ user }` when it does.
 */
export async function requireServerRole(
  req: Request,
  requiredRole: string,
): Promise<Response | { user: AuthenticatedUser }> {
  const auth = await loadSessionUser(req);
  if (auth instanceof Response) return auth;
  if (auth.user.role !== requiredRole) {
    return forbiddenResponse();
  }
  return auth;
}

/**
 * Authenticates the session token on a raw Request and loads the user record
 * (with the current DB role + permissions) from the database.
 *
 * Returns the user on success, or `null` when the session is missing, invalid,
 * expired, or the user no longer exists. Intended for server components that
 * cannot return a `Response` (they redirect instead) — e.g. the `/zones` page.
 */
export async function getSessionUserFromToken(
  req: Request,
): Promise<AuthenticatedUser | null> {
  const auth = await loadSessionUser(req);
  return auth instanceof Response ? null : auth.user;
}

/**
 * Like `getSessionUserFromToken`, but reads the `session` cookie from
 * `next/headers` instead of a raw Request, for use in Server Components (and
 * Server Actions) where no `Request` object is in scope.
 *
 * Returns the database user (current role + permissions) on success, or
 * `null` when the session is missing, invalid, expired, or the user no longer
 * exists. The role is the CURRENT database value, so a role change is
 * reflected immediately.
 */
export async function getSessionUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: {
      id: true,
      username: true,
      role: true,
      permissionGroup: { select: { permissions: true } },
      customPermissions: true,
    },
  });

  return user ?? null;
}

// ─── Server-action guards ─────────────────────────────────────────────────────
// Server actions cannot receive a raw `Request`, so these read the `session`
// cookie via `next/headers` and surface failures by throwing `Error` — the
// same way the existing actions surface validation failures to the UI.

async function loadActionUser(): Promise<AuthenticatedUser> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) throw new Error("Unauthorized");

  const payload = await verifySessionToken(token);
  if (!payload?.id) throw new Error("Unauthorized");

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: {
      id: true,
      username: true,
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
