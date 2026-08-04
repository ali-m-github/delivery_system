"use client";

import { useState, useEffect } from "react";
import { createTreasuryBox } from "@/app/actions/treasury";
import PermissionGuard from "@/components/PermissionGuard";

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-gray-200">{children}</p>
    </div>
  );
}

interface TreasuryBox {
  id: string;
  name: string;
  isPositive: boolean;
  balanceUsd: number;
  balanceLbp: number;
  transactions: TreasuryTransaction[];
  createdAt: string;
  updatedAt: string;
}

interface TreasuryTransaction {
  id: string;
  boxId: string;
  type: string;
  amountUsd: number;
  amountLbp: number;
  description: string | null;
  reference: string | null;
  referenceId: string | null;
  status?: string;
  createdAt: string;
  user: { id: string; email: string; username: string } | null;
}

export default function TreasuryAdminPage() {
  const [boxes, setBoxes] = useState<TreasuryBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // ── Pending approvals (across every cash box) ──
  const [pendingTx, setPendingTx] = useState<any[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // ── Create Form State ──
  const [newName, setNewName] = useState("");
  const [newIsPositive, setNewIsPositive] = useState(true);

  // ── Expanded Box ──
  const [expandedBoxId, setExpandedBoxId] = useState<string | null>(null);

  // ── Transaction Details Modal ──
  const [detailTx, setDetailTx] = useState<TreasuryTransaction | null>(null);
  const [detailData, setDetailData] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const fetchBoxes = async () => {
    try {
      const res = await fetch("/api/admin/treasury");
      const data = await res.json();
      if (Array.isArray(data)) {
        setBoxes(data);
      }
    } catch (error) {
      console.error("Failed to fetch treasury boxes", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPending = async () => {
    setPendingLoading(true);
    try {
      const res = await fetch(
        "/api/admin/treasury/transactions?status=PENDING_APPROVAL",
      );
      const data = await res.json();
      setPendingTx(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to fetch pending transactions", error);
      setPendingTx([]);
    } finally {
      setPendingLoading(false);
    }
  };

  // ── Approve / Reject a pending transaction ──
  const handleApprove = async (txId: string) => {
    if (
      !confirm("Approve this transaction and apply it to the cashbox balance?")
    )
      return;
    setApprovingId(txId);
    try {
      const res = await fetch(
        `/api/admin/treasury/transactions/${txId}/approve`,
        { method: "POST" },
      );
      const result = await res.json();
      if (res.ok && result.success) {
        alert(result.message || "Transaction approved.");
        await Promise.all([fetchPending(), fetchBoxes()]);
      } else {
        alert(result.error || "Failed to approve transaction.");
      }
    } catch (error) {
      console.error(error);
      alert("Network error during approval.");
    } finally {
      setApprovingId(null);
    }
  };

  const handleReject = async (txId: string) => {
    if (
      !confirm("Reject this transaction? The cashbox balance will not change.")
    )
      return;
    setApprovingId(txId);
    try {
      const res = await fetch(
        `/api/admin/treasury/transactions/${txId}/reject`,
        { method: "POST" },
      );
      const result = await res.json();
      if (res.ok && result.success) {
        alert(result.message || "Transaction rejected.");
        await Promise.all([fetchPending(), fetchBoxes()]);
      } else {
        alert(result.error || "Failed to reject transaction.");
      }
    } catch (error) {
      console.error(error);
      alert("Network error during rejection.");
    } finally {
      setApprovingId(null);
    }
  };

  useEffect(() => {
    fetchBoxes();
    fetchPending();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const formData = new FormData();
      formData.set("name", newName.trim());
      if (newIsPositive) formData.set("isPositive", "on");
      await createTreasuryBox(formData);
      setNewName("");
      setNewIsPositive(true);
      await fetchBoxes(); // Refresh list after creation
    } catch (error: any) {
      console.error(error);
      alert(error?.message || "Failed to create treasury box");
    } finally {
      setCreating(false);
    }
  };

  // Opens the "View Details" modal and fetches the full transaction detail
  // (creator user + resolved payout info) from the dedicated endpoint.
  const openTransactionDetails = async (tx: TreasuryTransaction) => {
    setDetailTx(tx);
    setDetailData(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/treasury/transactions/${tx.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load details");
      setDetailData(data);
    } catch (error: any) {
      setDetailError(error.message || "Failed to load details");
    } finally {
      setDetailLoading(false);
    }
  };

  // Calculate totals
  const totalAssetUsd = boxes
    .filter((b) => b.isPositive)
    .reduce((sum, b) => sum + b.balanceUsd, 0);
  const totalLiabilityUsd = boxes
    .filter((b) => !b.isPositive)
    .reduce((sum, b) => sum + b.balanceUsd, 0);
  const netWorth = totalAssetUsd - totalLiabilityUsd;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 p-8 text-cyan-400 font-mono">
        Loading Treasury...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 border-b border-gray-800 pb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-cyan-400">
              Treasury Management
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Manage cash boxes, track balances, and reconcile transactions.
            </p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-slate-900 border border-gray-800 rounded-xl p-5">
            <p className="text-sm text-gray-400 mb-1">Total Assets</p>
            <p className="text-2xl font-bold text-green-400 font-mono">
              ${totalAssetUsd.toFixed(2)}
            </p>
          </div>
          <div className="bg-slate-900 border border-gray-800 rounded-xl p-5">
            <p className="text-sm text-gray-400 mb-1">Total Liabilities</p>
            <p className="text-2xl font-bold text-red-400 font-mono">
              ${totalLiabilityUsd.toFixed(2)}
            </p>
          </div>
          <div className="bg-slate-900 border border-gray-800 rounded-xl p-5">
            <p className="text-sm text-gray-400 mb-1">Net Treasury</p>
            <p
              className={`text-2xl font-bold font-mono ${
                netWorth >= 0 ? "text-cyan-400" : "text-red-400"
              }`}
            >
              ${netWorth.toFixed(2)}
            </p>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* ── PENDING APPROVALS (every cash box) ─────────────────────────── */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-1 w-1 rounded-full bg-amber-400" />
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">
              Pending Approvals
            </h2>
            <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold rounded">
              ACTION REQUIRED
            </span>
          </div>

          <div className="bg-slate-900 border border-gray-800 rounded-xl overflow-hidden">
            {pendingLoading ? (
              <div className="p-8 text-center text-gray-500 font-mono">
                Loading pending approvals...
              </div>
            ) : pendingTx.length === 0 ? (
              <div className="p-8 text-center text-gray-600 font-mono">
                No transactions pending approval.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-800/60 text-gray-400 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Reference</th>
                      <th className="px-4 py-3 font-semibold">Cashbox</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Amount USD
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Amount LBP
                      </th>
                      <th className="px-4 py-3 font-semibold">Description</th>
                      <th className="px-4 py-3 font-semibold text-center">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingTx.map((tx) => (
                      <tr
                        key={tx.id}
                        className="border-t border-gray-800 hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="px-4 py-3 font-mono text-xs text-gray-400">
                          {tx.reference
                            ? `TX ${tx.reference}`
                            : tx.id.slice(0, 10)}
                        </td>
                        <td className="px-4 py-3 text-sm text-white">
                          {tx.box?.name || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded ${
                              tx.type === "IN"
                                ? "bg-green-900/40 text-green-400"
                                : "bg-red-900/40 text-red-400"
                            }`}
                          >
                            {tx.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-white">
                          ${(tx.amountUsd ?? 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-white">
                          LL {(tx.amountLbp ?? 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300">
                          {tx.description || "—"}
                          {tx.statement && (
                            <span className="block text-xs text-gray-500">
                              {tx.statement.merchant?.merchantName} · Statement
                              #{tx.statement.sequentialIndex}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleApprove(tx.id)}
                              disabled={approvingId === tx.id}
                              className="px-3 py-1.5 text-[11px] font-bold bg-emerald-600 text-white border border-emerald-500/50 rounded hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {approvingId === tx.id
                                ? "Processing..."
                                : "✓ Approve"}
                            </button>
                            <button
                              onClick={() => handleReject(tx.id)}
                              disabled={approvingId === tx.id}
                              className="px-3 py-1.5 text-[11px] font-bold bg-red-600 text-white border border-red-500/50 rounded hover:bg-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              ✕ Reject
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
        </section>

        {/* Create New Box — action-level RBAC: only users holding
            ACTION_TREASURY_TRANSACT can mutate treasury state */}
        <PermissionGuard requires="ACTION_TREASURY_TRANSACT">
          <div className="bg-slate-900 border border-gray-800 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-bold text-white mb-4">
              Create New Treasury Box
            </h2>
            <div className="flex flex-col md:flex-row gap-4">
              <input
                type="text"
                placeholder="Box Name (e.g. Main Cash Register)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-1 bg-slate-800 border border-gray-700 text-white rounded-lg px-4 py-2.5 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none font-mono"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newIsPositive}
                    onChange={(e) => setNewIsPositive(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
                  />
                  <span className="text-sm text-gray-300">
                    {newIsPositive ? "Asset (Income)" : "Liability (Expense)"}
                  </span>
                </label>
              </div>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/40 border border-cyan-500/30 px-6 py-2.5 rounded-lg font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? "Creating..." : "Create Box"}
              </button>
            </div>
          </div>
        </PermissionGuard>

        {/* Treasury Boxes List */}
        {boxes.length === 0 ? (
          <div className="bg-slate-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500 font-mono">
            No treasury boxes found. Create one above.
          </div>
        ) : (
          <div className="space-y-4">
            {boxes.map((box) => (
              <div
                key={box.id}
                className="bg-slate-900 border border-gray-800 rounded-xl overflow-hidden"
              >
                {/* Box Header */}
                <div
                  className="p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 cursor-pointer hover:bg-slate-800/50 transition-colors"
                  onClick={() =>
                    setExpandedBoxId(expandedBoxId === box.id ? null : box.id)
                  }
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-3 h-3 rounded-full ${
                        box.isPositive ? "bg-green-500" : "bg-red-500"
                      }`}
                    />
                    <div>
                      <h3 className="text-lg font-bold text-white">
                        {box.name}
                      </h3>
                      <span
                        className={`text-xs font-mono ${
                          box.isPositive ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {box.isPositive
                          ? "Asset / Income"
                          : "Liability / Expense"}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-6 text-right">
                    <div>
                      <p className="text-xs text-gray-500">USD Balance</p>
                      <p className="text-lg font-bold text-green-400 font-mono">
                        ${box.balanceUsd.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">LBP Balance</p>
                      <p className="text-lg font-bold text-yellow-400 font-mono">
                        LL {box.balanceLbp.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Expanded: Recent Transactions */}
                {expandedBoxId === box.id && (
                  <div className="border-t border-gray-800 p-5 bg-slate-950/50">
                    <h4 className="text-sm font-bold text-gray-400 mb-3">
                      Recent Transactions
                    </h4>
                    {box.transactions.length === 0 ? (
                      <p className="text-sm text-gray-600 font-mono">
                        No transactions yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {box.transactions.map((tx) => (
                          <div
                            key={tx.id}
                            className="bg-slate-900 rounded-lg border border-gray-800 overflow-hidden"
                          >
                            <div className="flex justify-between items-start gap-3 p-3">
                              <div className="min-w-0">
                                <div className="flex items-center flex-wrap gap-2">
                                  <span
                                    className={`text-xs font-bold px-2 py-0.5 rounded ${
                                      tx.type === "IN"
                                        ? "bg-green-900/40 text-green-400"
                                        : "bg-red-900/40 text-red-400"
                                    }`}
                                  >
                                    {tx.type}
                                  </span>
                                  {tx.status && tx.status !== "APPROVED" && (
                                    <span
                                      className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                        tx.status === "PENDING_APPROVAL"
                                          ? "bg-amber-900/40 text-amber-400 border-amber-500/30"
                                          : "bg-red-900/40 text-red-400 border-red-500/30"
                                      }`}
                                    >
                                      {tx.status}
                                    </span>
                                  )}
                                  <span className="text-xs font-mono text-gray-500">
                                    {tx.reference
                                      ? `TX ${tx.reference}`
                                      : `TX ${tx.id.slice(0, 10)}`}
                                  </span>
                                  {tx.referenceId && (
                                    <span className="text-xs text-gray-600 font-mono">
                                      ref: {tx.referenceId.slice(0, 8)}...
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-gray-300 mt-1">
                                  {tx.description || "—"}
                                </p>
                                <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500">
                                  <span>
                                    By:{" "}
                                    {tx.user?.username || tx.user?.email || "—"}
                                  </span>
                                  <span>
                                    {new Date(tx.createdAt).toLocaleString()}
                                  </span>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-sm font-mono text-white">
                                  ${tx.amountUsd.toFixed(2)}
                                </p>
                                <p className="text-xs text-gray-500">
                                  LL {tx.amountLbp.toLocaleString()}
                                </p>
                                <button
                                  onClick={() => openTransactionDetails(tx)}
                                  className="mt-1 text-xs bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/40 border border-cyan-500/30 px-2 py-1 rounded transition-colors"
                                >
                                  View Details
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {/* ── Transaction Details Modal ── */}
        {detailTx && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setDetailTx(null)}
          >
            <div
              className="bg-slate-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-white">
                    Transaction Details
                  </h3>
                  <p className="text-xs font-mono text-gray-500 mt-1">
                    TX {detailTx.id} ·{" "}
                    {detailData?.transaction?.box?.name || "—"}
                  </p>
                </div>
                <button
                  onClick={() => setDetailTx(null)}
                  className="text-gray-400 hover:text-white text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              {detailLoading ? (
                <p className="text-gray-400 font-mono">Loading details...</p>
              ) : detailError ? (
                <p className="text-red-400 font-mono">{detailError}</p>
              ) : detailData ? (
                <>
                  {/* ── Transaction meta ── */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <DetailField label="Type">
                      <span
                        className={`font-bold ${
                          detailData.transaction.type === "IN"
                            ? "text-green-400"
                            : "text-red-400"
                        }`}
                      >
                        {detailData.transaction.type}
                      </span>
                    </DetailField>
                    <DetailField label="Created By">
                      {detailData.transaction.user?.email ||
                        detailData.transaction.user?.username ||
                        "—"}
                    </DetailField>
                    <DetailField label="Date">
                      {new Date(
                        detailData.transaction.createdAt,
                      ).toLocaleString()}
                    </DetailField>
                    <DetailField label="Amount (USD)">
                      <span className="font-mono text-white">
                        ${detailData.transaction.amountUsd.toFixed(2)}
                      </span>
                    </DetailField>
                    <DetailField label="Amount (LBP)">
                      <span className="font-mono text-white">
                        LL {detailData.transaction.amountLbp.toLocaleString()}
                      </span>
                    </DetailField>
                    <DetailField label="Description">
                      {detailData.transaction.description || "—"}
                    </DetailField>
                  </div>

                  {/* ── Payout details ── */}
                  {detailData.payout ? (
                    <div className="mt-5 border-t border-gray-800 pt-4">
                      <h4 className="text-sm font-bold text-cyan-400 mb-3">
                        Payout Details
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                        <DetailField label="Payout Ref">
                          {detailData.payout.payoutReference ||
                            `#${detailData.payout.sequentialIndex}`}
                        </DetailField>
                        <DetailField label="Status">
                          <span className="font-mono">
                            {detailData.payout.status}
                          </span>
                        </DetailField>
                        <DetailField label="Driver">
                          {`${detailData.payout.driver?.firstName || ""} ${
                            detailData.payout.driver?.lastName || ""
                          }`.trim() || "—"}
                        </DetailField>
                        <DetailField label="Driver Email">
                          {detailData.payout.driver?.user?.email || "—"}
                        </DetailField>
                        <DetailField label="Total">
                          <span className="font-mono text-white">
                            ${detailData.payout.totalUsd.toFixed(2)}
                          </span>
                        </DetailField>
                        <DetailField label="Net">
                          <span className="font-mono text-white">
                            ${detailData.payout.netUsd.toFixed(2)}
                          </span>
                        </DetailField>
                        <DetailField label="Commission">
                          <span className="font-mono">
                            ${detailData.payout.commissionUsd.toFixed(2)}
                          </span>
                        </DetailField>
                        <DetailField label="Collected">
                          <span className="font-mono">
                            ${detailData.payout.totalCollected.toFixed(2)}
                          </span>
                        </DetailField>
                        <DetailField label="Amount Paid (USD)">
                          <span className="font-mono text-green-400">
                            ${detailData.payout.amountPaidUsd.toFixed(2)}
                          </span>
                        </DetailField>
                        <DetailField label="Remaining">
                          <span className="font-mono">
                            {detailData.payout.remainingUsd.toFixed(2)} USD /{" "}
                            {detailData.payout.remainingLbp.toFixed(2)} LBP
                          </span>
                        </DetailField>
                      </div>

                      {detailData.payout.orders?.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-xs font-bold text-gray-400 mb-2">
                            Orders in Payout ({detailData.payout.orders.length})
                          </h5>
                          <div className="border border-gray-800 rounded-lg overflow-hidden">
                            <table className="w-full text-xs">
                              <thead className="bg-slate-800/60 text-gray-400">
                                <tr>
                                  <th className="text-left px-3 py-2">Order</th>
                                  <th className="text-left px-3 py-2">
                                    Customer
                                  </th>
                                  <th className="text-right px-3 py-2">USD</th>
                                  <th className="text-right px-3 py-2">LBP</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detailData.payout.orders.map((o: any) => (
                                  <tr
                                    key={o.id}
                                    className="border-t border-gray-800"
                                  >
                                    <td className="px-3 py-2 font-mono">
                                      {o.orderId}
                                    </td>
                                    <td className="px-3 py-2">
                                      {o.customerName || "—"}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono">
                                      ${o.amountUsd.toFixed(2)}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono">
                                      LL {o.amountLbp.toLocaleString()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="mt-5 border-t border-gray-800 pt-4 text-sm text-gray-500">
                      No payout reference on this transaction.
                    </p>
                  )}
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
