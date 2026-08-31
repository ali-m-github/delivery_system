"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DANGEROUS_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  SYSTEM_PERMISSIONS,
  isDangerousPermission,
  type SystemPermission,
} from "@/lib/permissions";

// ─── Shared display helpers ───────────────────────────────────────────────────

export function permissionLabel(perm: string): string {
  return PERMISSION_LABELS[perm as SystemPermission] ?? perm.replace(/_/g, " ");
}

/**
 * Groups a permission list by the canonical PERMISSION_GROUPS catalog.
 * Permissions missing from the catalog (stale data) fall back to "Other".
 */
export function groupPermissions(
  perms: readonly string[],
): { key: string; label: string; permissions: string[] }[] {
  const unique = [...new Set(perms)];
  return PERMISSION_GROUPS.map(
    (g): { key: string; label: string; permissions: string[] } => ({
      key: g.key,
      label: g.label,
      permissions: g.permissions.filter((p) => unique.includes(p)),
    }),
  )
    .filter((g) => g.permissions.length > 0)
    .concat(
      unique.some((p) => !SYSTEM_PERMISSIONS.includes(p as SystemPermission))
        ? [
            {
              key: "other",
              label: "Other",
              permissions: unique.filter(
                (p) => !SYSTEM_PERMISSIONS.includes(p as SystemPermission),
              ),
            },
          ]
        : [],
    );
}

/** Role badge with a stable color per role (matches the employee table). */
export function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    ADMIN:
      "bg-purple-500/20 text-purple-300 border border-purple-500/30",
    MERCHANT:
      "bg-amber-500/20 text-amber-300 border border-amber-500/30",
    DRIVER: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
    EMPLOYEE:
      "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30",
    USER: "bg-gray-500/20 text-gray-300 border border-gray-500/30",
  };
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
        styles[role] ?? styles.USER
      }`}
    >
      {role}
    </span>
  );
}

/**
 * Renders a read-only, grouped list of permissions. `sourceOf` maps each
 * permission to its origin label (e.g. "Via group", "Custom"), letting the UI
 * distinguish inherited permissions from custom per-user permissions.
 */
export function EffectivePermissionList({
  permissions,
  sourceOf,
  maxRows,
}: {
  permissions: readonly string[];
  sourceOf?: (perm: string) => string | undefined;
  maxRows?: number;
}) {
  const groups = useMemo(
    () => groupPermissions(permissions),
    [permissions],
  );

  if (groups.length === 0) {
    return (
      <p className="text-xs text-gray-600 italic">
        No permissions — this account can only reach the standard staff areas.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {group.label}
            </span>
            <span className="text-[10px] text-gray-600">
              {group.permissions.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {group.permissions.map((perm) => {
              const source = sourceOf?.(perm);
              const dangerous = isDangerousPermission(perm);
              return (
                <span
                  key={perm}
                  title={`${PERMISSION_DESCRIPTIONS[perm as SystemPermission] ?? perm}${
                    source ? ` — ${source}` : ""
                  }`}
                  className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium border ${
                    dangerous
                      ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                      : source
                        ? "bg-purple-500/10 text-purple-300 border-purple-500/20"
                        : "bg-cyan-500/10 text-cyan-300 border-cyan-500/20"
                  }`}
                >
                  {permissionLabel(perm)}
                  {source && (
                    <span
                      className={
                        dangerous
                          ? "text-amber-500/80"
                          : "text-purple-500/80"
                      }
                    >
                      {" "}
                      · {source}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      ))}
      {maxRows !== undefined &&
        permissions.length > maxRows && (
          <p className="text-[11px] text-gray-500">
            {permissions.length} permissions total, grouped above.
          </p>
        )}
    </div>
  );
}

