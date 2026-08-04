// ─── Shared System Permission Catalog ─────────────────────────────────────────
// Single source of truth used by the Permission Groups tab, the Employee form's
// custom permission picker, and any server-side authorization checks.
export const SYSTEM_PERMISSIONS = [
  "MANAGE_ORDERS",
  "MANAGE_DRIVERS",
  "MANAGE_FINANCE",
  "MANAGE_USERS",
  "MANAGE_ZONES",
  "MANAGE_MERCHANTS",
  "ORDERS_VIEW",
  "ORDERS_CREATE",
  "ORDERS_EDIT",
  "ORDERS_DISPATCH",
  "ORDERS_FINANCIAL",
  "DRIVERS_VIEW",
  "DRIVERS_CREATE",
  "DRIVERS_PAYOUT",
  "ZONES_MANAGE",
  "MERCHANTS_MANAGE",
  "USERS_MANAGE",
  // ── Granular Treasury / Cashbox RBAC ──
  "PAGE_ADMIN_TREASURY",
  "ACTION_TREASURY_TRANSACT",
] as const;

export type SystemPermission = (typeof SYSTEM_PERMISSIONS)[number];

// ─── Composite Permission Evaluation ──────────────────────────────────────────
// A user with a `permissionGroup` inherits that group's permissions and may also
// hold per-user `customPermissions` that are layered on top.
export interface PermissionedUser {
  role?: string;
  permissionGroup?: { permissions: string[] } | null;
  customPermissions?: string[];
}

/**
 * Checks whether a user holds `requiredPermission` via the composite RBAC model.
 * Returns true if the user is an ADMIN (who bypasses the permission map) or if
 * the permission exists in either the user's assigned PermissionGroup OR their
 * custom overrides.
 */
export function hasPermission(
  user: PermissionedUser | null | undefined,
  requiredPermission: string,
): boolean {
  if (!user) return false;
  // ADMINS bypass the permission map — consistent with RouteGuard and the
  // middleware, which restrict /admin/* to the ADMIN role only.
  if (user.role === "ADMIN") return true;
  return (
    user.permissionGroup?.permissions.includes(requiredPermission) ||
    user.customPermissions?.includes(requiredPermission) ||
    false
  );
}

// NOTE: The server-side `requireServerPermission(req, permission)` guard lives in
// `@/lib/server-permissions`. It is intentionally kept out of this module so the
// client-safe utilities here (used by PermissionGuard and the admin UI) never
// pull `@prisma/client` or server auth helpers into the browser bundle.
