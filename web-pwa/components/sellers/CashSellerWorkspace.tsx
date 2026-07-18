"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UnpaidOrder {
  id: string;
  orderId: string;
  amountUsd: number;
  collectedUsd: number;
  zoneId: string;
  driverId?: string | null;
  sellerRate?: number; // effective rate resolved by the API
  createdAt: string;
}

interface PendingReturn {
  id: string;
  orderId: string;
  amountUsd: number;
  driverId?: string | null;
  financialStatus?: string;
  sellerRate?: number; // effective rate resolved by the API
  createdAt: string;
}

interface BatchOrder {
  id: string;
  orderId: string;
  amountUsd: number;
  collectedUsd?: number;
  location?: string;
  createdAt: string;
}

interface CashPayoutBatch {
  id: number;
  batchReference: string;
  grossAdvance: number;
  deductedReturns: number;
  netPaid: number;
  companyProfit: number;
  createdAt: string;
  orders: BatchOrder[];
  resolvedReturns: BatchOrder[];
}

interface Adjustment {
  id: string;
  description: string;
  amountUsd: number;
  amountInput: string; // raw string so user can type "-" freely
}

interface CashSellerWorkspaceProps {
  merchantId: string;
  defaultSellerRate: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function computeAdvance(amountUsd: number, sellerRate: number): number {
  return (amountUsd ?? 0) - sellerRate;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CashSellerWorkspace({
  merchantId,
  defaultSellerRate,
}: CashSellerWorkspaceProps) {
  // ── Data State ──
  const [unpaidOrders, setUnpaidOrders] = useState<UnpaidOrder[]>([]);
  const [pendingReturns, setPendingReturns] = useState<PendingReturn[]>([]);
  const [batches, setBatches] = useState<CashPayoutBatch[]>([]);

  // ── Selection State ──
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedReturnIds, setSelectedReturnIds] = useState<Set<string>>(
    new Set(),
  );

  // ── UI State ──
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // ── Expanded batch state for ledger detail rows ──
  const [expandedBatchId, setExpandedBatchId] = useState<number | null>(null);

  // ── Manual Adjustments State ──
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);

  // ── Date Range Filter State ──
  const [filterFromDate, setFilterFromDate] = useState<string>("");
  const [filterToDate, setFilterToDate] = useState<string>("");

