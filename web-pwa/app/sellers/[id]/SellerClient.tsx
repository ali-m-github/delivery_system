"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import SharedOrderTable from "@/components/SharedOrderTable";
import CashSellerWorkspace from "@/components/sellers/CashSellerWorkspace";
import ImportGoogleSheetsModal from "@/components/orders/ImportGoogleSheetsModal";

const formatDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
};

type TabKey = "ALL" | "WAREHOUSE" | "ASSIGNED" | "WD" | "WO" | "RETURN" | "PS";

interface SellerClientProps {
  merchant: any;
}
export default function SellerClient({ merchant }: SellerClientProps) {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabKey>("ALL");
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false); // Track button loading state
  const [showImportModal, setShowImportModal] = useState(false);

  // ─── Business Model Settings State ──────────────────────────────────────
  const [isEditingModel, setIsEditingModel] = useState(false);
  const [editIsCashSeller, setEditIsCashSeller] = useState(
    merchant.isCashSeller ?? false,
  );
  const [editSellerRate, setEditSellerRate] = useState(
    merchant.defaultSellerRate != null
      ? String(merchant.defaultSellerRate)
      : "",
  );
  const [editCompanyRate, setEditCompanyRate] = useState(
    merchant.defaultCompanyRate != null
      ? String(merchant.defaultCompanyRate)
      : "",
  );
  const [isSavingModel, setIsSavingModel] = useState(false);

  const handleSaveBusinessModel = useCallback(async () => {
    setIsSavingModel(true);
    try {
      const res = await fetch(`/api/sellers/${merchant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isCashSeller: editIsCashSeller,
          defaultSellerRate: editIsCashSeller
            ? parseFloat(editSellerRate) || null
            : null,
          defaultCompanyRate: editIsCashSeller
            ? parseFloat(editCompanyRate) || null
            : null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update business model");
      }

      setIsEditingModel(false);
      router.refresh();
    } catch (error: any) {
      alert(error.message || "Failed to save business model settings");
    } finally {
      setIsSavingModel(false);
    }
  }, [merchant.id, editIsCashSeller, editSellerRate, editCompanyRate, router]);

  useEffect(() => {
    setSelectedOrders([]);
  }, [activeTab]);

  const orders: any[] = useMemo(() => merchant?.orders || [], [merchant]);

  const normalizedOrders = useMemo(
    () =>
      orders.map((o: any) => ({
        ...o,
        merchant: merchant,
        financialStatus:
          o.financialStatus === "PAID_TO_MERCHANT" ? "WO" : o.financialStatus,
      })),
    [orders, merchant],
  );

  // ─── Export Excel handler ─────────────────────────────────────────────────
  const handleExportExcel = useCallback(async () => {
    if (selectedOrders.length === 0) {
      alert("Please select at least one order to export.");
      return;
    }
    const selected = normalizedOrders.filter((o) =>
      selectedOrders.includes(o.id),
    );
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Orders");
    worksheet.columns = [
      { header: "Order ID", key: "orderId", width: 20 },
      { header: "Date", key: "date", width: 15 },
      { header: "Customer", key: "customer", width: 25 },
      { header: "Phone", key: "phone", width: 18 },
      { header: "Address", key: "address", width: 30 },
      { header: "Zone", key: "zone", width: 15 },
      { header: "Location", key: "location", width: 20 },
      { header: "Fin Status", key: "finStatus", width: 15 },
      { header: "Amount USD", key: "amountUsd", width: 15 },
      { header: "Amount LBP", key: "amountLbp", width: 15 },
    ];
    selected.forEach((o) => {
      worksheet.addRow({
        orderId: o.orderId,
        date: formatDate(o.createdAt),
        customer: o.customerName || "",
        phone: o.customerPhone || "",
        address: o.customerAddress || "",
        zone: o.zone?.name || "",
        location: o.location,
        finStatus: o.financialStatus,
        amountUsd: (o.amountUsd ?? 0).toFixed(2),
        amountLbp: (o.amountLbp ?? 0).toString(),
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${merchant.merchantName}_orders.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [selectedOrders, normalizedOrders, merchant.merchantName]);

  // ─── Stat Card Calculations ─────────────────────────────────────────────
  const undeliveredOrders = normalizedOrders.filter(
    (o: any) => o.location !== "DELIVERED" && o.location !== "RETURN",
  );
  const undeliveredUsd = undeliveredOrders.reduce(
    (sum, o) => sum + (o.amountUsd ?? 0),
    0,
  );
  const undeliveredLbp = undeliveredOrders.reduce(
    (sum, o) => sum + (o.amountLbp ?? 0),
    0,
  );

  const deliveredWD = normalizedOrders.filter(
    (o: any) =>
      o.location === "DELIVERED" && ["WD", "PP"].includes(o.financialStatus),
  );
  const wdUsd = deliveredWD.reduce(
    (sum, o) => sum + (o.collectedUsd ?? o.amountUsd ?? 0),
    0,
  );
  const wdLbp = deliveredWD.reduce(
    (sum, o) => sum + (o.collectedLbp ?? o.amountLbp ?? 0),
    0,
  );

  const deliveredWO = normalizedOrders.filter(
    (o: any) => o.location === "DELIVERED" && o.financialStatus === "WO",
  );
  const woUsd = deliveredWO.reduce(
    (sum, o) => sum + (o.collectedUsd ?? o.amountUsd ?? 0),
    0,
  );
  const woLbp = deliveredWO.reduce(
    (sum, o) => sum + (o.collectedLbp ?? o.amountLbp ?? 0),
    0,
  );

  // ─── Tab Filters ────────────────────────────────────────────────────────
  const tabFilters: Record<TabKey, any[]> = useMemo(
    () => ({
      ALL: normalizedOrders,
      WAREHOUSE: normalizedOrders.filter(
        (o: any) => o.location === "WAREHOUSE",
      ),
      ASSIGNED: normalizedOrders.filter((o: any) => o.location === "ASSIGNED"),
      WD: deliveredWD,
      WO: deliveredWO,
      RETURN: normalizedOrders.filter((o: any) => o.location === "RETURN"),
      PS: normalizedOrders.filter(
        (o: any) => o.location === "DELIVERED" && o.financialStatus === "PS",
      ),
    }),
    [normalizedOrders, deliveredWD, deliveredWO],
  );

  const filteredOrders = tabFilters[activeTab];

  // ─── Checkbox Logic ─────────────────────────────────────────────────────
  const isAllSelected =
    filteredOrders.length > 0 &&
    selectedOrders.length === filteredOrders.length;

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(filteredOrders.map((o: any) => o.id));
    }
  };

  const handleSelectOrder = (id: string) => {
    setSelectedOrders((prev) =>
      prev.includes(id)
        ? prev.filter((orderId) => orderId !== id)
        : [...prev, id],
    );
  };

  // ─── Live Settlement Calculator (WO Tab) ────────────────────────────────
  const selectedWOData = useMemo(() => {
    if (activeTab !== "WO" || selectedOrders.length === 0) return null;

    const checkedOrders = filteredOrders.filter((o: any) =>
      selectedOrders.includes(o.id),
    );

    let totalUsd = 0;
    let totalLbp = 0;
    let shippingUsd = 0;
    let shippingLbp = 0;

    checkedOrders.forEach((order: any) => {
      totalUsd += order.collectedUsd ?? order.amountUsd ?? 0;
      totalLbp += order.collectedLbp ?? order.amountLbp ?? 0;

      const rate = merchant.zoneRates?.find(
        (zr: any) =>
          String(zr.zoneId) === String(order.zoneId) ||
          String(zr.zone?.name) === String(order.zone?.name) ||
          String(zr.zoneId) === String(order.zone?.name),
      );

      if (rate) {
        shippingUsd += rate.rateUsd ?? rate.rate ?? rate.price ?? 0;
        shippingLbp += rate.rateLbp ?? 0;
      }
    });

    return {
      count: checkedOrders.length,
      totalUsd,
      totalLbp,
      shippingUsd,
      shippingLbp,
      netUsd: totalUsd - shippingUsd,
      netLbp: totalLbp - shippingLbp,
    };
  }, [selectedOrders, filteredOrders, activeTab, merchant.zoneRates]);

  // ─── Execute Payout Transaction ─────────────────────────────────────────
  const handlePayout = async () => {
    if (!selectedWOData || selectedOrders.length === 0) return;

    if (
      !confirm(
        `Generate payout statement for ${selectedWOData.count} orders?\nNet Payout: $${selectedWOData.netUsd.toFixed(2)} | ${selectedWOData.netLbp.toLocaleString()} LL`,
      )
    ) {
      return;
    }

    setIsProcessing(true);

    try {
      const res = await fetch("/api/statements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: merchant.id,
          orderIds: selectedOrders,
          totalUsd: selectedWOData.totalUsd,
          totalLbp: selectedWOData.totalLbp,
          shippingUsd: selectedWOData.shippingUsd,
          shippingLbp: selectedWOData.shippingLbp,
          netUsd: selectedWOData.netUsd,
          netLbp: selectedWOData.netLbp,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to generate statement");
      }

      alert("Payout Statement Generated Successfully!");

      // Clear selections and reload the page to fetch the fresh database state
      setSelectedOrders([]);
      window.location.reload();
    } catch (error: any) {
      console.error(error);
      alert(error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "ALL", label: "All Orders" },
    { key: "WAREHOUSE", label: "Warehouse" },
    { key: "ASSIGNED", label: "Dr (Assigned)" },
    { key: "WD", label: "WD (With Driver)" },
    { key: "WO", label: "WO (With Office)" },
    { key: "RETURN", label: "Returns" },
    { key: "PS", label: "PS (Paid to Seller)" },
  ];

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white p-6 font-sans">
      <div className="max-w-[1400px] mx-auto">
        {/* ── Header ── */}
        <div className="flex justify-between items-start mb-6 border-b border-white/10 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">
              {merchant.merchantName}
            </h1>
            <p className="text-gray-400 text-sm mt-2">
              <span className="bg-[#121824] px-2 py-1 rounded border border-white/5 mr-2 font-mono text-cyan-400">
                ID: {merchant.merchantId}
              </span>
              Phone: {merchant.phone || "N/A"} &middot; Address:{" "}
              {merchant.address || "N/A"}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() =>
                  window.open(`/statements?merchantId=${merchant.id}`, "_blank")
                }
                className="px-3 py-1.5 text-xs font-bold bg-white/5 text-gray-300 border border-white/10 rounded hover:bg-white/10 transition-colors"
              >
                View Historical Statements
              </button>
              <button
                onClick={() => setShowImportModal(true)}
                className="px-3 py-1.5 text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded hover:bg-cyan-500/20 transition-colors"
              >
                Import Orders from Google Sheets
              </button>
            </div>
          </div>
        </div>

        {/* ── Business Model Settings ── */}
        <div className="mb-6 bg-[#121824] border border-white/5 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-white font-semibold text-sm">
                Business Model Settings
              </h3>
              <p className="text-gray-500 text-xs mt-0.5">
                Configure how this seller handles payments and factoring.
              </p>
            </div>
            {!isEditingModel && (
              <button
                onClick={() => {
                  setEditIsCashSeller(merchant.isCashSeller ?? false);
                  setEditSellerRate(
                    merchant.defaultSellerRate != null
                      ? String(merchant.defaultSellerRate)
                      : "",
                  );
                  setEditCompanyRate(
                    merchant.defaultCompanyRate != null
                      ? String(merchant.defaultCompanyRate)
                      : "",
                  );
                  setIsEditingModel(true);
                }}
                className="px-3 py-1.5 text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-lg hover:bg-cyan-500/20 transition-colors"
              >
                {merchant.isCashSeller ? "Edit Settings" : "Configure"}
              </button>
            )}
          </div>

          {/* Read-only summary when not editing */}
          {!isEditingModel && (
            <div className="mt-3 flex items-center gap-4">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                  merchant.isCashSeller
                    ? "bg-green-500/10 text-green-400 border-green-500/20"
                    : "bg-gray-500/10 text-gray-400 border-gray-500/20"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    merchant.isCashSeller ? "bg-green-400" : "bg-gray-500"
                  }`}
                />
                {merchant.isCashSeller
                  ? "Prepaid (Cash Seller)"
                  : "Postpaid (Standard COD)"}
              </span>
              {merchant.isCashSeller && (
                <>
                  <span className="text-xs text-gray-500">
                    Seller Rate:{" "}
                    <span className="text-cyan-400 font-mono">
                      ${(merchant.defaultSellerRate ?? 0).toFixed(2)}
                    </span>
                  </span>
                  <span className="text-xs text-gray-500">
                    Company Rate:{" "}
                    <span className="text-yellow-400 font-mono">
                      ${(merchant.defaultCompanyRate ?? 0).toFixed(2)}
                    </span>
                  </span>
                </>
              )}
            </div>
          )}

          {/* Inline editing form */}
          {isEditingModel && (
            <div className="mt-4 space-y-4">
              {/* Toggle Switch */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editIsCashSeller}
                  onChange={(e) => setEditIsCashSeller(e.target.checked)}
                  className="rounded border-gray-700 bg-[#0B0F17] text-cyan-500 focus:ring-cyan-500/50 cursor-pointer w-4 h-4"
                />
                <span className="text-sm font-medium text-gray-300">
                  Enable Prepaid (Cash Seller) Factoring
                </span>
              </label>

              {/* Conditional Rate Inputs */}
              {editIsCashSeller && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 ml-7 p-4 bg-cyan-500/5 border border-cyan-500/10 rounded-lg">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                      Default Seller Rate ($USD)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="$4.00"
                      value={editSellerRate}
                      onChange={(e) => setEditSellerRate(e.target.value)}
                      className="w-full bg-[#0B0F17] border border-gray-800 rounded-lg p-2.5 text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors text-sm"
                    />
                    <p className="text-[10px] text-gray-600 mt-1">
                      Fee charged to seller per order
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                      Default Company Cost Rate ($USD)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="$3.00"
                      value={editCompanyRate}
                      onChange={(e) => setEditCompanyRate(e.target.value)}
                      className="w-full bg-[#0B0F17] border border-gray-800 rounded-lg p-2.5 text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-colors text-sm"
                    />
                    <p className="text-[10px] text-gray-600 mt-1">
                      Baseline delivery cost / target margin
                    </p>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setIsEditingModel(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveBusinessModel}
                  disabled={isSavingModel}
                  className="bg-cyan-500 hover:bg-cyan-400 text-[#0B0F17] font-bold px-5 py-2 rounded-lg transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)] disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {isSavingModel ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Cash Seller Factoring Workspace ── */}
        {merchant.isCashSeller && (
          <CashSellerWorkspace
            merchantId={merchant.id}
            defaultSellerRate={merchant.defaultSellerRate ?? 4.0}
          />
        )}

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-[#121824] border border-white/5 rounded-xl p-5">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
              Undelivered Orders
            </p>
            <p className="text-white text-lg font-bold">
              {undeliveredOrders.length} orders
            </p>
            <div className="flex gap-3 mt-1 text-xs">
              <span className="text-green-400 font-mono">
                ${undeliveredUsd.toFixed(2)}
              </span>
              <span className="text-yellow-400 font-mono">
                {undeliveredLbp.toLocaleString()} LL
              </span>
            </div>
          </div>

          <div className="bg-[#121824] border border-white/5 rounded-xl p-5 flex flex-col justify-between">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">
              Delivered Orders
            </p>
            <div className="flex divide-x divide-white/10">
              <div className="pr-4 flex-1">
                <p className="text-cyan-400 text-xs font-bold mb-1">
                  WITH DRIVER (WD)
                </p>
                <div className="text-xs font-mono text-gray-300">
                  <div>${wdUsd.toFixed(2)}</div>
                  <div className="text-yellow-400/80">
                    {wdLbp.toLocaleString()} LL
                  </div>
                </div>
              </div>
              <div className="pl-4 flex-1">
                <p className="text-orange-400 text-xs font-bold mb-1">
                  WITH OFFICE (WO)
                </p>
                <div className="text-xs font-mono text-gray-300">
                  <div>${woUsd.toFixed(2)}</div>
                  <div className="text-yellow-400/80">
                    {woLbp.toLocaleString()} LL
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Tab Navigation ── */}
        <div className="flex gap-1 mb-4 border-b border-white/10 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-3 text-sm font-semibold rounded-t-lg transition-colors whitespace-nowrap ${
                activeTab === key
                  ? "bg-[#121824] text-cyan-400 border border-white/10 border-b-[#121824] -mb-[1px]"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]"
              }`}
            >
              {label}
              <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                {tabFilters[key].length}
              </span>
            </button>
          ))}
        </div>

        {/* ── Settlement Action Bar (WO Only) ── */}
        {selectedWOData && (
          <div className="bg-gradient-to-r from-orange-500/10 to-[#121824] border border-orange-500/20 rounded-xl p-4 mb-4 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
            <div className="flex gap-6">
              <div>
                <p className="text-gray-500 text-[10px] uppercase font-bold tracking-wider">
                  Orders Selected
                </p>
                <p className="text-white font-mono text-lg">
                  {selectedWOData.count}
                </p>
              </div>
              <div>
                <p className="text-gray-500 text-[10px] uppercase font-bold tracking-wider">
                  Collected
                </p>
                <p className="text-green-400 font-mono text-sm">
                  ${selectedWOData.totalUsd.toFixed(2)}
                </p>
                <p className="text-yellow-400 font-mono text-xs">
                  {selectedWOData.totalLbp.toLocaleString()} LL
                </p>
              </div>
              <div>
                <p className="text-gray-500 text-[10px] uppercase font-bold tracking-wider">
                  Shipping Fee (-)
                </p>
                <p className="text-red-400 font-mono text-sm">
                  -${selectedWOData.shippingUsd.toFixed(2)}
                </p>
                <p className="text-red-400 font-mono text-xs">
                  -{selectedWOData.shippingLbp.toLocaleString()} LL
                </p>
              </div>
              <div className="pl-4 border-l border-white/10">
                <p className="text-cyan-400 text-[10px] uppercase font-bold tracking-wider">
                  Net Payout
                </p>
                <p className="text-green-400 font-mono text-lg font-bold">
                  ${selectedWOData.netUsd.toFixed(2)}
                </p>
                <p className="text-yellow-400 font-mono text-sm font-bold">
                  {selectedWOData.netLbp.toLocaleString()} LL
                </p>
              </div>
            </div>
            <button
              onClick={handlePayout}
              disabled={isProcessing}
              className="bg-cyan-500 hover:bg-cyan-400 text-[#0B0F17] font-bold py-2 px-6 rounded-lg transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? "Processing..." : "Pay To Seller"}
            </button>
          </div>
        )}

        {/* ── Export Buttons ── */}
        {selectedOrders.length > 0 && (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-gray-400 mr-1">
              {selectedOrders.length} selected
            </span>
            <button
              onClick={() =>
                window.open(
                  `/print/orders?ids=${selectedOrders.join(",")}`,
                  "_blank",
                )
              }
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
              title="Open in new tab"
            >
              🔗 New Tab
            </button>
            <button
              onClick={handleExportExcel}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-colors"
              title="Download as Excel"
            >
              📊 Excel
            </button>
            <button
              onClick={() =>
                window.open(
                  `/orders/print?ids=${selectedOrders.join(",")}&pdf=true`,
                  "_blank",
                )
              }
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
              title="Download as PDF"
            >
              📑 PDF
            </button>
          </div>
        )}

        {/* ── Shared Order Table ── */}
        <SharedOrderTable
          orders={filteredOrders}
          selectedOrderIds={selectedOrders}
          onToggleSelectOrder={handleSelectOrder}
          onToggleSelectAll={handleSelectAll}
          isAllSelected={isAllSelected}
        />
      </div>

      {/* ── Import Google Sheets Modal ── */}
      {showImportModal && (
        <ImportGoogleSheetsModal
          merchantId={merchant.merchantId}
          savedConfig={
            typeof merchant.sheetImportConfig === "string"
              ? JSON.parse(merchant.sheetImportConfig)
              : merchant.sheetImportConfig
          }
          onSuccess={() => {
            setShowImportModal(false);
            router.refresh();
          }}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}
