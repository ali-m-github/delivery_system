"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";

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
  // null for "-Exchange" proof orders: the item simply went back to the
  // merchant, so it carries no price and deducts $0.
  amountUsd: number | null;
  driverId?: string | null;
  financialStatus?: string;
  sellerRate?: number; // effective rate resolved by the API
  createdAt: string;
}

interface ReturnBatchOrderItem {
  id: string;
  orderId: string;
  amountUsd: number | null;
  financialStatus?: string;
  createdAt: string;
}

interface ReturnBatchRecord {
  id: string;
  batchNumber: string;
  status: string;
  totalOrders: number;
  createdAt: string;
  orders: ReturnBatchOrderItem[];
  // Server-computed total deduction for the whole batch (same formula the POST
  // applies: amountUsd - fee per order, $0 for "-Exchange" proof orders).
  totalDeduction: number;
  sellerRate?: number;
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
  profit: number;
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

// Build a windowed list of page numbers (0-based) with ellipsis markers.
function getPageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const pages: (number | "…")[] = [0];
  const start = Math.max(1, current - 1);
  const end = Math.min(total - 2, current + 1);
  if (start > 1) pages.push("…");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 2) pages.push("…");
  pages.push(total - 1);
  return pages;
}

function computeAdvance(amountUsd: number, sellerRate: number): number {
  return (amountUsd ?? 0) - sellerRate;
}

// Order-ID search for the "Eligible Orders for Advance" table: the raw input is
// split on commas/whitespace/newlines into tokens. An order matches when ANY
// token matches (OR logic) — substring match on the order ID, plus suffix match
// for pure-numeric tokens of 4+ digits, so typing the last digits of an order
// ID works exactly like the search on /orders.
function parseSearchTokens(term: string): string[] {
  return term
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t !== "");
}

function orderMatchesSearchTokens(orderId: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const id = (orderId ?? "").toLowerCase();
  return tokens.some(
    (token) =>
      id.includes(token) || (/^\d{4,}$/.test(token) && id.endsWith(token)),
  );
}