  // ── Fetch workspace data ──
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterFromDate) params.set("from", filterFromDate);
      if (filterToDate) params.set("to", filterToDate);
      const res = await fetch(
        `/api/admin/merchants/${merchantId}/cash-payouts?${params.toString()}`,
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setUnpaidOrders(data.unpaidOrders || []);
      setPendingReturns(data.pendingReturns || []);
      setBatches(data.batches || []);
    } catch (e: any) {
      setError(e.message || "Failed to load workspace data");
    } finally {
      setIsLoading(false);
    }
  }, [merchantId, filterFromDate, filterToDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Exclude Order Handler ──
  const excludeOrder = async (orderId: string, dbId: string) => {
    try {
      const res = await fetch(
        `/api/admin/merchants/${merchantId}/cash-payouts/exclude`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, excluded: true }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to exclude order");
      }
      // Remove from local state
      setUnpaidOrders((prev) => prev.filter((o) => o.id !== dbId));
      setSelectedOrderIds((prev) => {
        const next = new Set(prev);
        next.delete(dbId);
        return next;
      });
    } catch (e: any) {
      setError(e.message || "Failed to exclude order");
    }
  };

  // ── Adjustment Helpers ──
  const genId = (): string =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const addAdjustment = () =>
    setAdjustments((prev) => [
      ...prev,
      { id: genId(), description: "", amountUsd: 0, amountInput: "" },
    ]);

  const removeAdjustment = (id: string) =>
    setAdjustments((prev) => prev.filter((a) => a.id !== id));

  const updateAdjustment = (
    id: string,
    field: keyof Adjustment,
    value: string | number,
  ) =>
    setAdjustments((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        if (field === "amountInput") {
          const strVal = String(value);
          return {
            ...a,
            amountInput: strVal,
            amountUsd: parseFloat(strVal) || 0,
          };
        }
        return { ...a, [field]: value };
      }),
    );

  // ── Derived Financials ──
  const selectedAdvance = Array.from(selectedOrderIds).reduce((sum, id) => {
    const order = unpaidOrders.find((o) => o.id === id);
    const rate = order?.sellerRate ?? defaultSellerRate;
    return sum + (order ? computeAdvance(order.amountUsd, rate) : 0);
  }, 0);

  const returnDeductions = Array.from(selectedReturnIds).reduce((sum, id) => {
    const ret = pendingReturns.find((r) => r.id === id);
    const rate = ret?.sellerRate ?? defaultSellerRate;
    return sum + (ret ? computeAdvance(ret.amountUsd, rate) : 0);
  }, 0);

  const adjustmentsTotal = adjustments.reduce(
    (sum, adj) => sum + (adj.amountUsd ?? 0),
    0,
  );

  const netCashPayable = selectedAdvance - returnDeductions + adjustmentsTotal;

  // ── Select All Toggles ──
  const allOrdersSelected =
    unpaidOrders.length > 0 && selectedOrderIds.size === unpaidOrders.length;

  const allReturnsSelected =
    pendingReturns.length > 0 &&
    selectedReturnIds.size === pendingReturns.length;

  const toggleSelectAllOrders = () => {
    if (allOrdersSelected) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(unpaidOrders.map((o) => o.id)));
    }
  };

  const toggleSelectAllReturns = () => {
    if (allReturnsSelected) {
      setSelectedReturnIds(new Set());
    } else {
      setSelectedReturnIds(new Set(pendingReturns.map((r) => r.id)));
    }
  };

  const toggleOrder = (id: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleReturn = (id: string) => {
    setSelectedReturnIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Submission Handler ──
  const handleSubmit = async () => {
    if (selectedOrderIds.size === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const validAdjustments = adjustments
        .filter((a) => a.description.trim() !== "")
        .map((a) => ({
          description: a.description,
          amountUsd: a.amountUsd,
        }));

      const res = await fetch(
        `/api/admin/merchants/${merchantId}/cash-payouts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderIds: Array.from(selectedOrderIds),
            returnIds: Array.from(selectedReturnIds),
            adjustments: validAdjustments,
          }),
        },
      );

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          errBody.error || errBody.details || `HTTP ${res.status}`,
        );
      }

      const batch = await res.json();
      setSuccessMessage(
        `Payout batch ${batch.batchReference} generated successfully! Net: $${batch.netPaid.toFixed(2)}`,
      );
      setSelectedOrderIds(new Set());
      setSelectedReturnIds(new Set());
      setAdjustments([]);
      await fetchData();
    } catch (e: any) {
      setError(e.message || "Failed to generate payout batch");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Loading State ──
  if (isLoading) {
    return (
      <div className="mt-6 bg-[#121824] border border-white/5 rounded-xl p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-400 mx-auto mb-3" />
        <p className="text-gray-400 text-sm">Loading cash seller workspace…</p>
      </div>
    );
  }

  // ── Render ──
  return (
    <div className="mt-6 space-y-6">
      {/* ── Error / Success Banners ── */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
          <span className="text-red-400 text-lg leading-none mt-0.5">⚠</span>
          <div>
            <p className="text-red-400 font-semibold text-sm">Error</p>
            <p className="text-red-300 text-xs mt-0.5">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300 text-sm"
          >
            ✕
          </button>
        </div>
      )}

      {successMessage && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 flex items-start gap-3">
          <span className="text-green-400 text-lg leading-none mt-0.5">✓</span>
          <div>
            <p className="text-green-400 font-semibold text-sm">Success</p>
            <p className="text-green-300 text-xs mt-0.5">{successMessage}</p>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="ml-auto text-green-400 hover:text-green-300 text-sm"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Step 2: Live Financial Summary Header ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Selected Advance */}
        <div className="bg-[#121824] border border-white/5 rounded-xl p-4">
          <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-1">
            Selected Advance
          </p>
          <p className="text-cyan-400 font-mono text-xl font-bold">
            ${selectedAdvance.toFixed(2)}
          </p>
          <p className="text-gray-600 text-[10px] mt-1">
            {selectedOrderIds.size} order
            {selectedOrderIds.size !== 1 ? "s" : ""} selected
          </p>
        </div>

        {/* Return Deductions */}
        <div className="bg-[#121824] border border-white/5 rounded-xl p-4">
          <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-1">
            Return Deductions
          </p>
          <p className="text-orange-400 font-mono text-xl font-bold">
            −${returnDeductions.toFixed(2)}
          </p>
          <p className="text-gray-600 text-[10px] mt-1">
            {selectedReturnIds.size} return
            {selectedReturnIds.size !== 1 ? "s" : ""} selected
          </p>
        </div>

        {/* Net Cash Payable */}
        <div
          className={`rounded-xl p-4 border ${
            netCashPayable >= 0
              ? "bg-green-500/5 border-green-500/20"
              : "bg-red-500/5 border-red-500/20"
          }`}
        >
          <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-1">
            Net Cash Payable
          </p>
          <p
            className={`font-mono text-xl font-bold ${
              netCashPayable >= 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {netCashPayable >= 0 ? "" : "−"}$
            {Math.abs(netCashPayable).toFixed(2)}
          </p>
          <p className="text-gray-600 text-[10px] mt-1">
            Advance − Deductions
            {adjustmentsTotal !== 0
              ? ` ${adjustmentsTotal >= 0 ? "+" : "−"} $${Math.abs(adjustmentsTotal).toFixed(2)} adj.`
              : ""}
          </p>
        </div>

        {/* Action Button */}
        <div className="bg-[#121824] border border-white/5 rounded-xl p-4 flex flex-col justify-center">
          <button
            onClick={handleSubmit}
            disabled={selectedOrderIds.size === 0 || isSubmitting}
            className="w-full bg-cyan-500 hover:bg-cyan-400 text-[#0B0F17] font-bold py-2.5 px-4 rounded-lg transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none text-sm"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-[#0B0F17]" />
                Processing…
              </span>
            ) : (
              "Generate & Save Payout Batch"
            )}
          </button>
          {selectedOrderIds.size === 0 && (
            <p className="text-gray-600 text-[10px] text-center mt-2">
              Select at least one order to enable
            </p>
          )}
        </div>
      </div>

      {/* ── Step 3: Two-Column Workspace ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Column 1: Eligible Orders */}
        <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-semibold text-sm">
                Eligible Orders for Advance
              </h3>
              <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded">
                {unpaidOrders.length} orders
              </span>
            </div>
            {/* Date Range Filter */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wider font-bold">
                From
                <input
                  type="date"
                  value={filterFromDate}
                  onChange={(e) => setFilterFromDate(e.target.value)}
                  className="bg-[#0B0F17] border border-gray-800 rounded px-2 py-1 text-white text-xs outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-colors"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wider font-bold">
                To
                <input
                  type="date"
                  value={filterToDate}
                  onChange={(e) => setFilterToDate(e.target.value)}
                  className="bg-[#0B0F17] border border-gray-800 rounded px-2 py-1 text-white text-xs outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-colors"
                />
              </label>
              {(filterFromDate || filterToDate) && (
                <button
                  onClick={() => {
                    setFilterFromDate("");
                    setFilterToDate("");
                  }}
                  className="px-2 py-1 text-[10px] font-bold text-gray-400 bg-white/5 border border-white/10 rounded hover:bg-white/10 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-white/5 text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left w-10">
                    <input
                      type="checkbox"
                      checked={allOrdersSelected}
                      onChange={toggleSelectAllOrders}
                      className="rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500/50 cursor-pointer"
                    />
                  </th>
                  <th className="px-2 py-2 text-left font-medium">Order ID</th>
                  <th className="px-2 py-2 text-right font-medium">
                    COD Amount
                  </th>
                  <th className="px-4 py-2 text-right font-medium">Advance</th>
                  <th className="px-4 py-2 text-center font-medium w-20">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {unpaidOrders.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-gray-600"
                    >
                      No eligible orders found
                    </td>
                  </tr>
                ) : (
                  unpaidOrders.map((order) => {
                    const advance = computeAdvance(
                      order.amountUsd,
                      defaultSellerRate,
                    );
                    return (
                      <tr
                        key={order.id}
                        className={`hover:bg-white/[0.02] transition-colors ${
                          selectedOrderIds.has(order.id) ? "bg-cyan-500/5" : ""
                        }`}
                      >
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selectedOrderIds.has(order.id)}
                            onChange={() => toggleOrder(order.id)}
                            className="rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500/50 cursor-pointer"
                          />
                        </td>
                        <td className="px-2 py-2 font-mono text-gray-300">
                          {order.orderId}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-400">
                          ${order.amountUsd.toFixed(2)}
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-mono ${
                            advance < 0 ? "text-red-400" : "text-green-400"
                          }`}
                        >
                          {advance < 0 ? "−" : ""}$
                          {Math.abs(advance).toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <button
                            onClick={() =>
                              excludeOrder(order.orderId, order.id)
                            }
                            className="px-2 py-1 text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors"
                            title="Remove from payout eligibility"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Column 2: Unresolved Returns */}
        <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold text-sm">
                Unresolved Returns to Deduct
              </h3>
              <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded">
                {pendingReturns.length} returns
              </span>
            </div>
            <p className="text-gray-600 text-[10px] mt-1 leading-tight">
              Checking these will subtract their original advance from today's
              payout.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-white/5 text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left w-10">
                    <input
                      type="checkbox"
                      checked={allReturnsSelected}
                      onChange={toggleSelectAllReturns}
                      className="rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500/50 cursor-pointer"
                    />
                  </th>
                  <th className="px-2 py-2 text-left font-medium">Order ID</th>
                  <th className="px-2 py-2 text-center font-medium">
                    Fin Status
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    COD Amount
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    Deduction
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {pendingReturns.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-gray-600"
                    >
                      No unresolved returns
                    </td>
                  </tr>
                ) : (
                  pendingReturns.map((ret) => {
                    const deduction = computeAdvance(
                      ret.amountUsd,
                      defaultSellerRate,
                    );
                    return (
                      <tr
                        key={ret.id}
                        className={`hover:bg-white/[0.02] transition-colors ${
                          selectedReturnIds.has(ret.id) ? "bg-orange-500/5" : ""
                        }`}
                      >
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selectedReturnIds.has(ret.id)}
                            onChange={() => toggleReturn(ret.id)}
                            className="rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500/50 cursor-pointer"
                          />
                        </td>
                        <td className="px-2 py-2 font-mono text-gray-300">
                          {ret.orderId}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full border text-red-400 bg-red-500/10 border-red-500/30">
                            {ret.financialStatus ?? "Re"}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-400">
                          ${ret.amountUsd.toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-orange-400">
                          −${deduction.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Manual Adjustments (Side Payments / Deductions) ── */}
      <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div>
            <h3 className="text-white font-semibold text-sm">
              Manual Adjustments (Side Payments / Deductions)
            </h3>
            <p className="text-gray-600 text-[10px] mt-0.5 leading-tight">
              Add credits (positive) or deductions (negative) that affect the
              net cash payable.
            </p>
          </div>
          <button
            onClick={addAdjustment}
            className="px-3 py-1.5 text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-lg hover:bg-cyan-500/20 transition-colors"
          >
            + Add Row
          </button>
        </div>

        {adjustments.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-600 text-xs">
            No manual adjustments added. Click "+ Add Row" to add side payments
            or deductions.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-white/5 text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">
                    Description
                  </th>
                  <th className="px-2 py-2 text-right font-medium w-40">
                    Amount ($)
                  </th>
                  <th className="px-4 py-2 text-center font-medium w-20">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {adjustments.map((adj) => (
                  <tr
                    key={adj.id}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        placeholder="e.g. Extra fuel reimbursement"
                        value={adj.description}
                        onChange={(e) =>
                          updateAdjustment(
                            adj.id,
                            "description",
                            e.target.value,
                          )
                        }
                        className="w-full bg-[#0B0F17] border border-gray-800 rounded p-2 text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors text-xs"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        value={adj.amountInput}
                        onChange={(e) => {
                          const val = e.target.value;
                          // Allow numbers, decimals, and a leading minus sign
                          if (/^-?\d*\.?\d*$/.test(val)) {
                            updateAdjustment(adj.id, "amountInput", val);
                          }
                        }}
                        placeholder="e.g. -20"
                        className={`w-full bg-[#0B0F17] border rounded p-2 text-right focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors text-xs font-mono ${
                          adj.amountUsd >= 0
                            ? "border-green-800 text-green-400 focus:border-green-500"
                            : "border-red-800 text-red-400 focus:border-red-500"
                        }`}
                      />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <button
                        onClick={() => removeAdjustment(adj.id)}
                        className="px-2 py-1 text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="bg-white/[0.02]">
                  <td className="px-4 py-2 text-gray-400 font-semibold text-right">
                    Adjustments Total:
                  </td>
                  <td
                    className={`px-2 py-2 text-right font-mono font-bold text-sm ${
                      adjustmentsTotal >= 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {adjustmentsTotal >= 0 ? "" : "−"}$
                    {Math.abs(adjustmentsTotal).toFixed(2)}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Step 5: Historical Payout Ledger ── */}
      <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <h3 className="text-white font-semibold text-sm">
            Historical Cash Payout Batches
          </h3>
          <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded">
            {batches.length} batches
          </span>
        </div>

        {batches.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-600 text-sm">
            No payout batches have been generated yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-white/5 text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left w-8" />
                  <th className="px-2 py-2 text-left font-medium">Batch Ref</th>
                  <th className="px-2 py-2 text-left font-medium">Date</th>
                  <th className="px-2 py-2 text-right font-medium">
                    Gross Advance
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    Deducted Returns
                  </th>
                  <th className="px-2 py-2 text-right font-medium">Net Paid</th>
                  <th className="px-4 py-2 text-right font-medium">
                    Company Profit
                  </th>
                  <th className="px-4 py-2 text-center font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {batches.map((batch) => {
                  const isExpanded = expandedBatchId === batch.id;
                  return (
                    <>
                      <tr
                        key={batch.id}
                        onClick={() =>
                          setExpandedBatchId(isExpanded ? null : batch.id)
                        }
                        className="hover:bg-white/[0.02] transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-2">
                          <span
                            className={`text-gray-500 text-xs transition-transform inline-block ${
                              isExpanded ? "rotate-90" : ""
                            }`}
                          >
                            ▶
                          </span>
                        </td>
                        <td className="px-2 py-2 font-mono text-cyan-400">
                          {batch.batchReference}
                        </td>
                        <td className="px-2 py-2 text-gray-400">
                          {formatDateTime(batch.createdAt)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-green-400">
                          ${batch.grossAdvance.toFixed(2)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-orange-400">
                          −${batch.deductedReturns.toFixed(2)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-white font-bold">
                          ${batch.netPaid.toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-yellow-400">
                          ${batch.companyProfit.toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              window.location.href = `/sellers/${merchantId}/payouts/${batch.id}`;
                            }}
                            className="px-3 py-1 text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded hover:bg-cyan-500/20 transition-colors"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                      {/* Expandable detail row */}
                      {isExpanded && (
                        <tr key={`${batch.id}-detail`}>
                          <td colSpan={8} className="px-4 py-3 bg-[#0B0F17]/50">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Advance Orders */}
                              <div>
                                <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-2">
                                  Advance Orders ({batch.orders.length})
                                </p>
                                {batch.orders.length === 0 ? (
                                  <p className="text-gray-600 text-xs">None</p>
                                ) : (
                                  <div className="space-y-1">
                                    {batch.orders.map((o) => (
                                      <div
                                        key={o.id}
                                        className="flex justify-between text-xs bg-white/[0.02] rounded px-2 py-1"
                                      >
                                        <span className="font-mono text-gray-300">
                                          {o.orderId}
                                        </span>
                                        <span className="font-mono text-green-400">
                                          ${o.amountUsd.toFixed(2)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {/* Deducted Returns */}
                              <div>
                                <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-2">
                                  Deducted Returns (
                                  {batch.resolvedReturns.length})
                                </p>
                                {batch.resolvedReturns.length === 0 ? (
                                  <p className="text-gray-600 text-xs">None</p>
                                ) : (
                                  <div className="space-y-1">
                                    {batch.resolvedReturns.map((r) => (
                                      <div
                                        key={r.id}
                                        className="flex justify-between text-xs bg-white/[0.02] rounded px-2 py-1"
                                      >
                                        <span className="font-mono text-gray-300">
                                          {r.orderId}
                                        </span>
                                        <span className="font-mono text-orange-400">
                                          −${r.amountUsd.toFixed(2)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
