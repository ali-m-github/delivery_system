"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import CreateDriverModal from "@/components/drivers/CreateDriverModal";
import PermissionGuard from "@/components/PermissionGuard";

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
    customerAddress?: string;
    amountUsd: number;
    amountLbp: number;
    collectedUsd?: number;
    collectedLbp?: number;
    createdAt?: string;
    zone: { name: string };
    driverCommissionUsd?: number | null;
  }>;
}

interface DriverZoneRateRow {
  id: string;
  zoneId: string;
  rate: number;
  zone?: { name: string } | null;
}

interface DriverRow {
  id: string;
  driverId: string;
  firstName: string;
  lastName: string;
  username?: string;
  user?: { username: string } | null;
  zoneRates?: DriverZoneRateRow[];
  // Currently driver-held order counts (Dr = ASSIGNED/WITH_DRIVER,
  // Tr = ASSIGNED_TR), provided by GET /api/admin/drivers.
  drCount?: number;
  trCount?: number;
}

interface SellerRateRow {
  merchantId: string;
  merchantName: string;
  rateUsd: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalizeName(name: string): string {
  return name
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

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

function beirutDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "Asia/Beirut",
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
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
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
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

  // ── Create driver modal ──
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // ── Driver rate editor modal ──
  const [rateModalDriver, setRateModalDriver] = useState<DriverRow | null>(
    null,
  );
  const [zones, setZones] = useState<{ id: string; name: string }[]>([]);
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const [sellerRateRows, setSellerRateRows] = useState<SellerRateRow[]>([]);
  const [cashSellerRates, setCashSellerRates] = useState<
    { merchantId: string; merchantName: string; rateUsd: number }[]
  >([]);
  const [merchants, setMerchants] = useState<
    { id: string; merchantName: string }[]
  >([]);
  const [sellerAddMerchantId, setSellerAddMerchantId] = useState("");
  const [sellerAddRate, setSellerAddRate] = useState("");
  const [rateSaving, setRateSaving] = useState(false);

  const openRateModal = async (driver: DriverRow) => {
    // Reset drafts
    setRateDraft({});
    setSellerRateRows([]);
    setCashSellerRates([]);
    setSellerAddMerchantId("");
    setSellerAddRate("");
    setRateModalDriver(driver);
    try {
      const [driverRes, zonesRes, merchantsRes] = await Promise.all([
        fetch(`/api/admin/drivers/${driver.driverId}`),
        fetch("/api/admin/zones"),
        fetch("/api/admin/merchants"),
      ]);
      if (driverRes.ok) {
        const full = (await driverRes.json()) as {
          zoneRates?: { zoneId: string; rate: number }[];
          driverSellerRates?: {
            merchantId: string;
            rateUsd: number;
            merchant?: { merchantName: string } | null;
          }[];
          user?: {
            driverCashSellerRates?: {
              merchantId: string;
              rateUsd: number;
              merchant?: { merchantName: string } | null;
            }[];
          } | null;
        };
        const zoneDraft: Record<string, string> = {};
        (full.zoneRates || []).forEach((zr) => {
          zoneDraft[zr.zoneId] = String(zr.rate ?? 0);
        });
        setRateDraft(zoneDraft);
        setSellerRateRows(
          (full.driverSellerRates || []).map((sr) => ({
            merchantId: sr.merchantId,
            merchantName:
              sr.merchant?.merchantName || `Seller #${sr.merchantId}`,
            rateUsd: String(sr.rateUsd ?? 0),
          })),
        );
        setCashSellerRates(
          (full.user?.driverCashSellerRates || []).map((cr) => ({
            merchantId: cr.merchantId,
            merchantName:
              cr.merchant?.merchantName || `Seller #${cr.merchantId}`,
            rateUsd: Number(cr.rateUsd ?? 0),
          })),
        );
      }
      if (zonesRes.ok) setZones(await zonesRes.json());
      if (merchantsRes.ok) setMerchants(await merchantsRes.json());
    } catch {
      // silently fail
    }
  };

  const closeRateModal = () => {
    if (rateSaving) return;
    setRateModalDriver(null);
    setRateDraft({});
    setSellerRateRows([]);
    setCashSellerRates([]);
    setSellerAddMerchantId("");
    setSellerAddRate("");
  };

  const addSellerRateRow = () => {
    if (!sellerAddMerchantId) return;
    if (sellerRateRows.some((r) => r.merchantId === sellerAddMerchantId)) {
      alert("This seller already has an exception rate.");
      return;
    }
    const merchant = merchants.find((m) => m.id === sellerAddMerchantId);
    setSellerRateRows((prev) => [
      ...prev,
      {
        merchantId: sellerAddMerchantId,
        merchantName: merchant?.merchantName || "Seller",
        rateUsd: sellerAddRate,
      },
    ]);
    setSellerAddMerchantId("");
    setSellerAddRate("");
  };

  const updateSellerRateRow = (index: number, rateUsd: string) => {
    setSellerRateRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, rateUsd } : row)),
    );
  };

  const removeSellerRateRow = (index: number) => {
    setSellerRateRows((prev) => prev.filter((_, i) => i !== index));
  };

  const saveRates = async () => {
    if (!rateModalDriver) return;
    const zoneRates = Object.entries(rateDraft)
      .map(([zoneId, rateStr]) => ({ zoneId, rate: parseFloat(rateStr) }))
      .filter((r) => !isNaN(r.rate) && r.rate >= 0);
    const sellerRates = sellerRateRows
      .map((row) => ({
        merchantId: row.merchantId,
        rateUsd: parseFloat(row.rateUsd),
      }))
      .filter((r) => r.merchantId && !isNaN(r.rateUsd) && r.rateUsd >= 0);
    setRateSaving(true);
    try {
      const results = await Promise.all([
        fetch(`/api/admin/drivers/${rateModalDriver.driverId}/zone-rates`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rates: zoneRates }),
        }),
        fetch(`/api/admin/drivers/${rateModalDriver.driverId}/seller-rates`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sellerRates }),
        }),
      ]);
      for (const res of results) {
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to save driver rates");
        }
      }
      setRateModalDriver(null);
      setRateDraft({});
      setSellerRateRows([]);
      setCashSellerRates([]);
      // Refresh the drivers list to reflect the new rates
      const dataRes = await fetch("/api/admin/drivers");
      if (dataRes.ok) setDrivers(await dataRes.json());
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error saving driver rates");
    } finally {
      setRateSaving(false);
    }
  };

  const togglePayoutSelection = (id: string) => {
    setSelectedPayouts((prev) =>
      prev.includes(id) ? prev.filter((pid) => pid !== id) : [...prev, id],
    );
  };

  // ── Initial fetch (registry only) ──
  // The payout ledger is intentionally NOT fetched here: it is the heaviest
  // payload on this page (the full ledger with nested orders) and the
  // registry tab never renders it. The ledger effect below lazy-loads it the
  // first time the ledger tab is opened, so the registry renders as soon as
  // the (small, fast) drivers list arrives.
  useEffect(() => {
    const fetchDrivers = async () => {
      setLoading(true);
      try {
        const driversRes = await fetch("/api/admin/drivers");
        if (driversRes.ok) {
          const data = await driversRes.json();
          setDrivers(data);
        }
      } catch (error) {
        console.error("Failed to fetch drivers", error);
      } finally {
        setLoading(false);
      }
    };
    fetchDrivers();
  }, []);

  // ── Load payouts when the ledger tab opens, and refetch when filters change ──
  // First run with activeMainTab === "ledger" is the lazy initial load;
  // subsequent runs are filter-driven refetches.
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
          <p>Driver: ${capitalizeName(payout.driver.firstName)} ${capitalizeName(payout.driver.lastName)} (${payout.driver.driverId})</p>
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
  }, []);

  // ── Native Excel Export ──────────────────────────────────────────────────────
  const exportToExcel = async (filename: string, rows: any[]) => {
    if (!rows || !rows.length) return;
    const XLSX = await import("xlsx");
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
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded text-sm font-bold shadow transition-colors"
              >
                + Register New Driver
              </button>
            </header>

            {isCreateModalOpen && (
              <CreateDriverModal
                onClose={() => setIsCreateModalOpen(false)}
                onSuccess={() => {
                  setIsCreateModalOpen(false);
                  // Refresh the drivers list
                  fetch("/api/admin/drivers")
                    .then((r) => r.ok && r.json())
                    .then((data) => setDrivers(data))
                    .catch(() => {});
                }}
              />
            )}

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
                      <th className="px-6 py-4 font-semibold text-right">
                        Orders (Dr)
                      </th>
                      <th className="px-6 py-4 font-semibold text-right">
                        Orders (Tr)
                      </th>
                      <th className="px-6 py-4 font-semibold text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="text-center py-8 text-gray-500"
                        >
                          Loading fleet data...
                        </td>
                      </tr>
                    ) : drivers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
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
                            {capitalizeName(driver.firstName)}{" "}
                            {capitalizeName(driver.lastName)}
                          </td>
                          <td className="px-6 py-4 text-gray-400 text-sm">
                            {driver.user?.username || driver.username || "—"}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="px-2 py-1 text-[10px] font-bold rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">
                              {driver.drCount ?? 0}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="px-2 py-1 text-[10px] font-bold rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                              {driver.trCount ?? 0}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <PermissionGuard requires="ACTION_DRIVER_RATE_EDIT">
                                <button
                                  onClick={() => openRateModal(driver)}
                                  className="bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 px-3 py-1.5 rounded text-xs font-semibold transition-colors"
                                  title="Change this driver's commission rates"
                                >
                                  Set Rate
                                </button>
                              </PermissionGuard>
                              <button
                                onClick={() =>
                                  router.push(
                                    `/drivers/${driver.driverId.toLowerCase()}`,
                                  )
                                }
                                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors"
                              >
                                View Profile
                              </button>
                            </div>
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
                        driverName: `${capitalizeName(p.driver.firstName)} ${capitalizeName(p.driver.lastName)}`,
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
                        Driver: `${capitalizeName(p.driver.firstName)} ${capitalizeName(p.driver.lastName)}`,
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
                                {capitalizeName(payout.driver.firstName)}{" "}
                                {capitalizeName(payout.driver.lastName)}
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
                                              "Date Received": o.createdAt
                                                ? new Date(
                                                    o.createdAt,
                                                  ).toLocaleDateString("en-US")
                                                : "",
                                              Customer: o.customerName,
                                              Zone: o.zone.name,
                                              "Amount USD": o.amountUsd,
                                              "Collected USD":
                                                o.collectedUsd ?? o.amountUsd,
                                              "Collected LBP":
                                                o.collectedLbp ?? o.amountLbp,
                                              "Driver Commission USD":
                                                o.driverCommissionUsd == null
                                                  ? "Rate not configured"
                                                  : o.driverCommissionUsd,
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
                                            Date Received
                                          </th>
                                          <th className="px-4 py-2 font-semibold">
                                            Tracking ID
                                          </th>
                                          <th className="px-4 py-2 font-semibold">
                                            Customer
                                          </th>
                                          <th className="px-4 py-2 font-semibold">
                                            Address
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
                                          <th className="px-4 py-2 font-semibold text-right">
                                            Collected USD
                                          </th>
                                          <th className="px-4 py-2 font-semibold text-right">
                                            Collected LBP
                                          </th>
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
                                            (order.amountUsd ?? 0) !==
                                              actualCollectedUsd ||
                                            (order.amountLbp ?? 0) !==
                                              actualCollectedLbp;
                                          return (
                                            <tr
                                              key={order.id}
                                              className={`border-b border-white/[0.03] transition-colors ${
                                                isMismatched
                                                  ? "bg-yellow-500/20"
                                                  : "hover:bg-white/[0.01]"
                                              }`}
                                            >
                                              <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
                                                {beirutDate(
                                                  order.createdAt || "",
                                                )}
                                              </td>
                                              <td className="px-4 py-2 font-mono text-cyan-400 text-xs">
                                                {order.orderId}
                                              </td>
                                              <td className="px-4 py-2 text-gray-300 text-sm">
                                                {order.customerName}
                                              </td>
                                              <td className="px-4 py-2 text-gray-500 text-xs max-w-[160px] truncate">
                                                {order.customerAddress || "—"}
                                              </td>
                                              <td className="px-4 py-2 text-gray-500 text-xs">
                                                {order.zone?.name || "—"}
                                              </td>
                                              <td className="px-4 py-2 text-green-400 text-xs text-right font-mono">
                                                $
                                                {(order.amountUsd ?? 0).toFixed(
                                                  2,
                                                )}
                                              </td>
                                              <td className="px-4 py-2 text-gray-400 text-xs text-right">
                                                {(
                                                  order.amountLbp ?? 0
                                                ).toLocaleString()}
                                              </td>
                                              <td className="px-4 py-2 text-green-300 text-xs text-right font-mono">
                                                ${actualCollectedUsd.toFixed(2)}
                                              </td>
                                              <td className="px-4 py-2 text-gray-400 text-xs text-right">
                                                {(
                                                  order.collectedLbp ?? 0
                                                ).toLocaleString()}
                                              </td>
                                            </tr>
                                          );
                                        })}
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

        {/* ── Driver Rate Editor Modal ── */}
        {rateModalDriver && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-[#121824] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <div>
                  <h3 className="text-white font-bold text-sm">
                    Edit Driver Rates
                  </h3>
                  <p className="text-gray-500 text-xs mt-0.5">
                    {capitalizeName(rateModalDriver.firstName)}{" "}
                    {capitalizeName(rateModalDriver.lastName)} (
                    {rateModalDriver.driverId})
                  </p>
                </div>
                <button
                  onClick={closeRateModal}
                  disabled={rateSaving}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-5 max-h-[65vh] overflow-y-auto">
                <p className="text-gray-400 text-xs mb-4 leading-relaxed">
                  View and change the commission rates for this driver. Zone
                  rates apply per delivery in each zone; seller exception rates
                  override zone rates for specific sellers.
                </p>

                {/* ── Zone Rates ── */}
                <h4 className="text-white font-semibold text-sm mb-2">
                  Zone Rates
                </h4>
                {zones.length === 0 ? (
                  <p className="text-gray-500 text-sm py-4 italic">
                    No zones available.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {zones.map((zone) => (
                      <div
                        key={zone.id}
                        className="flex items-center justify-between gap-4 px-4 py-2.5 rounded-lg bg-[#0B0F17] border border-white/5"
                      >
                        <span className="text-sm text-gray-300 min-w-0 truncate">
                          {zone.name}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 text-xs">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="—"
                            value={rateDraft[zone.id] ?? ""}
                            onChange={(e) =>
                              setRateDraft((prev) => ({
                                ...prev,
                                [zone.id]: e.target.value,
                              }))
                            }
                            className="w-28 px-3 py-1.5 rounded-lg bg-slate-950 text-white text-sm border border-gray-700 outline-none focus:border-cyan-500"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Seller Exception Rates ── */}
                <div className="mt-6">
                  <h4 className="text-white font-semibold text-sm mb-1">
                    Seller Exception Rates
                  </h4>
                  <p className="text-gray-500 text-xs mb-3">
                    Custom flat rates that override zone rates for specific
                    sellers.
                  </p>

                  {sellerRateRows.length === 0 ? (
                    <p className="text-gray-500 text-xs italic mb-3">
                      No seller exceptions configured.
                    </p>
                  ) : (
                    <div className="space-y-2 mb-3">
                      {sellerRateRows.map((row, index) => (
                        <div
                          key={row.merchantId}
                          className="flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-[#0B0F17] border border-white/5"
                        >
                          <span className="text-sm text-gray-300 min-w-0 truncate flex-1">
                            {row.merchantName}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500 text-xs">$</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={row.rateUsd}
                              onChange={(e) =>
                                updateSellerRateRow(index, e.target.value)
                              }
                              className="w-24 px-3 py-1.5 rounded-lg bg-slate-950 text-white text-sm border border-gray-700 outline-none focus:border-cyan-500"
                            />
                            <button
                              onClick={() => removeSellerRateRow(index)}
                              className="text-red-400 hover:text-red-300 text-sm px-1"
                              title="Remove exception"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add exception */}
                  <div className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                      <select
                        value={sellerAddMerchantId}
                        onChange={(e) => setSellerAddMerchantId(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 text-white text-sm border border-slate-700 outline-none focus:border-cyan-500"
                      >
                        <option value="">Select seller…</option>
                        {merchants
                          .filter(
                            (m) =>
                              !sellerRateRows.some(
                                (r) => r.merchantId === m.id,
                              ),
                          )
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.merchantName}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="w-24">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="$"
                        value={sellerAddRate}
                        onChange={(e) => setSellerAddRate(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 text-white text-sm border border-gray-700 outline-none focus:border-cyan-500"
                      />
                    </div>
                    <button
                      onClick={addSellerRateRow}
                      disabled={!sellerAddMerchantId || sellerAddRate === ""}
                      className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* ── Cash Seller Rates (read-only) ── */}
                {cashSellerRates.length > 0 && (
                  <div className="mt-6">
                    <h4 className="text-white font-semibold text-sm mb-1">
                      Cash Seller Rates
                    </h4>
                    <p className="text-gray-500 text-xs mb-3">
                      These take precedence for cash sellers and are managed
                      from the seller workspace.
                    </p>
                    <div className="space-y-1.5">
                      {cashSellerRates.map((cr) => (
                        <div
                          key={cr.merchantId}
                          className="flex items-center justify-between px-4 py-2 rounded-lg bg-[#0B0F17] border border-white/5 opacity-80"
                        >
                          <span className="text-sm text-gray-300">
                            {cr.merchantName}
                          </span>
                          <span className="font-mono text-cyan-300 text-sm">
                            ${cr.rateUsd.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center gap-3 px-6 py-4 border-t border-white/10">
                <button
                  onClick={closeRateModal}
                  disabled={rateSaving}
                  className="flex-1 py-2.5 rounded-lg font-bold text-sm text-gray-400 border border-white/10 hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={saveRates}
                  disabled={rateSaving}
                  className="flex-1 py-2.5 rounded-lg font-bold text-sm text-white bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 transition-colors shadow-lg shadow-cyan-500/20"
                >
                  {rateSaving ? "Saving…" : "Save Rates"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