// ─── Confirmation Modal ───────────────────────────────────────────────────────

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, loading]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !loading && onCancel()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 w-full max-w-md bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-6"
      >
        <h3
          className={`text-base font-semibold mb-2 ${
            danger ? "text-red-300" : "text-gray-200"
          }`}
        >
          {title}
        </h3>
        <div className="text-sm text-gray-400 mb-5 space-y-2">{message}</div>
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400
                       border border-white/10 bg-white/5 hover:bg-white/10
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-200 ${
                         danger
                           ? "bg-gradient-to-r from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 shadow-[0_0_12px_rgba(239,68,68,0.3)]"
                           : "bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                       }`}
          >
            {loading ? "Saving..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Grouped Permission Checkbox Grid ─────────────────────────────────────────

/**
 * Grouped permission checkbox grid for the employee and permission-group
 * forms. Renders every canonical permission (no duplicates possible — one
 * checkbox per permission id), grouped by area with search, per-group
 * select-all, and a selection summary.
 *
 * - `inheritedPerms` marks permissions already granted by the user's
 *   selected group; they are shown as "inherited" so an admin can see which
 *   custom picks would be redundant.
 * - `showDangerousConfirm` asks for confirmation when a dangerous permission
 *   is being toggled ON.
 */
export function GroupedPermissionPicker({
  value,
  onChange,
  inheritedPerms = [],
  showDangerousConfirm = true,
  emptyHint,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  inheritedPerms?: string[];
  showDangerousConfirm?: boolean;
  emptyHint?: string;
}) {
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<SystemPermission | null>(null);

  const query = search.trim().toLowerCase();
  const matches = (perm: SystemPermission) =>
    !query ||
    permissionLabel(perm).toLowerCase().includes(query) ||
    PERMISSION_DESCRIPTIONS[perm]?.toLowerCase().includes(query) ||
    perm.toLowerCase().includes(query);

  const visibleGroups = PERMISSION_GROUPS.map((g) => ({
    ...g,
    permissions: g.permissions.filter(matches),
  })).filter((g) => g.permissions.length > 0);

  const inheritedSet = new Set(inheritedPerms);
  const selectedCount = value.length;
  const redundantCount = value.filter((p) => inheritedSet.has(p)).length;

  const commitToggle = (perm: SystemPermission, next: boolean) => {
    onChange(
      next
        ? [...new Set([...value, perm])]
        : value.filter((p) => p !== perm),
    );
  };

  const handleToggle = (perm: SystemPermission) => {
    const next = !value.includes(perm);
    if (next && showDangerousConfirm && isDangerousPermission(perm)) {
      setPending(perm);
      return;
    }
    commitToggle(perm, next);
  };

  const toggleGroup = (groupPerms: readonly SystemPermission[]) => {
    const allSelected = groupPerms.every((p) => value.includes(p));
    if (allSelected) {
      const remove = new Set<string>(groupPerms);
      onChange(value.filter((p) => !remove.has(p)));
    } else {
      onChange([...new Set([...value, ...groupPerms])]);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search + summary */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <svg
            className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35m1.35-4.65a6 6 0 11-12 0 6 6 0 0112 0z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search permissions…"
            className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                       focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                       transition-all duration-200 text-sm"
          />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-gray-400 whitespace-nowrap">
          <span className="px-2 py-1 rounded-lg bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
            {selectedCount} selected
          </span>
          {redundantCount > 0 && (
            <span
              title="Already granted by the selected permission group — saving them as custom is allowed but unnecessary."
              className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/30"
            >
              {redundantCount} already in group
            </span>
          )}
        </div>
      </div>

      {/* Groups */}
      {visibleGroups.length === 0 ? (
        <p className="text-sm text-gray-500">
          {emptyHint ??
            "No permissions match your search. The permission list is the fixed system catalog."}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleGroups.map((group) => {
            const groupSelected = group.permissions.filter((p) =>
              value.includes(p),
            ).length;
            const allSelected =
              groupSelected === group.permissions.length;
            const someSelected =
              groupSelected > 0 && groupSelected < group.permissions.length;
            return (
              <div
                key={group.key}
                className="rounded-xl bg-white/[0.03] border border-white/10 overflow-hidden"
              >
                <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-white/5 bg-white/[0.02]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold text-gray-300 truncate">
                      {group.label}
                    </span>
                    <span className="text-[10px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                      {groupSelected}/{group.permissions.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.permissions)}
                    disabled={group.permissions.length === 0}
                    title={
                      allSelected
                        ? `Remove all ${group.label} permissions`
                        : `Select all ${group.label} permissions`
                    }
                    className="text-[10px] font-semibold text-cyan-400 hover:text-cyan-300
                               disabled:opacity-40 disabled:cursor-not-allowed
                               transition-colors duration-150 whitespace-nowrap"
                  >
                    {allSelected
                      ? "Clear"
                      : someSelected
                        ? "Select all"
                        : "All"}
                  </button>
                </div>
                <div className="p-2 space-y-0.5">
                  {group.permissions.map((perm) => {
                    const checked = value.includes(perm);
                    const inherited = inheritedSet.has(perm);
                    const dangerous = isDangerousPermission(perm);
                    return (
                      <label
                        key={perm}
                        title={PERMISSION_DESCRIPTIONS[perm]}
                        className={`flex items-start gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150
                                   ${
                                     checked
                                       ? "bg-cyan-500/10"
                                       : "hover:bg-white/5"
                                   }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggle(perm)}
                          className="sr-only"
                        />
                        <span
                          className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all
                                     ${
                                       checked
                                         ? dangerous
                                           ? "bg-amber-500 border-amber-500"
                                           : "bg-cyan-500 border-cyan-500"
                                         : "border-gray-600 bg-white/5"
                                     }`}
                        >
                          {checked && (
                            <svg
                              className="w-3 h-3 text-white"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          )}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span
                            className={`block text-sm leading-tight ${
                              checked
                                ? dangerous
                                  ? "text-amber-200"
                                  : "text-gray-100"
                                : "text-gray-300"
                            }`}
                          >
                            {permissionLabel(perm)}
                          </span>
                          <span className="block text-[10px] text-gray-500 truncate">
                            {PERMISSION_DESCRIPTIONS[perm]}
                          </span>
                          {(dangerous || inherited) && (
                            <span className="flex gap-1 mt-1">
                              {dangerous && (
                                <span
                                  title="Sensitive permission — granting it requires confirmation."
                                  className="inline-block px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                >
                                  Sensitive
                                </span>
                              )}
                              {inherited && (
                                <span
                                  title="Already granted by the selected permission group."
                                  className="inline-block px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wide bg-purple-500/15 text-purple-400 border border-purple-500/30"
                                >
                                  Via group
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dangerous-permission confirmation */}
      {pending && (
        <ConfirmModal
          title="Grant sensitive permission"
          message={
            <>
              <p>
                You are about to grant{" "}
                <strong className="text-amber-300">
                  {permissionLabel(pending)}
                </strong>{" "}
                to this account. Sensitive permissions can change financial
                amounts or roll back delivered orders.
              </p>
              <p className="text-xs text-gray-500">
                {PERMISSION_DESCRIPTIONS[pending]}
              </p>
            </>
          }
          confirmLabel="Grant permission"
          danger
          onConfirm={() => {
            commitToggle(pending, true);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

// ─── Effective-Permission Detail Modal ────────────────────────────────────────

export type PermSource = "group" | "custom";

/**
 * Read-only modal showing a user's full effective permission set, grouped by
 * area and distinguishing inherited (group) permissions from custom ones.
 */
export function EffectivePermissionModal({
  userLabel,
  role,
  group,
  groupPerms,
  customPerms,
  adminBypass = false,
  onClose,
}: {
  userLabel: string;
  role: string;
  group: string | null;
  groupPerms: string[];
  customPerms: string[];
  /** ADMIN accounts bypass the permission map — show the full catalog. */
  adminBypass?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Effective = group ∪ custom (deduped); custom wins the "source" label so an
  // admin can always tell which picks are per-user overrides. ADMIN accounts
  // bypass the map entirely and hold every catalog permission.
  const effective = useMemo(() => {
    if (adminBypass) {
      return SYSTEM_PERMISSIONS.map(
        (p): { perm: string; source: PermSource } => ({
          perm: p,
          source: "group",
        }),
      );
    }
    const seen = new Set<string>();
    const out: { perm: string; source: PermSource }[] = [];
    for (const p of groupPerms) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push({ perm: p, source: "group" });
      }
    }
    for (const p of customPerms) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push({ perm: p, source: "custom" });
      }
    }
    return out;
  }, [groupPerms, customPerms, adminBypass]);

  const effectivePerms = effective.map((e) => e.perm);
  const sourceOf = (perm: string): string | undefined => {
    if (adminBypass) return undefined;
    const entry = effective.find((e) => e.perm === perm);
    if (!entry) return undefined;
    if (entry.source === "group" && customPerms.includes(perm)) {
      return "Group + custom";
    }
    return entry.source === "custom" ? "Custom" : "Via group";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Effective permissions for ${userLabel}`}
        className="relative z-10 w-full max-w-2xl bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-200">
              Effective permissions
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {userLabel} ·{" "}
              {effectivePerms.length} permission
              {effectivePerms.length !== 1 ? "s" : ""} in total
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-xl leading-none transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <RoleBadge role={role} />
          <span className="text-xs text-gray-400">
            {group ? (
              <>
                Permission group:{" "}
                <span className="text-cyan-400 font-medium">{group}</span>
              </>
            ) : (
              "No permission group assigned"
            )}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full border ${
              customPerms.length > 0
                ? "bg-purple-500/10 text-purple-300 border-purple-500/20"
                : "bg-white/5 text-gray-500 border-white/10"
            }`}
          >
            {customPerms.length} custom
          </span>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 mb-4 text-[11px] text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-cyan-500/40 border border-cyan-500/40" />
            Inherited from group
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-purple-500/40 border border-purple-500/40" />
            Custom (per-user)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-500/40 border border-amber-500/40" />
            Sensitive
          </span>
        </div>

        {adminBypass && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-300">
            ADMIN accounts bypass the permission map — every permission is
            granted automatically, regardless of group or custom picks.
          </div>
        )}

        <EffectivePermissionList
          permissions={effectivePerms}
          sourceOf={sourceOf}
        />

        <div className="flex justify-end mt-5 pt-4 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400
                       border border-white/10 bg-white/5 hover:bg-white/10
                       transition-all duration-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Re-exported so admin pages can render "dangerous" hints without importing
// the raw catalog entry twice.
export { DANGEROUS_PERMISSIONS };
