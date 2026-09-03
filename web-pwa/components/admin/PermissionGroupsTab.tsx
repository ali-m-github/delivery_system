"use client";

import { useEffect, useState } from "react";
import {
  isDangerousPermission,
  newlyDangerousPermissions,
} from "@/lib/permissions";
import {
  ConfirmModal,
  EffectivePermissionList,
  GroupedPermissionPicker,
  permissionLabel,
} from "@/components/admin/PermissionPicker";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PermissionGroup {
  id: string;
  name: string;
  permissions: string[];
  _count?: { users: number };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PermissionGroupsTab() {
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [groupName, setGroupName] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingGroup, setEditingGroup] = useState<PermissionGroup | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<PermissionGroup | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [pendingSave, setPendingSave] = useState<{
    newDangerous: string[];
    removed: string[];
  } | null>(null);
  const [confirmingSave, setConfirmingSave] = useState(false);

  const fetchGroups = async () => {
    setGroupsLoading(true);
    setFetchError("");
    try {
      const res = await fetch("/api/admin/permission-groups");
      const data = res.ok ? await res.json() : null;
      if (res.ok) {
        setGroups(data);
      } else {
        const body = await res.json().catch(() => null);
        setFetchError(body?.error || "Failed to load permission groups");
      }
    } catch {
      setFetchError("Network error while loading permission groups");
    } finally {
      setGroupsLoading(false);
    }
  };

  useEffect(() => {
    // Fetch on mount (matches the existing admin-tab pattern in this codebase).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchGroups();
  }, []);

  const editingGroupId = editingGroup?.id ?? null;
  const userCount = editingGroup?._count?.users ?? 0;

  // Dangerous permissions this edit would newly grant vs. the current group.
  const previewNewDangerous = newlyDangerousPermissions(
    selectedPerms,
    editingGroup?.permissions ?? [],
  );

  const resetGroupForm = () => {
    setGroupName("");
    setSelectedPerms([]);
    setEditingGroup(null);
    setError("");
    setSuccess("");
  };

  // Permissions removed by the pending save (in edit mode).
  const previewRemoved = editingGroup
    ? editingGroup.permissions.filter((p) => !selectedPerms.includes(p))
    : [];

  const hasSaveWarning =
    previewNewDangerous.length > 0 || previewRemoved.length > 0;

  const runSave = async () => {
    setConfirmingSave(true);
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const url = editingGroupId
        ? `/api/admin/permission-groups/${editingGroupId}`
        : "/api/admin/permission-groups";
      const method = editingGroupId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: groupName.trim(),
          permissions: selectedPerms,
        }),
      });

      if (res.ok) {
        const wasEdit = Boolean(editingGroupId);
        resetGroupForm();
        setSuccess(
          wasEdit
            ? "Permission group updated."
            : "Permission group created.",
        );
        await fetchGroups();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Failed to save permission group");
      }
    } catch {
      setError("Network error");
    } finally {
      setConfirmingSave(false);
      setLoading(false);
      setPendingSave(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;
    if (!hasSaveWarning) {
      void runSave();
      return;
    }
    setPendingSave({
      newDangerous: previewNewDangerous,
      removed: previewRemoved,
    });
  };

  const startEditGroup = (group: PermissionGroup) => {
    setEditingGroup(group);
    setGroupName(group.name);
    setSelectedPerms([...group.permissions]);
    setError("");
    setSuccess("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/permission-groups/${pendingDelete.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (editingGroupId === pendingDelete.id) resetGroupForm();
        setSuccess(`Permission group "${pendingDelete.name}" deleted.`);
        await fetchGroups();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Failed to delete permission group");
      }
    } catch {
      setError("Network error");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Create / Edit Permission Group Form ── */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <h2 className="text-lg font-semibold text-gray-200">
            {editingGroup ? "Edit Permission Group" : "Create Permission Group"}
          </h2>
          {editingGroup && (
            <span
              title="Saving changes here immediately updates every assigned user's effective permissions."
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                userCount > 0
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                  : "bg-white/5 text-gray-500 border-white/10"
              }`}
            >
              Affects {userCount} user{userCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="groupName"
              className="block text-xs font-medium text-gray-400 mb-1.5"
            >
              Group Name
            </label>
            <input
              id="groupName"
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Finance Team"
              className="w-full sm:w-64 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100 placeholder-gray-600
                         focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                         transition-all duration-200 text-sm"
            />
          </div>

          {/* Permission picker — canonical SYSTEM_PERMISSIONS catalog, grouped by area */}
          <div>
            <span className="block text-xs font-medium text-gray-400 mb-1.5">
              Permissions
            </span>
            <p className="text-[10px] text-cyan-400/80 mb-3">
              Users assigned to this group inherit every permission selected
              below. Sensitive permissions require confirmation.
            </p>
            <GroupedPermissionPicker
              value={selectedPerms}
              onChange={setSelectedPerms}
              emptyHint="No permissions match your search."
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={loading || !groupName.trim()}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-cyan-600
                         hover:from-cyan-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed
                         shadow-[0_0_12px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)]
                         transition-all duration-200"
            >
              {loading
                ? "Saving..."
                : editingGroup
                  ? "Save Changes"
                  : "Create Group"}
            </button>
            {editingGroup && (
              <button
                type="button"
                onClick={resetGroupForm}
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

      {/* ── Groups List ── */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          Permission Groups ({groups.length})
        </h2>
        {groupsLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-14 rounded-lg bg-white/5 animate-pulse"
              />
            ))}
          </div>
        ) : fetchError ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="text-sm text-red-400 flex-1">{fetchError}</p>
            <button
              type="button"
              onClick={() => fetchGroups()}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 border border-white/10
                         hover:bg-white/10 hover:text-white transition-all duration-200"
            >
              Retry
            </button>
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-gray-500">
            No permission groups created yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4 font-medium">Name</th>
                  <th className="py-3 px-4 font-medium">Permissions</th>
                  <th className="py-3 px-4 font-medium">Users</th>
                  <th className="py-3 px-4 font-medium sticky right-0 z-20 bg-[#10131e] border-l border-white/10 shadow-[-10px_0_10px_-8px_rgba(0,0,0,0.5)]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {groups.map((group) => {
                  const sensitive = group.permissions.some(
                    isDangerousPermission,
                  );
                  return (
                    <tr
                      key={group.id}
                      className="hover:bg-white/[0.03] transition-colors duration-150"
                    >
                      <td className="py-3 px-4 text-gray-200 font-medium whitespace-nowrap">
                        {group.name}
                        {sensitive && (
                          <span
                            title="This group grants sensitive permissions"
                            className="ml-2 inline-block px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30 align-middle"
                          >
                            Sensitive
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <EffectivePermissionList
                          permissions={group.permissions}
                        />
                      </td>
                      <td className="py-3 px-4 text-gray-400 whitespace-nowrap">
                        {group._count?.users ?? 0}
                      </td>
                      <td className="py-3 px-4 sticky right-0 z-10 bg-[#10131e] border-l border-white/10 shadow-[-10px_0_10px_-8px_rgba(0,0,0,0.5)]">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEditGroup(group)}
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
                            onClick={() => setPendingDelete(group)}
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

      {/* ── Save-confirmation modal (newly granted sensitive / removed perms) ── */}
      {pendingSave && (
        <ConfirmModal
          title={
            editingGroup ? "Confirm group changes" : "Confirm new group"
          }
          confirmLabel="Save changes"
          danger
          loading={confirmingSave}
          onConfirm={() => void runSave()}
          onCancel={() => setPendingSave(null)}
          message={
            <div className="space-y-3">
              {pendingSave.newDangerous.length > 0 && (
                <div>
                  <p className="mb-1.5">
                    This will grant <strong>new sensitive permissions</strong>
                    :
                  </p>
                  <ul className="space-y-1">
                    {pendingSave.newDangerous.map((p) => (
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
              {pendingSave.removed.length > 0 && (
                <div>
                  <p className="mb-1.5">
                    These permissions will be{" "}
                    <strong className="text-red-300">removed</strong>
                    {userCount > 0 ? ` from ${userCount} assigned user${userCount === 1 ? "" : "s"}` : ""}
                    :
                  </p>
                  <ul className="space-y-1">
                    {pendingSave.removed.map((p) => (
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
      {pendingDelete && (
        <ConfirmModal
          title="Delete permission group"
          confirmLabel="Delete group"
          danger
          loading={deleting}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
          message={
            <div className="space-y-2">
              <p>
                Delete permission group{" "}
                <strong className="text-gray-200">
                  &quot;{pendingDelete.name}&quot;
                </strong>
                ?
              </p>
              <p>
                {pendingDelete._count?.users ? (
                  <>
                    <strong className="text-red-300">
                      {pendingDelete._count.users} user
                      {pendingDelete._count.users === 1 ? "" : "s"}
                    </strong>{" "}
                    are assigned to this group — they will be unassigned and
                    keep only their custom permissions.
                  </>
                ) : (
                  "No users are assigned to this group."
                )}
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
