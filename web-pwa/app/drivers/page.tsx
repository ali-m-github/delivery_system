"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DriverPayout {
  id: string;
  driverId: string;
  sequentialIndex: number;
  status: string;
  totalUsd: number;
  totalLbp: number;
  commissionUsd: number;
  netUsd: number;
  totalCollected: number;
  createdAt: string;
  clearedAt: string | null;
  driver: {
    id: string;
    driverId: string;
    firstName: string;
    lastName: string;
  };
  orders: Array<{
    id: string;
    orderId: string;
    customerName: string;
    amountUsd: number;
    amountLbp: number;
    zone: { name: string };
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function beirutDateTime(iso: string): string {
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function DriversDirectoryPage() {
  const router = useRouter();

  // ── Main tab ──
  const [activeMainTab, setActiveMainTab] = useState<"registry" | "ledger">(
    "registry",
  );

  // ── Drivers (registry) ──
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Payouts (ledger) ──
  const [payouts, setPayouts] = useState<DriverPayout[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(false);

  // ── Ledger filters ──
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [minAmount, setMinAmount] = useState("");

  // ── Expanded accordion rows ──
  const [expandedPayoutIds, setExpandedPayoutIds] = useState<string[]>([]);

  // ── Bulk payout selection ──
  const [selectedPayouts, setSelectedPayouts] = useState<string[]>([]);

  const togglePayoutSelection = (id: string) => {
    setSelectedPayouts((prev) =>
      prev.includes(id) ? prev.filter((pid) => pid !== id) : [...prev, id],
    );
  };

  // ── Concurrent initial fetch ──
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setPayoutsLoading(true);
      try {
        const [driversRes, payoutsRes] = await Promise.all([
          fetch("/api/admin/drivers"),
          fetch("/api/drivers/payouts"),
        ]);
        if (driversRes.ok) {
          const data = await driversRes.json();
          setDrivers(data);
        }
        if (payoutsRes.ok) {
          const data = await payoutsRes.json();
          setPayouts(data);
        }
      } catch (error) {
        console.error("Failed to fetch data", error);
      } finally {
        setLoading(false);
        setPayoutsLoading(false);
      }
    };
    fetchData();
  }, []);

  // ── Refetch payouts when filters change ──
  useEffect(() => {
    if (activeMainTab !== "ledger") return;

    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("sortBy", "totalUsd");
    params.set("sortDir", sortOrder);
    if (minAmount) params.set("minAmount", minAmount);

    setPayoutsLoading(true);
    fetch(`/api/drivers/payouts?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setPayouts(data);
        setPayoutsLoading(false);
      })
      .catch(() => setPayoutsLoading(false));
  }, [
    activeMainTab,
    search,
    statusFilter,
    startDate,
    endDate,
    sortOrder,
    minAmount,
  ]);

  // ── Toggle expanded row ──
  const toggleExpanded = (payoutId: string) => {
    setExpandedPayoutIds((prev) =>
      prev.includes(payoutId)
        ? prev.filter((id) => id !== payoutId)
        : [...prev, payoutId],
    );
  };

  // ── Print batch invoice ──
  const printPayoutInvoice = useCallback((payout: DriverPayout) => {
    const beirutTime = beirutDateTime(payout.createdAt);

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;

    printWindow.document.write(/* html */ `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payout Invoice #${payout.sequentialIndex}</title>
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
          <h2>Payout Invoice #${payout.sequentialIndex}</h2>
          <p>Driver: ${payout.driver.firstName} ${payout.driver.lastName} (${payout.driver.driverId})</p>
          <p>Execution Date: ${beirutTime} &mdash; Status: <span class="badge">${payout.status}</span></p>
        </div>
        <div class="summary">
          <div><span class="label">Total USD:</span> $${payout.totalUsd.toFixed(2)}</div>
          <div><span class="label">Total LBP:</span> ${payout.totalLbp.toLocaleString()}</div>
          <div><span class="label">Commission USD:</span> $${payout.commissionUsd.toFixed(2)}</div>
          <div><span class="label">Net Paid:</span> $${payout.netUsd.toFixed(2)}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Tracking ID</th>
              <th>Customer</th>
              <th>Zone</th>
              <th class="text-right">Amount USD</th>
              <th class="text-right">Amount LBP</th>
            </tr>
          </thead>
          <tbody>
            ${payout.orders
              .map(
                (o) => `
              <tr>
                <td>${o.orderId}</td>
                <td>${o.customerName}</td>
                <td>${o.zone.name}</td>
                <td class="text-right">$${o.amountUsd.toFixed(2)}</td>
                <td class="text-right">${o.amountLbp.toLocaleString()}</td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
        <div class="footer">Printed on ${new Date().toLocaleString()}</div>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  }, []);

  // ── Native Excel Export ──────────────────────────────────────────────────────
  const exportToExcel = (filename: string, rows: any[]) => {
    if (!rows || !rows.length) return;
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    XLSX.writeFile(
      workbook,
      filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`,
    );
  };

  // ── Ghost Print Engine (isolated print) ─────────────────────────────────────
  const printIsolatedSummaries = (selectedData: any[]) => {
    if (!selectedData || !selectedData.length) return;

    // Build a clean, print-friendly HTML table
    let printContent = `
      <html>
        <head>
          <title>Payout Summaries</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: black; }
            h2 { border-bottom: 2px solid black; padding-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
            th { background-color: #f2f2f2; font-weight: bold; }
          </style>
        </head>
        <body>
          <h2>Selected Payout Summaries</h2>
          <table>
            <thead>
              <tr>
                <th>Payout ID</th>
                <th>Driver</th>
                <th>Total USD</th>
                <th>Commission</th>
                <th>Net Paid</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
    `;

    selectedData.forEach((p) => {
      printContent += `
        <tr>
          <td>${p.id}</td>
          <td>${p.driverName}</td>
          <td>$${p.totalUsd}</td>
          <td>-$${p.commission}</td>
          <td>$${p.netUsd}</td>
          <td>${p.date}</td>
        </tr>
      `;
    });

    printContent += `</tbody></table></body></html>`;

    // Create a hidden iframe
    const printFrame = document.createElement("iframe");
    printFrame.style.position = "absolute";
    printFrame.style.top = "-9999px";
    document.body.appendChild(printFrame);

    const frameDoc = printFrame.contentWindow?.document;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write(printContent);
      frameDoc.close();
    }

    // Trigger print and clean up
    printFrame.contentWindow?.focus();
    setTimeout(() => {
      printFrame.contentWindow?.print();
      document.body.removeChild(printFrame);
    }, 250);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white p-6 font-sans antialiased">
      <div className="max-w-7xl mx-auto">
        {/* ── Primary Tab Switcher ── */}
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => setActiveMainTab("registry")}
            className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeMainTab === "registry"
                ? "bg-cyan-600 text-white shadow-lg shadow-cyan-500/20"
                : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border border-white/10"
            }`}
          >
            Drivers Registry
          </button>
          <button
            onClick={() => setActiveMainTab("ledger")}
            className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeMainTab === "ledger"
                ? "bg-cyan-600 text-white shadow-lg shadow-cyan-500/20"
                : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border border-white/10"
            }`}
          >
            Global Payout History
          </button>
        </div>

        {/* ════════════════════════════════════════════════════════════════════
            REGISTRY TAB — Existing Fleet Table
           ════════════════════════════════════════════════════════════════════ */}
        {activeMainTab === "registry" && (
          <>
            {/* Header */}
            <header className="flex justify-between items-center mb-8 border-b border-white/5 pb-5">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  Active Driver Fleet
                </h1>
                <p className="text-gray-400 text-sm mt-1">
                  Manage driver assignments and operational ledgers.
                </p>
              </div>
              <button className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded text-sm font-bold shadow transition-colors">
                + Register New Driver
              </button>
            </header>

            {/* Fleet Table */}
            <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden shadow-2xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                      <th className="px-6 py-4 font-semibold">Internal ID</th>
                      <th className="px-6 py-4 font-semibold">Driver Name</th>
                      <th className="px-6 py-4 font-semibold">
                        System Username
                      </th>
                      <th className="px-6 py-4 font-semibold">Role</th>
                      <th className="px-6 py-4 font-semibold text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="text-center py-8 text-gray-500"
                        >
                          Loading fleet data...
                        </td>
                      </tr>
                    ) : drivers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="text-center py-8 text-gray-500 italic"
                        >
                          No drivers registered in the system.
                        </td>
                      </tr>
                    ) : (
                      drivers.map((driver) => (
                        <tr
                          key={driver.id}
                          className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="px-6 py-4 font-mono text-cyan-400 text-sm">
                            {driver.driverId || "—"}
                          </td>
                          <td className="px-6 py-4 text-white text-sm font-medium">
                            {driver.firstName} {driver.lastName}
                          </td>
                          <td className="px-6 py-4 text-gray-400 text-sm">
                            {driver.user?.username || driver.username || "—"}
                          </td>
                          <td className="px-6 py-4">
                            <span className="px-2 py-1 text-[10px] font-bold rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                              DRIVER
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() =>
                                router.push(`/drivers/${driver.id}`)
                              }
                              className="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors"
                            >
                              View Profile & Ledger &rarr;
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            LEDGER TAB — Global Payout History with Advanced Filters
           ════════════════════════════════════════════════════════════════════ */}
        {activeMainTab === "ledger" && (
          <>
            {/* Header */}
            <header className="flex justify-between items-center mb-4 border-b border-white/5 pb-5">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  Global Payout History
                </h1>
                <p className="text-gray-400 text-sm mt-1">
                  Filter, inspect, and print driver payout batches.
                </p>
              </div>
            </header>

            {/* ── Filter Ribbon ── */}
            <div className="bg-[#121824] border border-white/5 rounded-xl p-5 mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Search */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                  Search
                </label>
                <input
                  type="text"
                  placeholder="Name, ID, or Payout #"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              </div>

              {/* Status Dropdown */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors appearance-none cursor-pointer"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="PENDING">Pending</option>
                  <option value="CLEARED">Cleared</option>
                </select>
              </div>

              {/* Date Range */}
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

              {/* Amount Sort & Min */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                  Sort by Amount
                </label>
                <button
                  onClick={() =>
                    setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))
                  }
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white hover:border-cyan-500/50 transition-colors text-left flex justify-between items-center"
                >
                  <span>
                    {sortOrder === "desc"
                      ? "↓ Highest First"
                      : "↑ Lowest First"}
                  </span>
                  <span className="text-gray-500 text-xs">↻</span>
                </button>
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                  Min USD Value
                </label>
                <input
                  type="number"
                  placeholder="e.g. 50"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              </div>
            </div>

            {/* ── Bulk Action Toolbar ── */}
            {selectedPayouts.length > 0 && (
              <div className="bg-[#121824] border border-white/5 rounded-xl px-5 py-3 mb-4 flex items-center gap-3 shadow-2xl">
                <span className="text-sm text-gray-400">
                  <span className="text-white font-bold">
                    {selectedPayouts.length}
                  </span>{" "}
                  selected
                </span>
                <div className="h-5 w-px bg-white/10" />
                <button
                  onClick={() => {
                    const mappedData = payouts
                      .filter((p) => selectedPayouts.includes(p.id))
                      .map((p) => ({
                        id: `${p.driver.driverId}-${String(p.sequentialIndex || 1).padStart(2, "0")}`,
                        driverName: `${p.driver.firstName} ${p.driver.lastName}`,
                        totalUsd: p.totalUsd,
                        commission: p.commissionUsd,
                        netUsd: p.netUsd,
                        date: p.createdAt,
                      }));
                    printIsolatedSummaries(mappedData);
                  }}
                  className="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-4 py-1.5 rounded text-xs font-semibold transition-colors flex items-center gap-1.5"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                    />
                  </svg>
                  Print Selected
                </button>
                <button
                  onClick={() => {
                    const mappedData = payouts
                      .filter((p) => selectedPayouts.includes(p.id))
                      .map((p) => ({
                        "Payout ID": `${p.driver.driverId}-${String(p.sequentialIndex || 1).padStart(2, "0")}`,
                        Driver: `${p.driver.firstName} ${p.driver.lastName}`,
                        "Total USD": p.totalUsd,
                        Commission: p.commissionUsd,
                        "Net Paid": p.netUsd,
                        Date: p.createdAt,
                      }));
                    exportToExcel("Payouts_Export", mappedData);
                  }}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow transition-colors flex items-center gap-1.5"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Export Selected to Excel
                </button>
              </div>
            )}

            {/* ── Payouts Table ── */}
            <div className="bg-[#121824] border border-white/5 rounded-xl overflow-hidden shadow-2xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                      <th className="px-4 py-3 font-semibold w-10">
                        <input
                          type="checkbox"
                          checked={
                            payouts.length > 0 &&
                            selectedPayouts.length === payouts.length
                          }
                          onChange={(e) =>
                            e.target.checked
                              ? setSelectedPayouts(payouts.map((p) => p.id))
                              : setSelectedPayouts([])
                          }
                          className="cursor-pointer"
                        />
                      </th>
                      <th className="px-4 py-3 font-semibold">Payout #</th>
                      <th className="px-4 py-3 font-semibold">Driver</th>
                      <th className="px-4 py-3 font-semibold">
                        Execution Date (Beirut)
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Total USD
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Total LBP
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Commission
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Net Paid
                      </th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutsLoading ? (
                      <tr>
                        <td
                          colSpan={9}
                          className="text-center py-8 text-gray-500"
                        >
                          Loading payout history...
                        </td>
                      </tr>
                    ) : payouts.length === 0 ? (
                      <tr>
                        <td
                          colSpan={9}
                          className="text-center py-8 text-gray-500 italic"
                        >
                          No payout records match the current filters.
                        </td>
                      </tr>
                    ) : (
                      payouts.map((payout) => {
                        const isExpanded = expandedPayoutIds.includes(
                          payout.id,
                        );
                        return (
                          <Fragment key={payout.id}>
                            {/* Main row */}
                            <tr
                              onClick={() => toggleExpanded(payout.id)}
                              className="border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-pointer group"
                            >
                              <td
                                className="px-4 py-3"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedPayouts.includes(payout.id)}
                                  onChange={() =>
                                    togglePayoutSelection(payout.id)
                                  }
                                  className="w-4 h-4 rounded border-white/20 bg-[#0B0F17] text-cyan-600 focus:ring-cyan-500/50 focus:ring-offset-0 cursor-pointer accent-cyan-600"
                                />
                              </td>
                              <td className="px-4 py-3 font-mono text-cyan-400 text-sm">
                                #{payout.sequentialIndex}
                              </td>
                              <td className="px-4 py-3 text-white text-sm font-medium">
                                {payout.driver.firstName}{" "}
                                {payout.driver.lastName}
                                <span className="text-gray-600 text-xs ml-1">
                                  ({payout.driver.driverId})
                                </span>
                              </td>
                              <td className="px-4 py-3 text-gray-300 text-xs">
                                {beirutDateTime(payout.createdAt)}
                              </td>
                              <td className="px-4 py-3 text-green-400 text-sm text-right font-mono">
                                ${payout.totalUsd.toFixed(2)}
                              </td>
                              <td className="px-4 py-3 text-gray-300 text-sm text-right">
                                {payout.totalLbp.toLocaleString()}
                              </td>
                              <td className="px-4 py-3 text-amber-400 text-sm text-right font-mono">
                                ${payout.commissionUsd.toFixed(2)}
                              </td>
                              <td className="px-4 py-3 text-white text-sm text-right font-mono font-bold">
                                ${payout.netUsd.toFixed(2)}
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className={`px-2 py-0.5 text-[10px] font-bold rounded border ${
                                    payout.status === "CLEARED"
                                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                      : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                  }`}
                                >
                                  {payout.status}
                                </span>
                              </td>
                            </tr>

                            {/* Expanded sub-row */}
                            {isExpanded && (
                              <tr>
                                <td
                                  colSpan={9}
                                  className="bg-[#0a0f1a] border-b border-white/10 px-6 py-5"
                                >
                                  <div className="flex justify-between items-center mb-3">
                                    <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                                      Itemized Orders — Payout #
                                      {payout.sequentialIndex}
                                    </h4>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          printPayoutInvoice(payout);
                                        }}
                                        className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow transition-colors flex items-center gap-1.5"
                                      >
                                        <svg
                                          className="w-3.5 h-3.5"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth={2}
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                                          />
                                        </svg>
                                        Print Batch Invoice
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const mappedOrders =
                                            payout.orders.map((o) => ({
                                              "Tracking ID": o.orderId,
                                              Customer: o.customerName,
                                              Zone: o.zone.name,
                                              "Amount USD": o.amountUsd,
                                            }));
                                          exportToExcel(
                                            `Batch_${payout.sequentialIndex}_Orders`,
                                            mappedOrders,
                                          );
                                        }}
                                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded text-xs font-bold shadow transition-colors flex items-center gap-1.5"
                                      >
                                        <svg
                                          className="w-3.5 h-3.5"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth={2}
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                          />
                                        </svg>
                                        Export Orders to Excel
                                      </button>
                                    </div>
                                  </div>

                                  <div className="overflow-x-auto rounded-lg border border-white/5">
                                    <table className="w-full text-left border-collapse">
                                      <thead>
                                        <tr className="bg-white/[0.02] text-gray-500 text-[11px] uppercase tracking-wider">
                                          <th className="px-4 py-2 font-semibold">
                                            Tracking ID
                                          </th>
                                          <th className="px-4 py-2 font-semibold">
                                            Customer
                                          </th>
                                          <th className="px-4 py-2 font-semibold">
                                            Zone
                                          </th>
                                          <th className="px-4 py-2 font-semibold text-right">
                                            Amount USD
                                          </th>
                                          <th className="px-4 py-2 font-semibold text-right">
                                            Amount LBP
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {payout.orders.map((order) => (
                                          <tr
                                            key={order.id}
                                            className="border-b border-white/[0.03] hover:bg-white/[0.01] transition-colors"
                                          >
                                            <td className="px-4 py-2 font-mono text-cyan-400 text-xs">
                                              {order.orderId}
                                            </td>
                                            <td className="px-4 py-2 text-gray-300 text-sm">
                                              {order.customerName}
                                            </td>
                                            <td className="px-4 py-2 text-gray-500 text-xs">
                                              {order.zone.name}
                                            </td>
                                            <td className="px-4 py-2 text-green-400 text-xs text-right font-mono">
                                              ${order.amountUsd.toFixed(2)}
                                            </td>
                                            <td className="px-4 py-2 text-gray-400 text-xs text-right">
                                              {order.amountLbp.toLocaleString()}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
