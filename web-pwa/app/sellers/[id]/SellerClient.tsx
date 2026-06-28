"use client";

import { useState, useMemo, useEffect } from "react";
import SharedOrderTable from "@/components/SharedOrderTable";

type TabKey = "ALL" | "WAREHOUSE" | "ASSIGNED" | "WD" | "WO" | "RETURN" | "PS";

interface SellerClientProps {
  merchant: any;
}

export default function SellerClient({ merchant }: SellerClientProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("ALL");
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false); // Track button loading state

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

  // ─── Stat Card Calculations ─────────────────────────────────────────────
  const undeliveredOrders = normalizedOrders.filter(
    (o: any) => o.location !== "DELIVERED" && o.location !== "RETURN",
  );
  const undeliveredUsd = undeliveredOrders.reduce(
    (sum, o) => sum + (o.amountUsd || 0),
    0,
  );
  const undeliveredLbp = undeliveredOrders.reduce(
    (sum, o) => sum + (o.amountLbp || 0),
    0,
  );

  const deliveredWD = normalizedOrders.filter(
    (o: any) =>
      o.location === "DELIVERED" && ["WD", "PP"].includes(o.financialStatus),
  );
  const wdUsd = deliveredWD.reduce(
    (sum, o) => sum + (o.collectedUsd || o.amountUsd || 0),
    0,
  );
  const wdLbp = deliveredWD.reduce(
    (sum, o) => sum + (o.collectedLbp || o.amountLbp || 0),
    0,
  );

  const deliveredWO = normalizedOrders.filter(
    (o: any) => o.location === "DELIVERED" && o.financialStatus === "WO",
  );
  const woUsd = deliveredWO.reduce(
    (sum, o) => sum + (o.collectedUsd || o.amountUsd || 0),
    0,
  );
  const woLbp = deliveredWO.reduce(
    (sum, o) => sum + (o.collectedLbp || o.amountLbp || 0),
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
      totalUsd += order.collectedUsd || order.amountUsd || 0;
      totalLbp += order.collectedLbp || order.amountLbp || 0;

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
            <button
              onClick={() =>
                window.open(`/statements?merchantId=${merchant.id}`, "_blank")
              }
              className="mt-4 px-3 py-1.5 text-xs font-bold bg-white/5 text-gray-300 border border-white/10 rounded hover:bg-white/10 transition-colors"
            >
              View Historical Statements
            </button>
          </div>
        </div>

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

        {/* ── Shared Order Table ── */}
        <SharedOrderTable
          orders={filteredOrders}
          selectedOrderIds={selectedOrders}
          onToggleSelectOrder={handleSelectOrder}
          onToggleSelectAll={handleSelectAll}
          isAllSelected={isAllSelected}
        />
      </div>
    </div>
  );
}
