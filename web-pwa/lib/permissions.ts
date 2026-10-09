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
  // ── Granular Driver Rate RBAC ──
  // Grants the ability to edit a driver's commission rates from the /drivers
  // directory page (zone-based rates). Assignable to employees via Permission
  // Groups or per-user Custom Permissions in the Admin Panel.
  "ACTION_DRIVER_RATE_EDIT",
  // ── Granular Delivered-Order Returns RBAC ──
  // Grants the ability to return a DELIVERED order (financialStatus WO or WD)
  // to the warehouse (RETURN/Re) or to any other status. Only assignable to
  // staff who should be allowed to roll back already-delivered orders.
  "ACTION_ORDER_RETURN",
  // ── Granular Exchange-Order Creation RBAC ──
  // Grants the ability to manually create the "<orderId>-Exchange" proof order
  // (e.g. when the returned/exchange item arrives before the order is
  // delivered). Independent of ACTION_ORDER_RETURN so admins can allow staff
  // to create exchange orders without granting the full returned-order
  // rollback power.
  "ACTION_ORDER_EXCHANGE",
  // ── Granular Statistics / Reports RBAC ──
  // Grants access to the /statistics page (reports & dashboards). ADMINS
  // always have access; assign this to employee Permission Groups or per-user
  // Custom Permissions to grant it to staff.
  "VIEW_STATISTICS",
] as const;

export type SystemPermission = (typeof SYSTEM_PERMISSIONS)[number];

// ─── Role & Permission Validation ─────────────────────────────────────────────
// Roles accepted when an admin creates/updates a user. "EMPLOYEE" is included
// because it is the default role in the Admin employee form and already exists
// in production data (it must validate consistently server-side).
export const VALID_USER_ROLES: readonly string[] = [
  "ADMIN",
  "MERCHANT",
  "DRIVER",
  "USER",
  "EMPLOYEE",
];

/**
 * Permissions that grant user-administration power. A non-admin actor may
 * never GRANT these — neither directly via a user's customPermissions nor
 * indirectly via a PermissionGroup — regardless of how the actor obtained
 * them themselves (their own access to perform the action is already checked
 * by `requireServerPermission`).
 */
export const PRIVILEGED_PERMISSIONS: readonly string[] = ["MANAGE_USERS"];

/** Fast lookup set over the canonical permission catalog. */
export const SYSTEM_PERMISSION_SET: ReadonlySet<string> = new Set(
  SYSTEM_PERMISSIONS,
);

/** True when `permission` is a canonical SYSTEM_PERMISSIONS entry. */
export function isValidPermission(permission: string): boolean {
  return SYSTEM_PERMISSION_SET.has(permission);
}

/**
 * Filters a list of permission strings down to the invalid (non-canonical)
 * entries, de-duplicated. Used by the admin APIs to reject unknown permission
 * strings before anything is persisted.
 */
export function unknownPermissions(
  permissions: readonly string[],
): string[] {
  return [...new Set(permissions)].filter((p) => !isValidPermission(p));
}

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

// ─── Permission Presentation Catalog (display-only) ──────────────────────────
// Presentation metadata for the ADMIN permission-management UI. Grouping is
// derived from where each permission is actually enforced in the backend
// (requireServerPermission / requireActionPermission call sites). These
// constants never participate in authorization — the backend remains the sole
// source of truth.
export const PERMISSION_GROUPS: {
  key: string;
  label: string;
  permissions: readonly SystemPermission[];
}[] = [
  {
    key: "orders",
    label: "Orders",
    permissions: [
      "MANAGE_ORDERS",
      "ORDERS_VIEW",
      "ORDERS_CREATE",
      "ORDERS_EDIT",
      "ORDERS_DISPATCH",
      "ORDERS_FINANCIAL",
      "ACTION_ORDER_RETURN",
      "ACTION_ORDER_EXCHANGE",
    ],
  },
  {
    key: "drivers",
    label: "Drivers",
    permissions: [
      "MANAGE_DRIVERS",
      "DRIVERS_VIEW",
      "DRIVERS_CREATE",
      "DRIVERS_PAYOUT",
      "ACTION_DRIVER_RATE_EDIT",
    ],
  },
  {
    key: "merchants",
    label: "Merchants",
    permissions: ["MANAGE_MERCHANTS", "MERCHANTS_MANAGE"],
  },
  {
    key: "treasury",
    label: "Treasury & Finance",
    permissions: ["MANAGE_FINANCE", "PAGE_ADMIN_TREASURY", "ACTION_TREASURY_TRANSACT"],
  },
  {
    key: "users",
    label: "Users & Access",
    permissions: ["MANAGE_USERS", "USERS_MANAGE"],
  },
  {
    key: "zones",
    label: "Zones",
    permissions: ["MANAGE_ZONES", "ZONES_MANAGE"],
  },
  {
    key: "reports",
    label: "Reports & Statistics",
    permissions: ["VIEW_STATISTICS"],
  },
];

