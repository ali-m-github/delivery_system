"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SYSTEM_PERMISSIONS,
  isDangerousPermission,
  newlyDangerousPermissions,
} from "@/lib/permissions";
import {
  ConfirmModal,
  EffectivePermissionList,
  EffectivePermissionModal,
  GroupedPermissionPicker,
  RoleBadge,
  permissionLabel,
} from "@/components/admin/PermissionPicker";

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  permissionGroupId: string | null;
  permissionGroup?: {
    id: string;
    name: string;
    permissions: string[];
  } | null;
  customPermissions: string[];
}

interface PermissionGroupOption {
  id: string;
  name: string;
  permissions: string[];
}

type ConfirmAction =
  | {
      kind: "delete";
      user: User;
    }
  | {
      kind: "save";
      newDangerous: string[];
      removed: string[];
    };

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmployeesTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("EMPLOYEE");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [permissionGroups, setPermissionGroups] = useState<
    PermissionGroupOption[]
  >([]);
  const [permissionGroupId, setPermissionGroupId] = useState("");
  const [customPermissions, setCustomPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmAction | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const [effectiveView, setEffectiveView] = useState<User | null>(null);

  const editingEmployeeId = editingUser?.id ?? null;

  // ── Data loading ─────────────────────────────────────────────────────────────

  const fetchUsers = async () => {
    setUsersLoading(true);
    setFetchError("");
    try {
      const res = await fetch("/api/admin/users");
      const data = res.ok ? await res.json() : null;
      if (res.ok) {
        setUsers(data);
      } else {
        const body = await res.json().catch(() => null);
        setFetchError(body?.error || "Failed to load employees");
      }
    } catch {
      setFetchError("Network error while loading employees");
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchPermissionGroups = async () => {
    setGroupsLoading(true);
    try {
      const res = await fetch("/api/admin/permission-groups");
      if (res.ok) {
        const data = await res.json();
        setPermissionGroups(data);
      }
    } catch {
      // non-fatal: the employee form still works without groups
    } finally {
      setGroupsLoading(false);
    }
  };

  useEffect(() => {
    // Fetch on mount (matches the existing admin-tab pattern in this codebase).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchUsers();
    fetchPermissionGroups();
  }, []);

  // ── Derived form state ───────────────────────────────────────────────────────

  const selectedGroup = useMemo(
    () => permissionGroups.find((g) => g.id === permissionGroupId) ?? null,
    [permissionGroups, permissionGroupId],
  );
  const inheritedPerms = useMemo(
    () => selectedGroup?.permissions ?? [],
    [selectedGroup],
  );

  const effectivePreview = useMemo(() => {
    const seen = new Set<string>();
    const out: { perm: string; source: "group" | "custom" }[] = [];
    for (const p of inheritedPerms) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push({ perm: p, source: "group" });
      }
    }
    for (const p of customPermissions) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push({ perm: p, source: "custom" });
      }
    }
    return out;
  }, [inheritedPerms, customPermissions]);

  const effectivePerms = effectivePreview.map((e) => e.perm);
  const effectiveSourceOf = (perm: string): string | undefined => {
    const entry = effectivePreview.find((e) => e.perm === perm);
    if (!entry) return undefined;
    if (entry.source === "group" && customPermissions.includes(perm)) {
      return "Group + custom";
    }
    return entry.source === "custom" ? "Custom" : "Via group";
  };

  const redundantCustom = customPermissions.filter((p) =>
    inheritedPerms.includes(p),
  );

  // ── Form actions ─────────────────────────────────────────────────────────────

  const resetEmployeeForm = () => {
    setUsername("");
    setEmail("");
    setPassword("");
    setLogoFile(null);
    setRole("EMPLOYEE");
    setPermissionGroupId("");
    setCustomPermissions([]);
    setEditingUser(null);
    setError("");
    setSuccess("");
  };

  const baselineGroupPerms = editingUser?.permissionGroup?.permissions ?? [];
  const baselineEffective = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of [
      ...baselineGroupPerms,
      ...(editingUser?.customPermissions ?? []),
    ]) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingUser]);

  const roleChange =
    editingUser !== null && role !== editingUser.role
      ? { from: editingUser.role, to: role }
      : null;
  const isPrivilegeEscalation =
    roleChange !== null && roleChange.to === "ADMIN";
  const isPrivilegeDowngrade =
    roleChange !== null &&
    roleChange.from === "ADMIN" &&
    roleChange.to !== "ADMIN";

  // ADMIN accounts bypass the permission map entirely, so a permission diff is
  // meaningless when the target role is ADMIN (nothing is actually lost or
  // gained) — suppress it. A demotion from ADMIN always confirms, because the
  // account loses the full-catalog bypass.
  const targetIsAdmin = editingUser !== null && role === "ADMIN";
  const previewNewDangerous = targetIsAdmin
    ? []
    : newlyDangerousPermissions(effectivePerms, baselineEffective);
  const previewRemoved = targetIsAdmin
    ? []
    : baselineEffective.filter((p) => !effectivePerms.includes(p));

  const hasSaveWarning =
    isPrivilegeEscalation ||
    isPrivilegeDowngrade ||
    previewNewDangerous.length > 0 ||
    previewRemoved.length > 0;

  // ── Save / delete execution ──────────────────────────────────────────────────

  const runSave = async () => {
    setConfirming(true);
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const url = editingEmployeeId
        ? `/api/admin/employees/${editingEmployeeId}`
        : "/api/admin/users";
      const method = editingEmployeeId ? "PUT" : "POST";

      // JSON body — the employees PUT route accepts application/json and
      // treats omitted fields as "no change", which is exactly what we want
      // when no logo file is attached. A multipart body would be required for
      // a logo upload, so only switch to FormData when a file is present.
      let body: string | FormData;
      let headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const payload: Record<string, unknown> = {
        username: username.trim(),
        role,
        permissionGroupId: permissionGroupId || null,
        customPermissions,
      };
      if (!editingEmployeeId) {
        // Create mode: email and password are required
        payload.email = email;
        payload.password = password;
      } else if (password && password.trim()) {
        // Edit mode: password optional (blank keeps the current password)
        payload.password = password.trim();
      }
      if (logoFile) {
        const formData = new FormData();
        formData.append("username", String(payload.username));
        formData.append("role", String(payload.role));
        formData.append(
          "permissionGroupId",
          payload.permissionGroupId == null ? "" : String(payload.permissionGroupId),
        );
        formData.append(
          "customPermissions",
          JSON.stringify(customPermissions),
        );
        if (!editingEmployeeId) {
          formData.append("email", email);
          formData.append("password", password);
        } else if (password && password.trim()) {
          formData.append("password", password.trim());
        }
        formData.append("logo", logoFile);
        body = formData;
        headers = {};
      } else {
        body = JSON.stringify(payload);
      }

      const res = await fetch(url, { method, headers, body });

      if (res.ok) {
        const wasEdit = Boolean(editingEmployeeId);
        resetEmployeeForm();
        setSuccess(
          wasEdit ? "Employee updated." : "Employee created.",
        );
        await fetchUsers();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Failed to save employee");
      }
    } catch {
      setError("Network error");
    } finally {
      setConfirming(false);
      setLoading(false);
      setPendingConfirm(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !email) return;
    if (!editingEmployeeId && !password) return;

    if (!hasSaveWarning) {
      void runSave();
      return;
    }
    setPendingConfirm({
      kind: "save",
      newDangerous: previewNewDangerous,
      removed: previewRemoved,
    });
  };

  const confirmDeleteUser = async (user: User) => {
    setConfirming(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/employees/${user.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (editingEmployeeId === user.id) resetEmployeeForm();
        setSuccess(`Employee "${user.username}" deleted.`);
        await fetchUsers();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Failed to delete employee");
      }
    } catch {
      setError("Network error");
    } finally {
      setConfirming(false);
      setPendingConfirm(null);
    }
  };

  const startEdit = (user: User) => {
    setEditingUser(user);
    setUsername(user.username);
    setEmail(user.email);
    setRole(user.role);
    setPermissionGroupId(user.permissionGroupId || "");
    setCustomPermissions(user.customPermissions || []);
    setPassword("");
    setLogoFile(null);
    setError("");
    setSuccess("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Create / Edit Employee Form ── */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          {editingEmployeeId ? "Edit Employee" : "Create Employee"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div>
            <label
              htmlFor="empUsername"
              className="block text-xs font-medium text-gray-400 mb-1.5"
            >
              Username (Login)
            </label>
            <input
              id="empUsername"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="jdoe"
              className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                         focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                         transition-all duration-200 text-sm"
            />
          </div>

          {/* Email & Password */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="empEmail"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Email
              </label>
              <input
                id="empEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={Boolean(editingEmployeeId)}
                placeholder="john@example.com"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {editingEmployeeId && (
                <p className="mt-1 text-[10px] text-gray-500 italic">
                  *(Email cannot be changed after creation)*
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="empPassword"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Password
              </label>
              <input
                id="empPassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                           focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                           transition-all duration-200 text-sm"
              />
              {editingEmployeeId && (
                <p className="mt-1 text-[10px] text-gray-500 italic">
                  *(Leave blank to keep current password)*
                </p>
              )}
            </div>
          </div>

          {/* Role */}
          <div>
            <label
              htmlFor="role"
              className="block text-xs font-medium text-gray-400 mb-1.5"
            >
              Role
            </label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100
                         focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                         transition-all duration-200 text-sm appearance-none cursor-pointer"
            >
              <option value="EMPLOYEE" className="bg-gray-900">
                EMPLOYEE
              </option>
              <option value="ADMIN" className="bg-gray-900">
                ADMIN
              </option>
              <option value="MERCHANT" className="bg-gray-900">
                MERCHANT
              </option>
              <option value="DRIVER" className="bg-gray-900">
                DRIVER
              </option>
              <option value="USER" className="bg-gray-900">
                USER
              </option>
            </select>
            {role === "ADMIN" && (
              <p className="mt-1 text-[10px] text-amber-400/90">
                ADMIN accounts bypass the permission map — every permission is
                granted automatically.
              </p>
            )}
          </div>

          {/* Merchant Logo (only for Merchant role) */}
          {role === "MERCHANT" && (
            <div>
              <label
                htmlFor="merchantLogo"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Merchant Logo
              </label>
              <input
                id="merchantLogo"
                type="file"
                accept="image/*"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4
                           file:rounded-lg file:border-0 file:text-sm file:font-semibold
                           file:bg-cyan-500/20 file:text-cyan-300
                           hover:file:bg-cyan-500/30 file:cursor-pointer file:transition-all file:duration-200
                           focus:outline-none"
              />
              {logoFile && (
                <p className="mt-1 text-[10px] text-cyan-400/80">
                  {logoFile.name} selected
                </p>
              )}
            </div>
          )}

          {/* Permission Group */}
          <div>
            <label
              htmlFor="permissionGroupId"
              className="block text-xs font-medium text-gray-400 mb-1.5"
            >
              Permission Group
            </label>
            <select
              id="permissionGroupId"
              value={permissionGroupId}
              onChange={(e) => setPermissionGroupId(e.target.value)}
              disabled={groupsLoading}
              className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100
                         focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                         transition-all duration-200 text-sm appearance-none cursor-pointer disabled:opacity-50"
            >
              <option value="" className="bg-gray-900">
                {groupsLoading
                  ? "Loading groups…"
                  : "No group (custom permissions only)"}
              </option>
              {permissionGroups.map((group) => (
                <option key={group.id} value={group.id} className="bg-gray-900">
                  {group.name} ({group.permissions.length} permissions)
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-gray-500 italic">
              The selected group&apos;s permissions are inherited by this user
              on top of any custom picks.
            </p>
            {selectedGroup && (
              <div className="mt-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-cyan-400">
                    Inherited from {selectedGroup.name}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {selectedGroup.permissions.length} permission
                    {selectedGroup.permissions.length === 1 ? "" : "s"}
                  </span>
                </div>
                <EffectivePermissionList
                  permissions={selectedGroup.permissions}
                />
              </div>
            )}
          </div>

          {/* Custom Permissions (layered on top of the Permission Group) */}
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-gray-400">
                Custom Permissions
              </span>
              {redundantCustom.length > 0 && (
                <span
                  title={redundantCustom
                    .map((p) => permissionLabel(p))
                    .join(", ")}
                  className="text-[10px] text-amber-400/90"
                >
                  {redundantCustom.length} already inherited from the group
                </span>
              )}
            </div>
            <p className="text-[10px] text-cyan-400/80 mb-3">
              These permissions are added on top of the selected Permission
              Group.
            </p>
            <GroupedPermissionPicker
              value={customPermissions}
              onChange={setCustomPermissions}
              inheritedPerms={inheritedPerms}
              emptyHint="No permissions match your search."
            />
          </div>

          {/* Live effective-permission preview */}
          <div>
            <span className="block text-xs font-medium text-gray-400 mb-1.5">
              Effective Permissions Preview
            </span>
            <div className="px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/10">
              {role === "ADMIN" ? (
                <p className="text-xs text-amber-400/90">
                  ADMIN role bypasses the permission map — this account will
                  hold <strong>every</strong> permission automatically.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 mb-2 text-[10px] text-gray-500">
                    <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                      {inheritedPerms.length} via group
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                      {customPermissions.length} custom
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10">
                      {effectivePerms.length} total
                    </span>
                  </div>
                  <EffectivePermissionList
                    permissions={effectivePerms}
                    sourceOf={effectiveSourceOf}
                  />
                </>
              )}
            </div>
          </div>

          {/* Submit + Cancel */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={
                loading ||
                !username.trim() ||
                !email ||
                (!editingEmployeeId && !password)
              }
              className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-cyan-600
                         hover:from-cyan-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed
                         shadow-[0_0_12px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)]
                         transition-all duration-200"
            >
              {loading
                ? editingEmployeeId
                  ? "Updating..."
                  : "Creating..."
                : editingEmployeeId
                  ? "Update Employee"
                  : "Create Employee"}
            </button>

            {editingEmployeeId && (
              <button
                type="button"
                onClick={resetEmployeeForm}
                disabled={loading}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-gray-300 bg-white/5 border border-white/10
                           hover:bg-white/10 hover:text-white disabled:opacity-50
                           transition-all duration-200"
              >
                Cancel
              </button>
            )}
            {success && (
              <span className="text-xs text-green-400 flex items-center gap-1.5">
                <svg
                  className="w-3.5 h-3.5"
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
                {success}
              </span>
            )}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </form>
      </div>

      {/* ── Employees Table ── */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          Employees ({users.length})
        </h2>

        {usersLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : fetchError ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="text-sm text-red-400 flex-1">{fetchError}</p>
            <button
              type="button"
              onClick={() => fetchUsers()}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 border border-white/10
                         hover:bg-white/10 hover:text-white transition-all duration-200"
            >
              Retry
            </button>
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-500">No employees created yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[768px] text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-3 font-medium">Name</th>
                  <th className="py-3 px-3 font-medium">Email</th>
                  <th className="py-3 px-3 font-medium">Role</th>
                  <th className="py-3 px-3 font-medium">Group</th>
                  <th className="py-3 px-3 font-medium whitespace-nowrap">Effective Permissions</th>
                  <th className="py-3 px-3 font-medium border-l border-white/10">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {users.map((user) => {
                  const groupPerms = user.permissionGroup?.permissions ?? [];
                  const customPerms = user.customPermissions ?? [];
                  // ADMIN accounts bypass the map and hold the full catalog.
                  const effectiveCount =
                    user.role === "ADMIN"
                      ? SYSTEM_PERMISSIONS.length
                      : new Set([...groupPerms, ...customPerms]).size;
                  const hasSensitive =
                    user.role === "ADMIN" ||
                    [...groupPerms, ...customPerms].some(
                      isDangerousPermission,
                    );
                  return (
                    <tr
                      key={user.id}
                      className="hover:bg-white/[0.03] transition-colors duration-150"
                    >
                      <td className="py-3 px-3 text-gray-200 whitespace-nowrap">
                        {user.username}
                      </td>
                      <td className="py-3 px-3 text-gray-400">
                        <span
                          className="block max-w-[200px] truncate"
                          title={user.email}
                        >
                          {user.email}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <RoleBadge role={user.role} />
                      </td>
                      <td className="py-3 px-3 text-gray-400 whitespace-nowrap">
                        {user.permissionGroup ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-cyan-300 text-xs">
                              {user.permissionGroup.name}
                            </span>
                            <span className="text-[10px] text-gray-500">
                              {groupPerms.length} perms
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-600">None</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => setEffectiveView(user)}
                          title="View the full effective permission set"
                          className="inline-flex items-center gap-2 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold
                                     bg-white/5 border border-white/10 text-gray-300
                                     hover:bg-white/10 hover:text-white transition-all duration-200"
                        >
                          <span>
                            {effectiveCount} permission
                            {effectiveCount === 1 ? "" : "s"}
                          </span>
                          {hasSensitive && (
                            <span
                              title="Includes sensitive permissions"
                              className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
                            />
                          )}
                          <span className="text-gray-500">›</span>
                        </button>
                      </td>
                      <td className="py-3 px-3 border-l border-white/10">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(user)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                       bg-gradient-to-r from-amber-500/20 to-amber-600/20 text-amber-300
                                       border border-amber-500/30 hover:from-amber-500/30 hover:to-amber-600/30
                                       hover:shadow-[0_0_10px_rgba(245,158,11,0.3)]
                                       transition-all duration-200"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setPendingConfirm({ kind: "delete", user })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                       bg-gradient-to-r from-red-500/20 to-red-600/20 text-red-300
                                       border border-red-500/30 hover:from-red-500/30 hover:to-red-600/30
                                       hover:shadow-[0_0_10px_rgba(239,68,68,0.3)]
                                       transition-all duration-200"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Effective-permissions modal ── */}
      {effectiveView && (
        <EffectivePermissionModal
          userLabel={effectiveView.username}
          role={effectiveView.role}
          group={effectiveView.permissionGroup?.name ?? null}
          groupPerms={effectiveView.permissionGroup?.permissions ?? []}
          customPerms={effectiveView.customPermissions ?? []}
          adminBypass={effectiveView.role === "ADMIN"}
          onClose={() => setEffectiveView(null)}
        />
      )}

      {/* ── Save-confirmation modal ── */}
      {pendingConfirm?.kind === "save" && (
        <ConfirmModal
          title={editingEmployeeId ? "Confirm employee changes" : "Confirm new employee"}
          confirmLabel="Save changes"
          danger
          loading={confirming}
          onConfirm={() => void runSave()}
          onCancel={() => setPendingConfirm(null)}
          message={
            <div className="space-y-3">
              {roleChange && (
                <p>
                  Changing role from{" "}
                  <span className="font-medium text-gray-200">
                    {roleChange.from}
                  </span>{" "}
                  to{" "}
                  <span
                    className={`font-medium ${
                      isPrivilegeEscalation ? "text-amber-300" : "text-gray-200"
                    }`}
                  >
                    {roleChange.to}
                  </span>
                  {isPrivilegeEscalation &&
                    " — this account will bypass the permission map (full access)."}
                  {isPrivilegeDowngrade &&
                    " — this account loses the full-catalog ADMIN bypass and falls back to its group + custom permissions."}
                </p>
              )}
              {pendingConfirm.newDangerous.length > 0 && (
                <div>
                  <p className="mb-1.5">
                    Newly granted <strong>sensitive permissions</strong>:
                  </p>
                  <ul className="space-y-1">
                    {pendingConfirm.newDangerous.map((p) => (
                      <li
                        key={p}
                        className="text-amber-300 text-xs flex items-start gap-2"
                      >
                        <span className="mt-px">•</span>
                        <span>
                          <span className="font-medium">
                            {permissionLabel(p)}
                          </span>{" "}
                          — {p}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {pendingConfirm.removed.length > 0 && (
                <div>
                  <p className="mb-1.5">
                    Permissions being{" "}
                    <strong className="text-red-300">removed</strong>:
                  </p>
                  <ul className="space-y-1">
                    {pendingConfirm.removed.map((p) => (
                      <li
                        key={p}
                        className="text-xs text-gray-300 flex items-start gap-2"
                      >
                        <span className="mt-px">•</span>
                        <span>
                          <span className="font-medium">
                            {permissionLabel(p)}
                          </span>{" "}
                          — {p}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          }
        />
      )}

      {/* ── Delete-confirmation modal ── */}
      {pendingConfirm?.kind === "delete" && (
        <ConfirmModal
          title="Delete employee"
          confirmLabel="Delete employee"
          danger
          loading={confirming}
          onConfirm={() => void confirmDeleteUser(pendingConfirm.user)}
          onCancel={() => setPendingConfirm(null)}
          message={
            <div className="space-y-2">
              <p>
                Delete employee{" "}
                <strong className="text-gray-200">
                  &quot;{pendingConfirm.user.username}&quot;
                </strong>
                ?
              </p>
              <p className="text-xs text-gray-500">
                This action cannot be undone.
              </p>
            </div>
          }
        />
      )}
    </div>
  );
}
