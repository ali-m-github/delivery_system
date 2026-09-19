"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PayoutOrder {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  amountUsd: number;
  amountLbp: number;
  collectedUsd: number;
  collectedLbp: number;
  financialStatus: string;
  location: string;
  createdAt: string;
  zone: { name: string };
  merchant?: { merchantName: string } | null;
  driverCommissionUsd?: number | null;
  payoutId?: string;
  payoutReference?: string | null;
}

interface DriverPayout {
  id: string;
  driverId: string;
  sequentialIndex: number;
  payoutReference: string;
  status: string;
  totalUsd: number;
  totalLbp: number;
  commissionUsd: number;
  netUsd: number;
  totalCollected: number;
  previousDebtUsd: number;
  previousDebtLbp: number;
  amountPaidUsd: number;
  amountPaidLbp: number;
  remainingUsd: number;
  remainingLbp: number;
  createdAt: string;
  clearedAt: string | null;
  createdBy?: {
    id: string;
    username: string;
    email: string;
  } | null;
  driver: {
    id: string;
    driverId: string;
    firstName: string;
    lastName: string;
    carriedDebtUsd: number;
    carriedDebtLbp: number;
  };
  orders: PayoutOrder[];
  paidStatements?: {
    id: string;
    sequentialIndex: number;
    netUsd: number;
    netLbp: number;
    paymentStatus: string;
    treasuryBox?: { id: string; name: string } | null;
    merchant?: { merchantName: string } | null;
  }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function beirutDateTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "Asia/Beirut",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function beirutDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "Asia/Beirut",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ClearedPayoutsPage() {
  const router = useRouter();

  // ── Data state ──
  const [pendingApproval, setPendingApproval] = useState<DriverPayout[]>([]);
  const [cleared, setCleared] = useState<DriverPayout[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Filter state ──
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  // ── Expand / approve state ──
  const [expandedPayoutIds, setExpandedPayoutIds] = useState<string[]>([]);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // ── Fetch both sections with shared filters ──
  // buildParams accepts a single status or a list. A list is issued as repeated
  // `status` params which /api/drivers/payouts merges into an `in` condition,
  // so the read-only archive can combine the terminal states SETTLED + CLEARED.
  const fetchData = useCallback(() => {
    const buildParams = (status: string | string[]) => {
      const params = new URLSearchParams();
      (Array.isArray(status) ? status : [status]).forEach((s) =>
        params.append("status", s),
      );
      if (search) params.set("search", search);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      params.set("sortBy", "createdAt");
      params.set("sortDir", sortOrder);
      return params.toString();
    };

    setLoading(true);

    Promise.all([
      fetch(`/api/drivers/payouts?${buildParams("PENDING_APPROVAL")}`),
      // The archive is read-only, so it combines both terminal states:
      // SETTLED (settle → approve) and CLEARED (cleared directly with the
      // office, orders already WO). Both are historical, non-approvable.
      fetch(`/api/drivers/payouts?${buildParams(["SETTLED", "CLEARED"])}`),
    ])
      .then(async ([pendingRes, clearedRes]) => {
        const [pendingData, clearedData] = await Promise.all([
          pendingRes.json(),
          clearedRes.json(),
        ]);
        setPendingApproval(Array.isArray(pendingData) ? pendingData : []);
        setCleared(Array.isArray(clearedData) ? clearedData : []);
        setLoading(false);
      })
      .catch(() => {
        setPendingApproval([]);
        setCleared([]);
        setLoading(false);
      });
  }, [search, startDate, endDate, sortOrder]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Approve payout (Phase 2) ──
  const handleApprove = async (id: string) => {
    setApprovingId(id);
    try {
      const res = await fetch(`/api/admin/drivers/payouts/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      // Defensively parse the response body: the server-side auth guard can
      // return a plain-text 401 ("Unauthorized") / 403 ("Forbidden") instead of
      // JSON, which would otherwise throw a SyntaxError on `res.json()`.
      let result: any = {};
      try {
        result = await res.json();
      } catch {
        result = {
          error:
            res.status === 401
              ? "Your session has expired. Please log in again."
              : `Request failed (${res.status}).`,
        };
      }

      if (res.ok && result.success) {
        router.refresh();
        await fetchData();
        alert(result.message || "Payout approved and settled.");
      } else {
        alert(result.error || "Failed to approve payout.");
      }
    } catch (error) {
      console.error(error);
      alert("Network error during approval.");
    } finally {
      setApprovingId(null);
    }
  };

  // ── Toggle expanded row ──
  const toggleExpanded = (payoutId: string) => {
    setExpandedPayoutIds((prev) =>
      prev.includes(payoutId)
        ? prev.filter((id) => id !== payoutId)
        : [...prev, payoutId],
    );
  };

  // ── Render Pending Approval table rows ──
  const renderPendingApprovalRows = () => {
    if (loading) {
      return (
        <tr>
          <td colSpan={9} className="text-center py-12 text-gray-500">
            Loading pending approvals...
          </td>
        </tr>
      );
    }
    if (pendingApproval.length === 0) {
      return (
        <tr>
          <td colSpan={9} className="text-center py-12 text-gray-500 italic">
            No payouts awaiting approval.
          </td>
        </tr>
      );
    }
    return pendingApproval.map((payout) => {
      const isExpanded = expandedPayoutIds.includes(payout.id);
      return (
        <Fragment key={payout.id}>
          <tr
            onClick={() => toggleExpanded(payout.id)}
            className="border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-pointer group"
          >
            <td className="px-4 py-3 font-mono text-amber-400 text-sm">
              {payout.payoutReference}
            </td>
            <td className="px-4 py-3 text-white text-sm font-medium">
              {payout.driver.firstName} {payout.driver.lastName}
              <span className="text-gray-600 text-xs ml-1">
                ({payout.driver.driverId})
              </span>
            </td>
            <td
              className="px-4 py-3 text-gray-300 text-xs"
              title={beirutDateTime(payout.createdAt)}
            >
              {beirutDate(payout.createdAt)}
              {payout.createdBy?.username && (
                <span className="block text-gray-600">
                  by {payout.createdBy.username}
                </span>
              )}
            </td>
            <td className="px-4 py-3 text-green-400 text-sm text-right font-mono font-bold">
              ${payout.netUsd.toFixed(2)}
            </td>
            <td className="px-4 py-3 text-emerald-400 text-sm text-right font-mono font-bold">
              ${(payout.amountPaidUsd ?? 0).toFixed(2)}
            </td>
            <td className="px-4 py-3 text-gray-300 text-sm text-right">
              {payout.orders.length}
            </td>
            <td className="px-4 py-3">
              <span className="px-2 py-0.5 text-[10px] font-bold rounded border bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse">
                {payout.status}
              </span>
            </td>
            <td
              className="px-4 py-3 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => handleApprove(payout.id)}
                disabled={approvingId === payout.id}
                className="px-3 py-1.5 text-[11px] font-bold bg-emerald-600 text-white border border-emerald-500/50 rounded hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {approvingId === payout.id
                  ? "Approving..."
                  : "✓ Approve Payout"}
              </button>
            </td>
          </tr>

          {isExpanded && (
            <tr>
              <td
                colSpan={9}
                className="bg-[#0a0f1a] border-b border-white/10 px-6 py-5"
              >
                {renderOrdersTable(payout, `Pending ${payout.payoutReference}`)}
                {renderStatements(payout)}
              </td>
            </tr>
          )}
        </Fragment>
      );
    });
  };

  // ── Render Cleared Archive table rows ──
  const renderClearedRows = () => {
    if (loading) {
      return (
        <tr>
          <td colSpan={9} className="text-center py-12 text-gray-500">
            Loading cleared archive...
          </td>
        </tr>
      );
    }
    if (cleared.length === 0) {
      return (
        <tr>
          <td colSpan={9} className="text-center py-12 text-gray-500 italic">
            No cleared payouts found matching the current filters.
          </td>
        </tr>
      );
    }
    return cleared.map((payout) => {
      const isExpanded = expandedPayoutIds.includes(payout.id);
      const carriedDebtUsd = payout.remainingUsd ?? 0;
      const hasShortPay = carriedDebtUsd > 0.01;

      return (
        <Fragment key={payout.id}>
          <tr
            onClick={() => toggleExpanded(payout.id)}
            className="border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-pointer group"
          >
            <td className="px-4 py-3 font-mono text-cyan-400 text-sm">
              {payout.payoutReference}
            </td>
            <td className="px-4 py-3 text-white text-sm font-medium">
              {payout.driver.firstName} {payout.driver.lastName}
              <span className="text-gray-600 text-xs ml-1">
                ({payout.driver.driverId})
              </span>
            </td>
            <td
              className="px-4 py-3 text-gray-300 text-xs"
              title={beirutDateTime(payout.clearedAt || payout.createdAt)}
            >
              {beirutDate(payout.clearedAt || payout.createdAt)}
              {payout.createdBy?.username && (
                <span className="block text-gray-600">
                  by {payout.createdBy.username}
                </span>
              )}
            </td>
            <td className="px-4 py-3 text-green-400 text-sm text-right font-mono font-bold">
              ${payout.netUsd.toFixed(2)}
            </td>
            <td className="px-4 py-3 text-emerald-400 text-sm text-right font-mono">
              ${(payout.amountPaidUsd ?? 0).toFixed(2)}
            </td>
            <td
              className={`px-4 py-3 text-sm text-right font-mono font-bold ${
                hasShortPay ? "text-red-400" : "text-gray-500"
              }`}
            >
              {hasShortPay ? `$${carriedDebtUsd.toFixed(2)}` : "$0.00"}
            </td>
            <td className="px-4 py-3 text-gray-300 text-sm text-right">
              {payout.orders.length}
            </td>
            <td className="px-4 py-3">
              <span className="px-2 py-0.5 text-[10px] font-bold rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                {payout.status}
              </span>
            </td>
            <td
              className="px-4 py-3 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-center gap-1.5">
                <button
                  onClick={() =>
                    window.open(
                      `/print/orders?ids=${(payout.orders || [])
                        .map((o) => o.id)
                        .join(",")}&driverId=${
                        payout.driverId || payout.driver?.id
                      }&payoutId=${payout.id}`,
                      "_blank",
                    )
                  }
                  disabled={!payout.orders || payout.orders.length === 0}
                  title="View / Print Orders"
                  className="px-2.5 py-1 text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  🖨 View/Print
                </button>
                <button
                  onClick={() => printPayoutInvoice(payout)}
                  title="Export PDF"
                  className="px-2 py-1 text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/30 rounded hover:bg-red-500/20 transition-colors"
                >
                  📄 PDF
                </button>
              </div>
            </td>
          </tr>

          {isExpanded && (
            <tr>
              <td
                colSpan={9}
                className="bg-[#0a0f1a] border-b border-white/10 px-6 py-5"
              >
                {renderOrdersTable(payout, `Cleared ${payout.payoutReference}`)}
                {renderStatements(payout)}
                {/* Summary row for expanded payout */}
                {payout.orders.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-[#121824] border border-white/5 rounded-lg p-3">
                      <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                        Net Payout
                      </p>
                      <p className="text-green-400 font-mono text-lg font-bold">
                        ${payout.netUsd.toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-[#121824] border border-white/5 rounded-lg p-3">
                      <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                        Amount Paid
                      </p>
                      <p className="text-emerald-400 font-mono text-lg font-bold">
                        ${(payout.amountPaidUsd ?? 0).toFixed(2)}
                      </p>
                    </div>
                    <div
                      className={`rounded-lg p-3 border ${
                        hasShortPay
                          ? "bg-red-500/5 border-red-500/20"
                          : "bg-[#121824] border-white/5"
                      }`}
                    >
                      <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                        Carried Debt
                      </p>
                      <p
                        className={`font-mono text-lg font-bold ${
                          hasShortPay ? "text-red-400" : "text-gray-500"
                        }`}
                      >
                        ${carriedDebtUsd.toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-[#121824] border border-white/5 rounded-lg p-3">
                      <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                        Commission
                      </p>
                      <p className="text-purple-400 font-mono text-lg font-bold">
                        ${payout.commissionUsd.toFixed(2)}
                      </p>
                    </div>
                  </div>
                )}
              </td>
            </tr>
          )}
        </Fragment>
      );
    });
  };

  // ── Shared orders detail table ──
  const renderOrdersTable = (payout: DriverPayout, title: string) => {
    return (
      <div>
        <div className="flex justify-between items-center mb-3">
          <h4 className="text-sm font-bold text-white uppercase tracking-wider">
            Itemized Orders — {title}
          </h4>
          <span className="text-xs text-gray-500">
            {payout.orders.length} order
            {payout.orders.length !== 1 ? "s" : ""}
          </span>
        </div>

        {payout.orders.length === 0 ? (
          <p className="text-gray-600 text-sm italic">
            No orders associated with this payout.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/5">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/[0.02] text-gray-500 text-[11px] uppercase tracking-wider">
                  <th className="px-4 py-2 font-semibold">Tracking ID</th>
                  <th className="px-4 py-2 font-semibold">Date Received</th>
                  <th className="px-4 py-2 font-semibold">Customer</th>
                  <th className="px-4 py-2 font-semibold">Address</th>
                  <th className="px-4 py-2 font-semibold">Zone</th>
                  <th className="px-4 py-2 font-semibold">Seller</th>
                  <th className="px-4 py-2 font-semibold text-right">
                    Amount USD
                  </th>
                  <th className="px-4 py-2 font-semibold text-right">
                    Amount LBP
                  </th>
                  <th className="px-4 py-2 font-semibold text-right">
                    Collected USD
                  </th>
                  <th className="px-4 py-2 font-semibold text-right">
                    Collected LBP
                  </th>
                  <th className="px-4 py-2 font-semibold text-right">
                    Driver Commission
                  </th>
                  <th className="px-4 py-2 font-semibold">Fin Status</th>
                </tr>
              </thead>
              <tbody>
                {payout.orders.map((order) => {
                  const actualCollectedUsd =
                    (order.collectedUsd ?? 0) === 0
                      ? (order.amountUsd ?? 0)
                      : (order.collectedUsd ?? 0);
                  const actualCollectedLbp =
                    (order.collectedLbp ?? 0) === 0
                      ? (order.amountLbp ?? 0)
                      : (order.collectedLbp ?? 0);
                  const isMismatched =
                    (order.amountUsd ?? 0) !== actualCollectedUsd ||
                    (order.amountLbp ?? 0) !== actualCollectedLbp;
                  return (
                    <tr
                      key={order.id}
                      className={`border-b border-white/[0.03] transition-colors ${
                        isMismatched
                          ? "bg-yellow-500/20"
                          : "hover:bg-white/[0.01]"
                      }`}
                    >
                      <td className="px-4 py-2 font-mono text-cyan-400 text-xs">
                        {order.orderId}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
                        {beirutDate(order.createdAt)}
                      </td>
                      <td className="px-4 py-2 text-gray-300 text-sm">
                        {order.customerName || "—"}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs max-w-[160px] truncate">
                        {order.customerAddress || "—"}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        {order.zone?.name || "—"}
                      </td>
                      <td className="px-4 py-2 text-gray-400 text-xs">
                        {order.merchant?.merchantName || "—"}
                      </td>
                      <td className="px-4 py-2 text-green-400 text-xs text-right font-mono">
                        ${(order.amountUsd ?? 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-gray-400 text-xs text-right">
                        {(order.amountLbp ?? 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-green-300 text-xs text-right font-mono">
                        ${actualCollectedUsd.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-gray-400 text-xs text-right">
                        {(order.collectedLbp ?? 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-purple-400 text-xs text-right font-mono">
                        {order.driverCommissionUsd == null
                          ? "—"
                          : `$${order.driverCommissionUsd.toFixed(2)}`}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${
                            order.financialStatus === "WO"
                              ? "bg-green-500/10 text-green-400 border-green-500/30"
                              : "bg-gray-500/10 text-gray-400 border-gray-500/30"
                          }`}
                        >
                          {order.financialStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  // ── Statements the driver paid from his own money (deducted from payout) ──
  const renderStatements = (payout: DriverPayout) => {
    const statements = payout.paidStatements || [];
    if (statements.length === 0) return null;
    return (
      <div className="mt-4">
        <div className="flex justify-between items-center mb-3">
          <h4 className="text-sm font-bold text-white uppercase tracking-wider">
            Statements Paid by Driver
          </h4>
          <span className="text-xs text-gray-500">
            {statements.length} statement{statements.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-white/5">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/[0.02] text-gray-500 text-[11px] uppercase tracking-wider">
                <th className="px-4 py-2 font-semibold">Statement</th>
                <th className="px-4 py-2 font-semibold">Seller</th>
                <th className="px-4 py-2 font-semibold text-right">
                  Amount USD
                </th>
                <th className="px-4 py-2 font-semibold text-right">
                  Amount LBP
                </th>
                <th className="px-4 py-2 font-semibold">Paid To Cashbox</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((stmt) => (
                <tr
                  key={stmt.id}
                  className="border-b border-white/[0.03] transition-colors"
                >
                  <td className="px-4 py-2 font-mono text-cyan-400 text-xs">
                    #{stmt.sequentialIndex}
                  </td>
                  <td className="px-4 py-2 text-gray-300 text-sm">
                    {stmt.merchant?.merchantName || "—"}
                  </td>
                  <td className="px-4 py-2 text-green-400 text-xs text-right font-mono">
                    ${(stmt.netUsd ?? 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-gray-400 text-xs text-right">
                    {(stmt.netLbp ?? 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-amber-400/70 text-xs">
                    {stmt.treasuryBox?.name || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${
                        stmt.paymentStatus === "PAID"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      }`}
                    >
                      {stmt.paymentStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ── Print isolated invoice (PDF via browser print) ──
  const printPayoutInvoice = (payout: DriverPayout) => {
    const clearedDate = beirutDateTime(payout.clearedAt || payout.createdAt);

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;

    const ordersHtml = (payout.orders || [])
      .map(
        (o) => `
        <tr>
          <td>${o.orderId}</td>
          <td>${o.customerName}</td>
          <td>${o.zone?.name || "—"}</td>
          <td class="text-right">$${(o.amountUsd ?? 0).toFixed(2)}</td>
          <td class="text-right">${(o.amountLbp ?? 0).toLocaleString()}</td>
          <td class="text-right">$${(o.collectedUsd ?? 0).toFixed(2)}</td>
          <td class="text-right">${o.driverCommissionUsd == null ? "—" : `$${o.driverCommissionUsd.toFixed(2)}`}</td>
        </tr>`,
      )
      .join("");

    printWindow.document.write(/* html */ `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Driver Consignment ${payout.payoutReference}</title>
        <style>
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family: 'Courier New', monospace; padding: 24px; color: #000; background: #fff; }
          @media print { body { padding: 12px; } }
          .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 12px; margin-bottom: 16px; }
          .header h2 { font-size: 18px; margin-bottom: 4px; }
          .header p { font-size: 12px; }
          .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 16px; font-size: 13px; }
          .summary .label { font-weight: bold; }
          .badge { display: inline-block; padding: 2px 8px; font-size: 11px; font-weight: bold; border: 1px solid #000; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
          th, td { border: 1px solid #000; padding: 5px 8px; text-align: left; }
          th { background: #eee; font-weight: bold; }
          .text-right { text-align: right; }
          .footer { margin-top: 20px; text-align: center; font-size: 11px; color: #555; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>Driver Consignment — Batch ${payout.payoutReference}</h2>
          <p>Driver: ${payout.driver.firstName} ${payout.driver.lastName} (${payout.driver.driverId})</p>
          <p>Cleared: ${clearedDate} &mdash; Status: <span class="badge">${payout.status}</span></p>
        </div>
        <div class="summary">
          <div><span class="label">Net Payout:</span> $${payout.netUsd.toFixed(2)}</div>
          <div><span class="label">Total LBP:</span> ${payout.totalLbp.toLocaleString()}</div>
          <div><span class="label">Amount Paid:</span> $${(payout.amountPaidUsd ?? 0).toFixed(2)}</div>
          <div><span class="label">Carried Debt:</span> $${(payout.remainingUsd ?? 0).toFixed(2)}</div>
          <div><span class="label">Previous Debt:</span> $${payout.previousDebtUsd.toFixed(2)}</div>
          <div><span class="label">Commission:</span> $${payout.commissionUsd.toFixed(2)}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Tracking ID</th>
              <th>Customer</th>
              <th>Zone</th>
              <th class="text-right">Amount USD</th>
              <th class="text-right">Amount LBP</th>
              <th class="text-right">Collected USD</th>
              <th class="text-right">Driver Commission</th>
            </tr>
          </thead>
          <tbody>${ordersHtml}</tbody>
        </table>
        <div class="footer">Printed on ${new Date().toLocaleString()}</div>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white p-6 font-sans antialiased">
      <div className="max-w-7xl mx-auto">
        {/* ── Header ── */}
        <header className="flex justify-between items-center mb-4 border-b border-white/5 pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Cleared Payouts
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Approve settled driver payouts and browse the cleared archive.
            </p>
          </div>
        </header>

        {/* ── Filter Ribbon ── */}
        <div className="bg-[#121824] border border-white/5 rounded-xl p-5 mb-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-1">
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
              Search
            </label>
            <input
              type="text"
              placeholder="Driver name, Driver ID, or Payout Batch #"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors [color-scheme:dark]"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors [color-scheme:dark]"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
              Sort by Date
            </label>
            <button
              onClick={() =>
                setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))
              }
              className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white hover:border-cyan-500/50 transition-colors text-left flex justify-between items-center"
            >
              <span>
                {sortOrder === "desc" ? "↓ Newest First" : "↑ Oldest First"}
              </span>
              <span className="text-gray-500 text-xs">↻</span>
            </button>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* ── SECTION 1: PENDING APPROVAL ─────────────────────────────────── */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-1 w-1 rounded-full bg-amber-400" />
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">
              Pending Approval
            </h2>
            <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold rounded">
              ACTION REQUIRED
            </span>
          </div>

          <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 font-semibold">Payout ID</th>
                    <th className="px-4 py-3 font-semibold">Driver</th>
                    <th className="px-4 py-3 font-semibold">Created</th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Net Payout
                    </th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Amount Paid
                    </th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Orders
                    </th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold text-center">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>{renderPendingApprovalRows()}</tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* ── SECTION 2: CLEARED ARCHIVE ──────────────────────────────────── */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-1 w-1 rounded-full bg-emerald-400" />
            <h2 className="text-lg font-bold text-white uppercase tracking-wider">
              Cleared Archive
            </h2>
            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold rounded">
              READ-ONLY
            </span>
          </div>

          <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 font-semibold">Payout ID</th>
                    <th className="px-4 py-3 font-semibold">Driver</th>
                    <th className="px-4 py-3 font-semibold">Cleared Date</th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Net Payout
                    </th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Amount Paid
                    </th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Carried Debt
                    </th>
                    <th className="px-4 py-3 font-semibold text-right">
                      Orders
                    </th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold text-center">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>{renderClearedRows()}</tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
