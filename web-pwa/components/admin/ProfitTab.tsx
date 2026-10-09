"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfitSeller {
  merchantId: string;
  merchantName: string;
  merchantNo: number;
  orderCount: number;
  totalCollectedUsd: number;
  totalProfit: number;
  feePerOrder: number;
}

interface ProfitDriver {
  driverProfileId: string;
  driverName: string;
  driverCode: string;
  orderCount: number;
  totalCollectedUsd: number;
  totalProfit: number;
}

interface ProfitSummary {
  orderCount: number;
  totalCollectedUsd: number;
  totalProfit: number;
  sellerCount: number;
  driverCount?: number;
}

const EMPTY_SUMMARY: ProfitSummary = {
  orderCount: 0,
  totalCollectedUsd: 0,
  totalProfit: 0,
  sellerCount: 0,
  driverCount: 0,
};

type PresetKind = "today" | "week" | "month" | "lastmonth" | "all";

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProfitTab() {
  const [sellers, setSellers] = useState<ProfitSeller[]>([]);
  const [drivers, setDrivers] = useState<ProfitDriver[]>([]);
  const [summary, setSummary] = useState<ProfitSummary>(EMPTY_SUMMARY);
  const [merchants, setMerchants] = useState<
    { id: string; merchantName: string; isCashSeller: boolean }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── Filters ──
  const [filterMerchant, setFilterMerchant] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterMonth, setFilterMonth] = useState("");

  const fetchProfit = useCallback(
    async (from: string, to: string, month: string, merchantId: string) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (month) params.set("month", month);
        else {
          if (from) params.set("from", from);
          if (to) params.set("to", to);
        }
        if (merchantId) params.set("merchantId", merchantId);

        const res = await fetch(`/api/admin/profit?${params.toString()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setSellers(data.sellers || []);
        setDrivers(data.drivers || []);
        setSummary(data.summary || EMPTY_SUMMARY);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to load profit overview",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Load merchants + initial (all time) profit
  useEffect(() => {
    fetch("/api/admin/merchants")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMerchants(Array.isArray(d) ? d : []))
      .catch(() => {});
    fetchProfit("", "", "", "");
  }, [fetchProfit]);

  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;

  const applyFilters = () => {
    fetchProfit(filterFrom, filterTo, filterMonth, filterMerchant);
  };

  const clearFilters = () => {
    setFilterMerchant("");
    setFilterFrom("");
    setFilterTo("");
    setFilterMonth("");
    fetchProfit("", "", "", "");
  };

  const applyPreset = (kind: PresetKind) => {
    const now = new Date();
    let from = "";
    let to = "";
    let month = "";

    if (kind === "today") {
      from = fmtDate(now);
      to = fmtDate(now);
    } else if (kind === "week") {
      const start = new Date(now);
      start.setDate(now.getDate() - 7);
      from = fmtDate(start);
      to = fmtDate(now);
    } else if (kind === "month") {
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
        2,
        "0",
      )}`;
    } else if (kind === "lastmonth") {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }

    setFilterFrom(from);
    setFilterTo(to);
    setFilterMonth(month);
    fetchProfit(from, to, month, filterMerchant);
  };

  const PRESETS: { key: PresetKind; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "Last 7 Days" },
    { key: "month", label: "This Month" },
    { key: "lastmonth", label: "Last Month" },
    { key: "all", label: "All Time" },
  ];

  return (
    <div>
      <div className="mb-6">
        <h3 className="text-white font-semibold text-sm">
          Company Profit Overview
        </h3>
        <p className="text-gray-500 text-xs mt-1 leading-relaxed">
          Profit is counted only on{" "}
          <span className="text-cyan-400">delivered</span> orders with financial
          status <span className="text-cyan-400">PS (Paid to Seller)</span>.
          Return orders are excluded. Profit per order = {"the seller's"} profit
          rate, unless {"the driver's"} seller rate exception equals the seller
          rate + profit (then profit = 0).
        </p>
      </div>

      {/* ── Filters ── */}
      <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          {/* Quick presets */}
          <div className="flex items-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                className="px-3 py-1.5 text-xs font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/20 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Month picker */}
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1">
              Month
            </label>
            <input
              type="month"
              value={filterMonth}
              onChange={(e) => {
                setFilterMonth(e.target.value);
                setFilterFrom("");
                setFilterTo("");
              }}
              className="bg-[#0B0F17] border border-gray-800 rounded px-2 py-1.5 text-white text-xs outline-none focus:border-cyan-500"
            />
          </div>

          {/* From / To */}
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1">
              From
            </label>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => {
                setFilterFrom(e.target.value);
                setFilterMonth("");
              }}
              className="bg-[#0B0F17] border border-gray-800 rounded px-2 py-1.5 text-white text-xs outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1">
              To
            </label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="bg-[#0B0F17] border border-gray-800 rounded px-2 py-1.5 text-white text-xs outline-none focus:border-cyan-500"
            />
          </div>

          {/* Seller filter */}
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1">
              Seller
            </label>
            <select
              value={filterMerchant}
              onChange={(e) => setFilterMerchant(e.target.value)}
              className="bg-[#0B0F17] border border-gray-800 rounded px-2 py-1.5 text-white text-xs outline-none focus:border-cyan-500 cursor-pointer"
            >
              <option value="">All Sellers</option>
              {merchants
                .filter((m) => m.isCashSeller)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.merchantName}
                  </option>
                ))}
            </select>
          </div>

          <button
            onClick={applyFilters}
            className="px-4 py-1.5 text-xs font-bold text-[#0B0F17] bg-cyan-500 hover:bg-cyan-400 rounded-lg transition-colors"
          >
            Apply
          </button>
          <button
            onClick={clearFilters}
            className="px-4 py-1.5 text-xs font-bold text-gray-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4">
          <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-1">
            Total Profit
          </p>
          <p className="text-yellow-400 font-mono text-2xl font-bold">
            ${summary.totalProfit.toFixed(2)}
          </p>
        </div>
        <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4">
          <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-1">
            Delivered / PS Orders
          </p>
          <p className="text-cyan-400 font-mono text-2xl font-bold">
            {summary.orderCount}
          </p>
        </div>
        <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4">
          <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-1">
            Gross Collected
          </p>
          <p className="text-green-400 font-mono text-2xl font-bold">
            ${summary.totalCollectedUsd.toFixed(2)}
          </p>
        </div>
        <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4">
          <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold mb-1">
            Sellers
          </p>
          <p className="text-white font-mono text-2xl font-bold">
            {summary.sellerCount}
          </p>
        </div>
      </div>

      {/* ── Per-seller table ── */}
      {loading ? (
        <div className="py-16 text-center text-gray-500 text-sm">
          Loading profit…
        </div>
      ) : sellers.length === 0 ? (
        <div className="py-16 text-center text-gray-500 text-sm">
          No profit data found for the selected period.
        </div>
      ) : (
        <div className="w-full overflow-x-auto bg-white/[0.02] border border-white/10 rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-[11px] uppercase">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Seller</th>
                <th className="px-4 py-3 text-right font-medium">Orders</th>
                <th className="px-4 py-3 text-right font-medium">
                  Gross Collected
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  Fee / Order
                </th>
                <th className="px-4 py-3 text-right font-medium text-yellow-400">
                  Profit
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sellers.map((s) => (
                <tr key={s.merchantId} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <span className="text-white font-semibold">
                      {s.merchantName}
                    </span>{" "}
                    <span className="text-gray-600 text-xs">
                      #{s.merchantNo}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-300">
                    {s.orderCount}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-green-400">
                    ${s.totalCollectedUsd.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-400">
                    ${s.feePerOrder.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-yellow-400 font-bold">
                    ${s.totalProfit.toFixed(2)}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-white/[0.03] font-semibold">
                <td className="px-4 py-3 text-gray-300">Total</td>
                <td className="px-4 py-3 text-right font-mono text-gray-200">
                  {summary.orderCount}
                </td>
                <td className="px-4 py-3 text-right font-mono text-green-300">
                  ${summary.totalCollectedUsd.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">—</td>
                <td className="px-4 py-3 text-right font-mono text-yellow-300 font-bold">
                  ${summary.totalProfit.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ── Per-driver table (admin-only; never shown on driver PDFs) ── */}
      {!loading && drivers.length > 0 && (
        <div className="mt-6">
          <h3 className="text-white font-semibold text-sm mb-3">
            Profit by Driver
          </h3>
          <p className="text-gray-500 text-xs mb-3 leading-relaxed">
            The same profit, attributed to the delivering driver. This record
            is kept only for the admin panel — it is hidden from all
            driver-facing documents.
          </p>
          <div className="w-full overflow-x-auto bg-white/[0.02] border border-white/10 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-[11px] uppercase">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Driver</th>
                  <th className="px-4 py-3 text-right font-medium">Orders</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Gross Collected
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-yellow-400">
                    Profit
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {drivers.map((d) => (
                  <tr key={d.driverProfileId || d.driverName} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <span className="text-white font-semibold">
                        {d.driverName}
                      </span>{" "}
                      <span className="text-gray-600 text-xs">
                        {d.driverCode}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-300">
                      {d.orderCount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-green-400">
                      ${d.totalCollectedUsd.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-yellow-400 font-bold">
                      ${d.totalProfit.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