export const PERMISSION_LABELS: Record<SystemPermission, string> = {
  MANAGE_ORDERS: "Manage Orders",
  ORDERS_VIEW: "View Orders",
  ORDERS_CREATE: "Create Orders",
  ORDERS_EDIT: "Edit Orders",
  ORDERS_DISPATCH: "Dispatch Orders",
  ORDERS_FINANCIAL: "Order Financial Adjustments",
  ACTION_ORDER_RETURN: "Return Delivered Orders",
  ACTION_ORDER_EXCHANGE: "Create Exchange Orders",
  MANAGE_DRIVERS: "Manage Drivers",
  DRIVERS_VIEW: "View Drivers",
  DRIVERS_CREATE: "Create Drivers",
  DRIVERS_PAYOUT: "Driver Payouts",
  ACTION_DRIVER_RATE_EDIT: "Edit Driver Rates",
  MANAGE_MERCHANTS: "Manage Merchants",
  MERCHANTS_MANAGE: "Merchant Management",
  MANAGE_FINANCE: "Manage Finance",
  PAGE_ADMIN_TREASURY: "Open Treasury Page",
  ACTION_TREASURY_TRANSACT: "Treasury Transactions",
  MANAGE_USERS: "Manage Users",
  USERS_MANAGE: "User Management",
  MANAGE_ZONES: "Manage Zones",
  ZONES_MANAGE: "Zone Management",
  VIEW_STATISTICS: "View Statistics & Reports",
};

export const PERMISSION_DESCRIPTIONS: Record<SystemPermission, string> = {
  MANAGE_ORDERS: "Admin order tools: bulk zone assignment, archiving, moving and fixing orders.",
  ORDERS_VIEW: "See the orders list and order details.",
  ORDERS_CREATE: "Create new orders, including sheet imports.",
  ORDERS_EDIT: "Edit order details after creation.",
  ORDERS_DISPATCH: "Dispatch orders to drivers for delivery.",
  ORDERS_FINANCIAL: "Apply financial corrections to orders (fees, amounts, status).",
  ACTION_ORDER_RETURN: "Roll delivered orders back to the warehouse or another status.",
  ACTION_ORDER_EXCHANGE:
    "Manually create the -Exchange proof order (when the returned item arrives before delivery).",
  MANAGE_DRIVERS: "Create, edit and delete driver profiles and their zones.",
  DRIVERS_VIEW: "See the driver directory and driver details.",
  DRIVERS_CREATE: "Register new drivers.",
  DRIVERS_PAYOUT: "Approve, void and settle driver payouts.",
  ACTION_DRIVER_RATE_EDIT: "Edit a driver's commission rates (zone and seller rates).",
  MANAGE_MERCHANTS: "Create, edit and manage merchant accounts.",
  MERCHANTS_MANAGE: "Merchant management actions (cash payout exclusions, linking).",
  MANAGE_FINANCE: "Finance tools: profit reports, billing, cash payouts and invoices.",
  PAGE_ADMIN_TREASURY: "Open the Treasury page and view treasury transactions.",
  ACTION_TREASURY_TRANSACT: "Record, approve or reject treasury transactions.",
  MANAGE_USERS: "Manage users and permission groups from the Admin Panel.",
  USERS_MANAGE: "User administration actions.",
  MANAGE_ZONES: "Create and manage delivery zones, including auto-assignment and training.",
  ZONES_MANAGE: "Zone management actions (overrides, per-zone editing).",
  VIEW_STATISTICS: "Open the Statistics page and view reports & dashboards.",
};

/**
 * Permission changes that the admin UI must confirm before saving, because they
 * are sensitive or hard to reason about. Purely a UX safeguard — the backend
 * re-validates every change server-side.
 */
export const DANGEROUS_PERMISSIONS: readonly SystemPermission[] = [
  "MANAGE_USERS",
  "ACTION_TREASURY_TRANSACT",
  "ORDERS_FINANCIAL",
  "ACTION_ORDER_RETURN",
  "ACTION_ORDER_EXCHANGE",
];

const DANGEROUS_SET: ReadonlySet<string> = new Set(DANGEROUS_PERMISSIONS);

/** True when `permission` is one of the DANGEROUS_PERMISSIONS entries. */
export function isDangerousPermission(permission: string): boolean {
  return DANGEROUS_SET.has(permission);
}

/**
 * Returns the permissions in `selected` that are dangerous AND not present in
 * `baseline` — i.e. dangerous permissions being newly granted (or re-granted).
 * Used to build confirmation dialogs for group edits and employee saves.
 */
export function newlyDangerousPermissions(
  selected: readonly string[],
  baseline: readonly string[],
): SystemPermission[] {
  const baselineSet = new Set(baseline);
  return SYSTEM_PERMISSIONS.filter(
    (p) => DANGEROUS_SET.has(p) && selected.includes(p) && !baselineSet.has(p),
  );
}