function filterOrdersBySearchTokens<T extends { orderId: string }>(
  list: T[],
  tokens: string[],
): T[] {
  if (tokens.length === 0) return list;
  return list.filter((o) => orderMatchesSearchTokens(o.orderId, tokens));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CashSellerWorkspace({
  merchantId,
  defaultSellerRate,
}: CashSellerWorkspaceProps) {
  // ── Data State ──
  const [unpaidOrders, setUnpaidOrders] = useState<UnpaidOrder[]>([]);
  const [pendingReturns, setPendingReturns] = useState<PendingReturn[]>([]);
  const [pendingReturnBatches, setPendingReturnBatches] = useState<
    ReturnBatchRecord[]
  >([]);
  const [batches, setBatches] = useState<CashPayoutBatch[]>([]);

  // ── Selection State ──
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedReturnIds, setSelectedReturnIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedReturnBatchIds, setSelectedReturnBatchIds] = useState<
    Set<string>
  >(new Set());

  // ── Expanded return-batch card state ──
  const [expandedReturnBatchId, setExpandedReturnBatchId] = useState<
    string | null
  >(null);

  // ── UI State ──
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // ── Expanded batch state for ledger detail rows ──
  const [expandedBatchId, setExpandedBatchId] = useState<number | null>(null);

  // ── Historical batch pagination state (5 per page by default) ──
  const [batchPage, setBatchPage] = useState(0);
  const [batchPageSize, setBatchPageSize] = useState(5);

  // ── Manual Adjustments State ──
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);

  // ── Date Range Filter State ──
  const [filterFromDate, setFilterFromDate] = useState<string>("");
  const [filterToDate, setFilterToDate] = useState<string>("");

  // ── Order ID Search State (client-side filter for the eligible table) ──
  // Purely a display filter: selections and the payout payload intentionally
  // survive search changes, so morning + night order batches entered on the
  // same date can be searched separately and still paid in one batch.
  const [orderSearch, setOrderSearch] = useState<string>("");

  const searchTokens = useMemo(
    () => parseSearchTokens(orderSearch),
    [orderSearch],
  );

  const visibleUnpaidOrders = useMemo(
    () => filterOrdersBySearchTokens(unpaidOrders, searchTokens),
    [unpaidOrders, searchTokens],
  );

  // ── Fetch workspace data ──
  const applyDateFilter = useCallback(
    async (from: string, to: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (from) params.set("from", from);
        if (to) params.set("to", to);
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
        setPendingReturnBatches(data.pendingReturnBatches || []);
        setBatches(data.batches || []);
      } catch (e: any) {
        setError(e.message || "Failed to load workspace data");
      } finally {
        setIsLoading(false);
      }
    },
    [merchantId],
  );

  // Initial load only
  useEffect(() => {
    applyDateFilter("", "");
  }, [applyDateFilter]);

  // ── Historical batch pagination (5 per page by default) ──
  const totalBatchPages = Math.max(
    1,
    Math.ceil(batches.length / batchPageSize),
  );
  const safeBatchPage = Math.min(batchPage, totalBatchPages - 1);
  const visibleBatches = batches.slice(
    safeBatchPage * batchPageSize,
    safeBatchPage * batchPageSize + batchPageSize,
  );

  // Reset to first page whenever the batch list or page size changes
  useEffect(() => {
    setBatchPage(0);
  }, [batches.length, batchPageSize]);

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
    if (!ret) return sum;
    // "-Exchange" proof orders (item returned to the merchant) deduct exactly
    // $0 — the seller fee was already charged on the main order, so neither a
    // COD amount nor a fee is deducted here.
    if (ret.orderId.endsWith("-Exchange") || ret.amountUsd == null) return sum;
    const rate = ret.sellerRate ?? defaultSellerRate;
    return sum + computeAdvance(ret.amountUsd, rate);
  }, 0);

  // Batched returns: the server already computed each batch's total deduction
  // with the exact POST formula, so the summary can never diverge from what
  // actually gets settled.
  const batchDeductions = Array.from(selectedReturnBatchIds).reduce(
    (sum, id) => {
      const batch = pendingReturnBatches.find((b) => b.id === id);
      return sum + (batch ? batch.totalDeduction : 0);
    },
    0,
  );

  const totalReturnDeductions = returnDeductions + batchDeductions;
  const selectedReturnCount =
    selectedReturnIds.size +
    Array.from(selectedReturnBatchIds).reduce((sum, id) => {
      const batch = pendingReturnBatches.find((b) => b.id === id);
      return sum + (batch ? batch.orders.length : 0);
    }, 0);

  const adjustmentsTotal = adjustments.reduce(
    (sum, adj) => sum + (adj.amountUsd ?? 0),
    0,
  );

  const netCashPayable =
    selectedAdvance - totalReturnDeductions + adjustmentsTotal;

  // ── Select All Toggles ──
  // "Select all" acts on the rows currently visible after the order-ID search,
  // so it always selects exactly what the operator can see. The summary math and
  // the POST payload keep resolving ids against the full unpaidOrders list, so
  // selections made under different searches are all paid in one batch.
  const allOrdersSelected =
    visibleUnpaidOrders.length > 0 &&
    visibleUnpaidOrders.every((o) => selectedOrderIds.has(o.id));

  const allReturnsSelected =
    pendingReturns.length > 0 &&
    selectedReturnIds.size === pendingReturns.length;

  const allReturnBatchesSelected =
    pendingReturnBatches.length > 0 &&
    selectedReturnBatchIds.size === pendingReturnBatches.length;

  const toggleSelectAllOrders = () => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (allOrdersSelected) {
        // Unchecking removes only the currently visible rows; selections made
        // under a previous search stay in the batch untouched.
        for (const o of visibleUnpaidOrders) next.delete(o.id);
      } else {
        for (const o of visibleUnpaidOrders) next.add(o.id);
      }
      return next;
    });
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

  const toggleSelectAllReturnBatches = () => {
    if (allReturnBatchesSelected) {
      setSelectedReturnBatchIds(new Set());
    } else {
      setSelectedReturnBatchIds(new Set(pendingReturnBatches.map((b) => b.id)));
    }
  };

  const toggleReturnBatch = (id: string) => {
    setSelectedReturnBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Submission Handler ──
  const handleSubmit = async () => {
    // Allow a batch with only returned orders selected (net will be negative).
    if (
      (selectedOrderIds.size === 0 &&
        selectedReturnIds.size === 0 &&
        selectedReturnBatchIds.size === 0) ||
      isSubmitting
    ) {
      return;
    }

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
            returnBatchIds: Array.from(selectedReturnBatchIds),
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
        `Payout batch ${batch.batchReference} generated successfully! Net: ${
          batch.netPaid >= 0 ? "" : "−"
        }$${Math.abs(batch.netPaid).toFixed(2)}`,
      );
      setSelectedOrderIds(new Set());
      setSelectedReturnIds(new Set());
      setSelectedReturnBatchIds(new Set());
      setAdjustments([]);
      await applyDateFilter(filterFromDate, filterToDate);
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
            −${totalReturnDeductions.toFixed(2)}
          </p>
          <p className="text-gray-600 text-[10px] mt-1">
            {selectedReturnCount} return
            {selectedReturnCount !== 1 ? "s" : ""} selected
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
            disabled={
              (selectedOrderIds.size === 0 &&
                selectedReturnIds.size === 0 &&
                selectedReturnBatchIds.size === 0) ||
              isSubmitting
            }
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
          {selectedOrderIds.size === 0 &&
            selectedReturnIds.size === 0 &&
            selectedReturnBatchIds.size === 0 && (
              <p className="text-gray-600 text-[10px] text-center mt-2">
                Select at least one order or return to enable
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
                {searchTokens.length > 0
                  ? `${visibleUnpaidOrders.length} of ${unpaidOrders.length} orders`
                  : `${unpaidOrders.length} orders`}
              </span>
            </div>
            {/* Date Range Filter */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
                  From
                </span>
                <input
                  type="date"
                  value={filterFromDate}
                  onChange={(e) => setFilterFromDate(e.target.value)}
                  className="bg-[#0B0F17] border border-gray-800 rounded px-2 py-1 text-white text-xs outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-colors cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
                  To
                </span>
                <input
                  type="date"
                  value={filterToDate}
                  onChange={(e) => setFilterToDate(e.target.value)}
                  className="bg-[#0B0F17] border border-gray-800 rounded px-2 py-1 text-white text-xs outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-colors cursor-pointer"
                />
              </div>
              <button
                onClick={() => applyDateFilter(filterFromDate, filterToDate)}
                disabled={isSubmitting || isLoading}
                className="px-2 py-1 text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded hover:bg-cyan-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Apply
              </button>
              {(filterFromDate || filterToDate) && (
                <button
                  onClick={() => {
                    setFilterFromDate("");
                    setFilterToDate("");
                    applyDateFilter("", "");
                  }}
                  className="px-2 py-1 text-[10px] font-bold text-gray-400 bg-white/5 border border-white/10 rounded hover:bg-white/10 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            {/* Order ID search — display-only filter; never triggers a fetch and
                never clears existing selections. */}
            <div className="mt-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold whitespace-nowrap">
                  Search
                </span>
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    placeholder="Search order IDs — comma separated, e.g. 10049805, 78981891"
                    className="w-full bg-[#0B0F17] border border-gray-800 rounded px-2 py-1 pr-7 text-white text-xs outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-colors placeholder:text-gray-600"
                  />
                  {orderSearch !== "" && (
                    <button
                      onClick={() => setOrderSearch("")}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
                      title="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              {searchTokens.length > 0 && (
                <p className="text-[10px] text-gray-500 mt-1">
                  Showing {visibleUnpaidOrders.length} of {unpaidOrders.length}{" "}
                  eligible orders — selections stay active while you search.
                </p>
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
                {visibleUnpaidOrders.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-gray-600"
                    >
                      {searchTokens.length > 0
                        ? "No orders match your search."
                        : "No eligible orders found"}
                    </td>
                  </tr>
                ) : (
                  visibleUnpaidOrders.map((order) => {
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

        {/* Column 2: Unresolved Returns (Return Batches first, then legacy) */}
        <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold text-sm">
                Unresolved Returns to Deduct
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded">
                  {pendingReturnBatches.length} batch
                  {pendingReturnBatches.length !== 1 ? "es" : ""} ·{" "}
                  {pendingReturns.length} unbatched
                </span>
                <button
                  onClick={() => applyDateFilter(filterFromDate, filterToDate)}
                  disabled={isLoading || isSubmitting}
                  className="w-6 h-6 flex items-center justify-center text-xs text-gray-400 bg-white/5 border border-white/10 rounded hover:bg-white/10 hover:text-cyan-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Refresh returns (keeps the current date filter — no need to reload the page)"
                >
                  <span className={isLoading ? "inline-block animate-spin" : ""}>
                    ⟳
                  </span>
                </button>
              </div>
            </div>
            <p className="text-gray-600 text-[10px] mt-1 leading-tight">
              Checking a batch settles every order in it and subtracts its
              original advance from today&rsquo;s payout.
            </p>
          </div>

          {/* ── Return Batch cards (Universal Staff Scanner handoffs) ── */}
          {pendingReturnBatches.length > 0 && (
            <div className="px-3 py-3 space-y-2 border-b border-white/5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-500">
                  Return Batches
                </span>
                <label className="flex items-center gap-2 text-[10px] text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allReturnBatchesSelected}
                    onChange={toggleSelectAllReturnBatches}
                    className="rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500/50 cursor-pointer"
                  />
                  Select all batches
                </label>
              </div>

              {pendingReturnBatches.map((batch) => {
                const isSelected = selectedReturnBatchIds.has(batch.id);
                const isExpanded = expandedReturnBatchId === batch.id;
                return (
                  <div
                    key={batch.id}
                    className={`rounded-lg border transition-colors ${
                      isSelected
                        ? "border-orange-500/40 bg-orange-500/5"
                        : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleReturnBatch(batch.id)}
                        className="rounded border-white/20 bg-white/5 text-orange-500 focus:ring-orange-500/50 cursor-pointer"
                        title="Settle this entire return batch"
                      />
                      <button
                        onClick={() =>
                          setExpandedReturnBatchId(isExpanded ? null : batch.id)
                        }
                        className="flex flex-1 items-center gap-3 text-left min-w-0"
                      >
                        <span className="font-mono text-xs text-gray-200 truncate">
                          {batch.batchNumber}
                        </span>
                        <span className="text-[10px] text-gray-500 whitespace-nowrap">
                          {formatDateTime(batch.createdAt)}
                        </span>
                        <span className="text-[10px] text-gray-400 bg-white/5 px-1.5 py-0.5 rounded whitespace-nowrap">
                          {batch.orders.length} package
                          {batch.orders.length !== 1 ? "s" : ""}
                        </span>
                        <span className="ml-auto font-mono text-xs text-orange-400 whitespace-nowrap">
                          −${batch.totalDeduction.toFixed(2)}
                        </span>
                        <span className="text-gray-500 text-xs">
                          {isExpanded ? "▲" : "▼"}
                        </span>
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="px-3 pb-3">
                        <table className="w-full text-[11px]">
                          <thead className="text-gray-500 border-b border-white/5">
                            <tr>
                              <th className="py-1.5 text-left font-medium">
                                Order ID
                              </th>
                              <th className="py-1.5 text-center font-medium">
                                Fin Status
                              </th>
                              <th className="py-1.5 text-right font-medium">
                                COD Amount
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {batch.orders.map((o) => (
                              <tr key={o.id}>
                                <td className="py-1.5 font-mono text-gray-300">
                                  {o.orderId}
                                </td>
                                <td className="py-1.5 text-center">
                                  <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full border text-red-400 bg-red-500/10 border-red-500/30">
                                    {o.financialStatus ?? "Re"}
                                  </span>
                                </td>
                                <td className="py-1.5 text-right font-mono text-gray-400">
                                  {o.amountUsd == null
                                    ? "—"
                                    : `$${o.amountUsd.toFixed(2)}`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Legacy unbatched returns (pre-scanner / manual returns) ── */}
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
                      {pendingReturnBatches.length > 0
                        ? "No unbatched returns"
                        : "No unresolved returns"}
                    </td>
                  </tr>
                ) : (
                  pendingReturns.map((ret) => {
                    // "-Exchange" proof orders (item returned to the merchant)
                    // deduct exactly $0 — the seller fee was already charged on
                    // the main order, so neither a COD amount nor a fee is
                    // deducted here.
                    const amount = ret.amountUsd;
                    const isExchangeProof =
                      ret.orderId.endsWith("-Exchange") || amount == null;
                    const deduction = isExchangeProof
                      ? 0
                      : computeAdvance(amount, defaultSellerRate);
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
                          {amount == null ? "—" : `$${amount.toFixed(2)}`}
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
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-white/5 text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left w-8" />
                    <th className="px-2 py-2 text-left font-medium">
                      Batch Ref
                    </th>
                    <th className="px-2 py-2 text-left font-medium">Date</th>
                    <th className="px-2 py-2 text-right font-medium">
                      Gross Advance
                    </th>
                    <th className="px-2 py-2 text-right font-medium">
                      Deducted Returns
                    </th>
                    <th className="px-2 py-2 text-right font-medium">
                      Net Paid
                    </th>
                    <th className="px-4 py-2 text-right font-medium">Profit</th>
                    <th className="px-4 py-2 text-center font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {visibleBatches.map((batch) => {
                    const isExpanded = expandedBatchId === batch.id;
                    return (
                      <Fragment key={batch.id}>
                        <tr
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
                            ${batch.profit.toFixed(2)}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.location.href = `/merchants/${merchantId}/payouts/${batch.id}`;
                              }}
                              className="px-3 py-1 text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded hover:bg-cyan-500/20 transition-colors"
                            >
                              View Details
                            </button>
                          </td>
                        </tr>
                        {/* Expandable detail row */}
                        {isExpanded && (
                          <tr>
                            <td
                              colSpan={8}
                              className="px-4 py-3 bg-[#0B0F17]/50"
                            >
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Advance Orders */}
                                <div>
                                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-2">
                                    Advance Orders ({batch.orders.length})
                                  </p>
                                  {batch.orders.length === 0 ? (
                                    <p className="text-gray-600 text-xs">
                                      None
                                    </p>
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
                                    <p className="text-gray-600 text-xs">
                                      None
                                    </p>
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
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Historical Batch Pagination Controls ── */}
            <div className="px-4 py-3 border-t border-white/5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[10px] text-gray-500">
                Showing{" "}
                <span className="text-gray-300 font-mono">
                  {visibleBatches.length > 0
                    ? safeBatchPage * batchPageSize + 1
                    : 0}
                  –{safeBatchPage * batchPageSize + visibleBatches.length}
                </span>{" "}
                of{" "}
                <span className="text-gray-300 font-mono">
                  {batches.length}
                </span>{" "}
                batches
              </p>
              <div className="flex items-center gap-3">
                {/* Per-page size selector */}
                <select
                  value={batchPageSize}
                  onChange={(e) => setBatchPageSize(Number(e.target.value))}
                  className="bg-[#0B0F17] border border-gray-800 rounded px-2 py-1 text-white text-[10px] outline-none focus:border-cyan-500 cursor-pointer"
                  title="Batches per page"
                >
                  {[5, 10, 25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size} / page
                    </option>
                  ))}
                </select>
                {/* Prev / numbered pages / Next */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setBatchPage((p) => Math.max(0, p - 1))}
                    disabled={safeBatchPage === 0}
                    className="px-2 py-1 text-[10px] font-bold text-gray-300 bg-white/5 border border-white/10 rounded hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    ‹ Prev
                  </button>
                  {getPageNumbers(safeBatchPage, totalBatchPages).map(
                    (page, idx) =>
                      page === "…" ? (
                        <span
                          key={`ellipsis-${idx}`}
                          className="w-7 text-center text-gray-500 text-[10px]"
                        >
                          …
                        </span>
                      ) : (
                        <button
                          key={page}
                          onClick={() => setBatchPage(page)}
                          className={`w-7 h-7 text-[10px] font-bold rounded transition-colors ${
                            safeBatchPage === page
                              ? "bg-cyan-500 text-[#0B0F17]"
                              : "bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10"
                          }`}
                        >
                          {page + 1}
                        </button>
                      ),
                  )}
                  <button
                    onClick={() =>
                      setBatchPage((p) => Math.min(totalBatchPages - 1, p + 1))
                    }
                    disabled={safeBatchPage === totalBatchPages - 1}
                    className="px-2 py-1 text-[10px] font-bold text-gray-300 bg-white/5 border border-white/10 rounded hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next ›
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
