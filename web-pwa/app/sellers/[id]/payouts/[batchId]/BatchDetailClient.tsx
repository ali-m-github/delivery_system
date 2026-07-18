"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import SharedOrderTable from "@/components/SharedOrderTable";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PayoutAdjustment {
  id: number;
  description: string;
  amountUsd: number;
  amountLbp: number;
  createdAt: string;
}

interface BatchOrder {
  id: string;
  orderId: string;
  amountUsd: number;
  amountLbp: number;
  collectedUsd: number;
  collectedLbp: number;
  location: string;
  financialStatus: string;
  createdAt: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  zone?: { id: string; name: string } | null;
  zoneId?: string;
  driver?: {
    id: string;
    firstName: string;
    lastName: string;
    driverId: string;
  } | null;
  driverId?: string | null;
  merchant?: { merchantName: string } | null;
}

interface Batch {
  id: number;
  batchReference: string;
  grossAdvance: number;
  deductedReturns: number;
  netPaid: number;
  companyProfit: number;
  createdAt: string;
  merchant: { id: string; merchantName: string; merchantId: number };
  orders: BatchOrder[];
  resolvedReturns: BatchOrder[];
  adjustments: PayoutAdjustment[];
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

function escapeCSV(value: string): string {
  if (!value) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BatchDetailClient({ batch }: { batch: Batch }) {
  const router = useRouter();

  // ── Row selection state ──
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);

  const adjustmentsTotal = (batch.adjustments || []).reduce(
    (sum, adj) => sum + (adj.amountUsd ?? 0),
    0,
  );

  // Combine advance orders and resolved returns into a unified list
  const allOrders: BatchOrder[] = useMemo(
    () => [
      ...(batch.orders || []).map((o) => ({
        ...o,
        _orderType: "advance" as const,
      })),
      ...(batch.resolvedReturns || []).map((r) => ({
        ...r,
        _orderType: "return" as const,
      })),
    ],
    [batch.orders, batch.resolvedReturns],
  );

  // Compute total orders for stats
  const totalOrders = allOrders.length;

  // ── Select All / Toggle ──
  const isAllSelected =
    allOrders.length > 0 && selectedOrderIds.length === allOrders.length;

  const handleToggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedOrderIds([]);
    } else {
      setSelectedOrderIds(allOrders.map((o) => o.id));
    }
  }, [isAllSelected, allOrders]);

  const handleToggleSelectOrder = useCallback((id: string) => {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((oid) => oid !== id) : [...prev, id],
    );
  }, []);

  // ── Export to CSV ──
  const handleExportCSV = useCallback(() => {
    const selected = allOrders.filter((o) => selectedOrderIds.includes(o.id));
    if (selected.length === 0) {
      alert("Please select at least one order to export.");
      return;
    }

    const headers = [
      "Order ID",
      "Date",
      "Seller",
      "Customer",
      "Phone",
      "Address",
      "Zone",
      "Driver",
      "Location",
      "Fin Status",
      "Amount USD",
      "Amount LBP",
      "Collected USD",
      "Collected LBP",
    ];

    const rows = selected.map((o) => [
      escapeCSV(o.orderId),
      escapeCSV(formatDate(o.createdAt)),
      escapeCSV(o.merchant?.merchantName || ""),
      escapeCSV(o.customerName || ""),
      escapeCSV(o.customerPhone || ""),
      escapeCSV(o.customerAddress || ""),
      escapeCSV(o.zone?.name || ""),
      escapeCSV(o.driver ? `${o.driver.firstName} ${o.driver.lastName}` : ""),
      escapeCSV(o.location),
      escapeCSV(o.financialStatus),
      (o.amountUsd ?? 0).toFixed(2),
      (o.amountLbp ?? 0).toString(),
      (o.collectedUsd ?? 0).toFixed(2),
      (o.collectedLbp ?? 0).toString(),
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `payout-${batch.batchReference}-orders.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [allOrders, selectedOrderIds, batch.batchReference]);

  // ── Print / PDF Selected ──
  const handlePrintPDF = useCallback(() => {
    if (selectedOrderIds.length === 0) {
      alert("Please select at least one order to print.");
      return;
    }
    const url = `/print/orders?ids=${selectedOrderIds.join(",")}`;
    window.open(url, "_blank");
  }, [selectedOrderIds]);

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white p-6 font-sans">
      <div className="max-w-[1400px] mx-auto">
        {/* ── Header with Action Buttons ── */}
        <div className="flex justify-between items-start mb-6 border-b border-white/10 pb-6">
          <div>
            <button
              onClick={() => router.push(`/sellers/${batch.merchant.id}`)}
              className="text-gray-500 hover:text-gray-300 text-xs mb-2 transition-colors"
            >
              ← Back to Seller Profile
            </button>
            <h1 className="text-3xl font-bold text-white">
              Payout Batch Details
            </h1>
            <p className="text-gray-400 text-sm mt-2">
              <span className="bg-[#121824] px-2 py-1 rounded border border-white/5 mr-2 font-mono text-cyan-400">
                {batch.batchReference}
              </span>
              Seller:{" "}
              <span className="text-white font-medium">
                {batch.merchant.merchantName}
              </span>{" "}
              (#{batch.merchant.merchantId})
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExportCSV}
              disabled={selectedOrderIds.length === 0}
              className="px-4 py-2 text-sm font-bold bg-green-600 hover:bg-green-500 text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              📊 Export CSV
              {selectedOrderIds.length > 0 && ` (${selectedOrderIds.length})`}
            </button>
            <button
              onClick={handlePrintPDF}
              disabled={selectedOrderIds.length === 0}
              className="px-4 py-2 text-sm font-bold bg-cyan-500 hover:bg-cyan-400 text-[#0B0F17] rounded-lg transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            >
              🖨 Print / PDF
              {selectedOrderIds.length > 0 && ` (${selectedOrderIds.length})`}
            </button>
          </div>
        </div>

        {/* ── Section 1: Batch Summary ── */}
        <div className="mb-6">
          <h2 className="text-white font-semibold text-sm uppercase tracking-wider mb-4 border-b border-white/10 pb-2">
            Batch Summary
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-[#121824] border border-white/5 rounded-xl p-4">
              <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-1">
                Date Created
              </p>
              <p className="text-white font-mono text-sm font-bold">
                {formatDateTime(batch.createdAt)}
              </p>
            </div>

            <div className="bg-[#121824] border border-white/5 rounded-xl p-4">
              <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-1">
                Total Orders
              </p>
              <p className="text-white font-mono text-xl font-bold">
                {totalOrders}
              </p>
              <p className="text-gray-600 text-[10px] mt-1">
                {batch.orders.length} advance + {batch.resolvedReturns.length}{" "}
                returns
              </p>
            </div>

            <div className="bg-[#121824] border border-white/5 rounded-xl p-4">
              <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-1">
                Gross Advance
              </p>
              <p className="text-green-400 font-mono text-xl font-bold">
                ${batch.grossAdvance.toFixed(2)}
              </p>
            </div>

            <div className="bg-[#121824] border border-white/5 rounded-xl p-4">
              <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-1">
                Return Deductions
              </p>
              <p className="text-orange-400 font-mono text-xl font-bold">
                −${batch.deductedReturns.toFixed(2)}
              </p>
            </div>

            <div className="bg-[#121824] border border-white/5 rounded-xl p-4">
              <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-1">
                Adjustments
              </p>
              <p
                className={`font-mono text-xl font-bold ${
                  adjustmentsTotal >= 0 ? "text-green-400" : "text-red-400"
                }`}
              >
                {adjustmentsTotal >= 0 ? "+" : "−"}$
                {Math.abs(adjustmentsTotal).toFixed(2)}
              </p>
              <p className="text-gray-600 text-[10px] mt-1">
                {batch.adjustments.length} line item
                {batch.adjustments.length !== 1 ? "s" : ""}
              </p>
            </div>

            <div
              className={`rounded-xl p-4 border ${
                batch.netPaid >= 0
                  ? "bg-green-500/5 border-green-500/20"
                  : "bg-red-500/5 border-red-500/20"
              }`}
            >
              <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-1">
                Net Paid
              </p>
              <p
                className={`font-mono text-xl font-bold ${
                  batch.netPaid >= 0 ? "text-green-400" : "text-red-400"
                }`}
              >
                {batch.netPaid >= 0 ? "" : "−"}$
                {Math.abs(batch.netPaid).toFixed(2)}
              </p>
              <p className="text-gray-600 text-[10px] mt-1">
                Company Profit: ${batch.companyProfit.toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        {/* ── Section 2: Adjustments Ledger ── */}
        <div className="mb-6">
          <h2 className="text-white font-semibold text-sm uppercase tracking-wider mb-4 border-b border-white/10 pb-2">
            Adjustments Ledger
          </h2>
          {batch.adjustments.length === 0 ? (
            <div className="bg-[#121824] border border-white/5 rounded-xl p-6 text-center text-gray-600 text-sm">
              No manual adjustments were applied to this batch.
            </div>
          ) : (
            <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="border-b border-white/5 text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">#</th>
                    <th className="px-2 py-2 text-left font-medium">
                      Description
                    </th>
                    <th className="px-2 py-2 text-right font-medium">
                      Amount (USD)
                    </th>
                    <th className="px-2 py-2 text-right font-medium">
                      Amount (LBP)
                    </th>
                    <th className="px-4 py-2 text-left font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {batch.adjustments.map((adj, idx) => (
                    <tr
                      key={adj.id}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-2 text-gray-500">{idx + 1}</td>
                      <td className="px-2 py-2 text-gray-300">
                        {adj.description}
                      </td>
                      <td
                        className={`px-2 py-2 text-right font-mono ${
                          adj.amountUsd >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {adj.amountUsd >= 0 ? "+" : "−"}$
                        {Math.abs(adj.amountUsd).toFixed(2)}
                      </td>
                      <td
                        className={`px-2 py-2 text-right font-mono ${
                          adj.amountLbp >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {adj.amountLbp > 0 || adj.amountLbp < 0
                          ? `${adj.amountLbp >= 0 ? "+" : "−"}${Math.abs(adj.amountLbp).toLocaleString()} LL`
                          : "—"}
                      </td>
                      <td className="px-4 py-2 text-gray-500">
                        {formatDate(adj.createdAt)}
                      </td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr className="bg-white/[0.02] font-semibold">
                    <td
                      colSpan={2}
                      className="px-4 py-2 text-right text-gray-400"
                    >
                      Total Adjustments:
                    </td>
                    <td
                      className={`px-2 py-2 text-right font-mono ${
                        adjustmentsTotal >= 0
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
                    >
                      {adjustmentsTotal >= 0 ? "+" : "−"}$
                      {Math.abs(adjustmentsTotal).toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-right text-gray-500">—</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Section 3: Universal Order Details ── */}
        <div className="mb-6">
          <h2 className="text-white font-semibold text-sm uppercase tracking-wider mb-4 border-b border-white/10 pb-2">
            Orders in This Batch ({totalOrders})
            {selectedOrderIds.length > 0 && (
              <span className="ml-2 text-cyan-400">
                · {selectedOrderIds.length} selected
              </span>
            )}
          </h2>

          {allOrders.length === 0 ? (
            <div className="bg-[#121824] border border-white/5 rounded-xl p-8 text-center text-gray-600 text-sm">
              No orders in this batch.
            </div>
          ) : (
            <SharedOrderTable
              orders={allOrders}
              selectedOrderIds={selectedOrderIds}
              onToggleSelectOrder={handleToggleSelectOrder}
              onToggleSelectAll={handleToggleSelectAll}
              isAllSelected={isAllSelected}
            />
          )}
        </div>
      </div>
    </div>
  );
}
