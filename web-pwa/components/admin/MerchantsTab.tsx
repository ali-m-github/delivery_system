"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ConfirmModal, RoleBadge } from "@/components/admin/PermissionPicker";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MerchantAccount {
  id: string;
  username: string;
  email: string;
  role: string;
  merchant: { id: string; merchantId: number; merchantName: string } | null;
}

interface SellerOption {
  id: string;
  merchantId: number;
  merchantName: string;
  user: { id: string } | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MerchantsTab() {
  const [accounts, setAccounts] = useState<MerchantAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [sellersLoading, setSellersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingAccount, setEditingAccount] = useState<MerchantAccount | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<MerchantAccount | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  // ── Data loading ─────────────────────────────────────────────────────────────

  const fetchAccounts = async () => {
    setLoading(true);
    setFetchError("");
    try {
      const res = await fetch("/api/admin/users?role=MERCHANT");
      const data = res.ok ? await res.json() : null;
      if (res.ok) {
        setAccounts(data);
      } else {
        const body = await res.json().catch(() => null);
        setFetchError(body?.error || "Failed to load merchant accounts");
      }
    } catch {
      setFetchError("Network error while loading merchant accounts");
    } finally {
      setLoading(false);
    }
  };

  const fetchSellers = async () => {
    setSellersLoading(true);
    try {
      const res = await fetch("/api/admin/merchants");
      if (res.ok) {
        const data = await res.json();
        setSellers(
          (
            data as {
              id: string;
              merchantId: number;
              merchantName: string;
              user: { id: string } | null;
            }[]
          ).map((m) => ({
            id: m.id,
            merchantId: m.merchantId,
            merchantName: m.merchantName,
            user: m.user,
          })),
        );
      }
    } catch {
      // non-fatal: the form still works without the seller list
    } finally {
      setSellersLoading(false);
    }
  };

  const searchParams = useSearchParams();

  useEffect(() => {
    // Fetch on mount (matches the existing admin-tab pattern in this codebase).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAccounts();
    fetchSellers();
    // Deep link from /merchants ("Create account"): preselect the seller ledger
    // so the operator only types credentials.
    const prefillMerchant = searchParams.get("merchantId");
    if (prefillMerchant) setMerchantId(prefillMerchant);
    // Run once on mount; the prefill is a navigation affordance, not live state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sellers that can still receive an account: unlinked ones, plus the one
  // currently being edited (so the existing link can be kept).
  const selectableSellers = useMemo(
    () =>
      sellers.filter(
        (s) => !s.user || s.user.id === editingAccount?.id,
      ),
    [sellers, editingAccount],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const resetForm = () => {
    setUsername("");
    setEmail("");
    setPassword("");
    setMerchantId("");
    setEditingAccount(null);
    setError("");
    setSuccess("");
  };

  const startEdit = (account: MerchantAccount) => {
    setEditingAccount(account);
    setUsername(account.username);
    setEmail(account.email);
    setPassword("");
    setMerchantId("");
    setError("");
    setSuccess("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const isEdit = editingAccount !== null;
    if (!username.trim() || (!isEdit && (!email.trim() || !password))) {
      setError("Username, email and password are required.");
      return;
    }

    setSaving(true);
    try {
      const url = isEdit
        ? `/api/admin/employees/${editingAccount.id}`
        : "/api/admin/users";
      const payload: Record<string, unknown> = {
        username: username.trim(),
        role: "MERCHANT",
      };
      if (!isEdit) {
        payload.email = email.trim();
        payload.password = password;
        if (merchantId) payload.merchantId = merchantId;
      } else if (password) {
        payload.password = password;
      }

      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error || `Failed to ${isEdit ? "update" : "create"} account`);
        return;
      }
      setSuccess(
        isEdit
          ? "Merchant account updated."
          : "Merchant account created.",
      );
      resetForm();
      fetchAccounts();
      fetchSellers();
    } catch {
      setError("Network error while saving the account.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/employees/${pendingDelete.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error || "Failed to delete the account.");
      } else {
        setSuccess("Merchant account deleted.");
        fetchAccounts();
        fetchSellers();
      }
    } catch {
      setError("Network error while deleting the account.");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Create / Edit form ── */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
        <h2 className="text-lg font-semibold text-gray-200 mb-1">
          {editingAccount ? "Edit merchant account" : "Create merchant account"}
        </h2>
        <p className="text-xs text-gray-500 mb-5">
          Merchant logins are managed here. Seller ledgers (business name,
          contact, rates) live on the{" "}
          <Link href="/merchants" className="text-cyan-400 hover:underline">
            Merchants
          </Link>{" "}
          page — this form only creates the login account linked to a ledger.
        </p>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/30 text-sm text-green-300">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="m-username"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Username
              </label>
              <input
                id="m-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100
                          focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                          transition-all duration-200 text-sm"
                required
              />
            </div>
            <div>
              <label
                htmlFor="m-email"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                Email
              </label>
              <input
                id="m-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={editingAccount !== null}
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100
                          focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                          transition-all duration-200 text-sm disabled:opacity-50"
                required={!editingAccount}
              />
              {editingAccount && (
                <p className="mt-1 text-[10px] text-gray-500">
                  Email cannot be changed after the account is created.
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="m-password"
                className="block text-xs font-medium text-gray-400 mb-1.5"
              >
                {editingAccount ? "New password (optional)" : "Password"}
              </label>
              <input
                id="m-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100
                          focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                          transition-all duration-200 text-sm"
                required={!editingAccount}
              />
            </div>
            {editingAccount ? (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                  Linked seller
                </label>
                <div
                  className="w-full px-4 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-sm text-gray-400"
                >
                  {editingAccount.merchant ? (
                    <Link
                      href={`/merchants/${editingAccount.merchant.id}`}
                      className="text-cyan-300 hover:underline"
                    >
                      #{editingAccount.merchant.merchantId} —{" "}
                      {editingAccount.merchant.merchantName}
                    </Link>
                  ) : (
                    <span className="text-gray-600">Not linked</span>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-gray-500">
                  To change which seller this account belongs to, delete it and
                  create a new one linked to the right ledger.
                </p>
              </div>
            ) : (
              <div>
                <label
                  htmlFor="m-merchant"
                  className="block text-xs font-medium text-gray-400 mb-1.5"
                >
                  Link to seller ledger
                </label>
                <select
                  id="m-merchant"
                  value={merchantId}
                  onChange={(e) => setMerchantId(e.target.value)}
                  disabled={sellersLoading}
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-gray-100
                          focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                          transition-all duration-200 text-sm appearance-none cursor-pointer disabled:opacity-50"
                >
                  <option value="" className="bg-gray-900">
                    Create a new seller ledger
                  </option>
                  {selectableSellers.map((s) => (
                    <option key={s.id} value={s.id} className="bg-gray-900">
                      #{s.merchantId} — {s.merchantName}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-gray-500">
                  Choose an existing seller to give it login access without
                  creating a duplicate ledger.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-gray-950 bg-cyan-400
                         hover:bg-cyan-300 transition-all duration-200 disabled:opacity-50"
            >
              {saving
                ? "Saving..."
                : editingAccount
                  ? "Save changes"
                  : "Create account"}
            </button>
            {editingAccount && (
              <button
                type="button"
                onClick={resetForm}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-gray-300 bg-white/5 border border-white/10
                           hover:bg-white/10 hover:text-white transition-all duration-200"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {/* ── Accounts table ── */}
      <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          Merchant accounts ({accounts.length})
        </h2>

        {loading ? (
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
              onClick={() => fetchAccounts()}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 border border-white/10
                         hover:bg-white/10 hover:text-white transition-all duration-200"
            >
              Retry
            </button>
          </div>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-gray-500">
            No merchant accounts created yet. Create one above, or use{" "}
            <Link href="/merchants" className="text-cyan-400 hover:underline">
              Merchants → Create account
            </Link>
            .
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[768px] text-sm text-left">
              <thead>
                <tr className="border-b border-white/10 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-3 font-medium">Username</th>
                  <th className="py-3 px-3 font-medium">Email</th>
                  <th className="py-3 px-3 font-medium">Role</th>
                  <th className="py-3 px-3 font-medium">Linked seller</th>
                  <th className="py-3 px-3 font-medium border-l border-white/10">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {accounts.map((account) => (
                  <tr
                    key={account.id}
                    className="hover:bg-white/[0.03] transition-colors duration-150"
                  >
                    <td className="py-3 px-3 text-gray-200 whitespace-nowrap">
                      {account.username}
                    </td>
                    <td className="py-3 px-3 text-gray-400">
                      <span
                        className="block max-w-[220px] truncate"
                        title={account.email}
                      >
                        {account.email}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <RoleBadge role={account.role} />
                    </td>
                    <td className="py-3 px-3 text-gray-400 whitespace-nowrap">
                      {account.merchant ? (
                        <Link
                          href={`/merchants/${account.merchant.id}`}
                          className="text-cyan-300 hover:underline"
                        >
                          #{account.merchant.merchantId} —{" "}
                          {account.merchant.merchantName}
                        </Link>
                      ) : (
                        <span className="text-gray-600">Not linked</span>
                      )}
                    </td>
                    <td className="py-3 px-3 border-l border-white/10 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(account)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 border border-white/10
                                     hover:bg-white/10 hover:text-white transition-all duration-200"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(account)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-300 bg-red-500/10 border border-red-500/30
                                     hover:bg-red-500/20 transition-all duration-200"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pendingDelete && (
        <ConfirmModal
          title="Delete merchant account"
          message={
            <>
              Delete the login account{" "}
              <span className="font-medium text-gray-200">
                {pendingDelete.username}
              </span>
              ? The seller ledger stays on the Merchants page; only the login is
              removed.
            </>
          }
          confirmLabel="Delete account"
          danger
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
