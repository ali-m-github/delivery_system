"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";

type Tab = "assigned" | "delivered" | "returns" | "payouts";

export default function DriverProfilePage() {
  const params = useParams();
  const router = useRouter();
  const driverId = params.id as string;

  const [driver, setDriver] = useState<any>(null);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("assigned");
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedPayout, setSelectedPayout] = useState<any>(null);
  const [approving, setApproving] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [clearing, setClearing] = useState(false);

  // ─── Data Fetching ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/admin/drivers/${driverId}`)
      .then((res) => res.json())
      .then((data) => {
        setDriver(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch(`/api/drivers/${driverId}/payouts`)
      .then((res) => res.json())
      .then((data) => setPayouts(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [driverId]);

  // ─── Derived Data ───────────────────────────────────────────────────────
  const deliveries: any[] = driver?.deliveries || [];

  const assignedOrders = useMemo(
    () =>
      deliveries.filter(
        (o: any) => o.location !== "DELIVERED" && o.location !== "RETURN",
      ),
    [deliveries],
  );

  const deliveredOrders = useMemo(
    () =>
      deliveries.filter(
        (o: any) => o.location === "DELIVERED" && o.financialStatus === "WD",
      ),
    [deliveries],
  );

  const returnedOrders = useMemo(
    () =>
      deliveries.filter(
        (o: any) => o.location === "RETURN" || o.financialStatus === "Re",
      ),
    [deliveries],
  );

  // ─── Financial Aggregates ───────────────────────────────────────────────
  const assignedUsdSum = assignedOrders.reduce(
    (sum: number, o: any) => sum + (o.amountUsd || 0),
    0,
  );
  const assignedLbpSum = assignedOrders.reduce(
    (sum: number, o: any) => sum + (o.amountLbp || 0),
    0,
  );

  const totalDeliveredUsd = deliveredOrders.reduce(
    (sum: number, o: any) => sum + (o.amountUsd || 0),
    0,
  );
  const totalDeliveredLbp = deliveredOrders.reduce(
    (sum: number, o: any) => sum + (o.amountLbp || 0),
    0,
  );

  // ─── Zone-Based Commission Calculation ─────────────────────────────────
  const driverZoneRates: {
    zoneId: string;
    zone: { id: string; name: string } | null;
    rate: number;
  }[] = driver?.zoneRates || [];

  const zoneRateMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const zr of driverZoneRates) {
      map.set(zr.zoneId, zr.rate);
    }
    return map;
  }, [driverZoneRates]);

  const totalCommission = useMemo(() => {
    return deliveredOrders.reduce((sum: number, o: any) => {
      const rate = zoneRateMap.get(o.zoneId) ?? 0;
      return sum + rate;
    }, 0);
  }, [deliveredOrders, zoneRateMap]);

  const netPayoutUsd = totalDeliveredUsd - totalCommission;

  // ─── Settlement Calculator for Selected WD Orders ─────────────────────
  const selectedWdOrders = useMemo(
    () => deliveredOrders.filter((o: any) => selectedOrders.includes(o.id)),
    [deliveredOrders, selectedOrders],
  );

  const settlement = useMemo(() => {
    const totalCollectedUsd = selectedWdOrders.reduce(
      (sum: number, o: any) => sum + (o.collectedUsd || o.amountUsd || 0),
      0,
    );
    const totalCollectedLbp = selectedWdOrders.reduce(
      (sum: number, o: any) => sum + (o.collectedLbp || o.amountLbp || 0),
      0,
    );
    const commission = selectedWdOrders.reduce((sum: number, o: any) => {
      const rate = zoneRateMap.get(o.zoneId) ?? 0;
      return sum + rate;
    }, 0);
    const net = totalCollectedUsd - commission;
    return { totalCollectedUsd, totalCollectedLbp, commission, net };
  }, [selectedWdOrders, zoneRateMap]);

  // ─── Payout Submission ──────────────────────────────────────────────────
  const handleGeneratePayout = async () => {
    setSubmitting(true);
    try {
      const orderIds = deliveredOrders.map((o: any) => o.id);
      const res = await fetch(`/api/drivers/${driverId}/payouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds,
          commissionUsd: totalCommission,
          netUsd: netPayoutUsd,
        }),
      });
      if (res.ok) {
        setShowPayoutModal(false);
        await refreshData();
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Clear With Office ─────────────────────────────────────────────────
  const handleClearWithOffice = async () => {
    if (selectedWdOrders.length === 0) return;
    setClearing(true);
    try {
      const orderIds = selectedWdOrders.map((o: any) => o.id);
      const res = await fetch("/api/driver-payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId,
          orderIds,
          totalCollectedUsd: settlement.totalCollectedUsd,
          totalCollectedLbp: settlement.totalCollectedLbp,
          commissionUsd: settlement.commission,
          netUsd: settlement.net,
        }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } finally {
      setClearing(false);
    }
  };

  // ─── Shared Data Refresh ───────────────────────────────────────────────
  const refreshData = async () => {
    const [driverRes, payoutsRes] = await Promise.all([
      fetch(`/api/admin/drivers/${driverId}`),
      fetch(`/api/drivers/${driverId}/payouts`),
    ]);
    setDriver(await driverRes.json());
    setPayouts(await payoutsRes.json());
  };

  // ─── Bulk Selection Helpers ──────────────────────────────────────────────
  const toggleSelection = (orderId: string) => {
    setSelectedOrders((prev) =>
      prev.includes(orderId)
        ? prev.filter((id) => id !== orderId)
        : [...prev, orderId],
    );
  };

  const toggleSelectAll = (orderIds: string[]) => {
    if (selectedOrders.length === orderIds.length && orderIds.length > 0) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(orderIds);
    }
  };

  // ─── Bulk Action Handler ────────────────────────────────────────────────
  const handleBulkAction = async (newLocation: string) => {
    await Promise.all(
      selectedOrders.map((orderId) =>
        fetch(`/api/orders/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: orderId, location: newLocation }),
        }),
      ),
    );
    setSelectedOrders([]);
    await refreshData();
  };

  // ─── Approve Payout ────────────────────────────────────────────────────
  const handleApprovePayout = async () => {
    if (!selectedPayout) return;
    setApproving(true);
    try {
      const res = await fetch(
        `/api/drivers/${driverId}/payouts/${selectedPayout.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "CLEARED" }),
        },
      );
      if (res.ok) {
        setSelectedPayout(null);
        await refreshData();
      }
    } finally {
      setApproving(false);
    }
  };

  // ─── Loading State ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F17] p-8 text-cyan-400 font-sans flex items-center justify-center">
        <p className="animate-pulse">Loading Driver Profile…</p>
      </div>
    );
  }

  // ─── Error / Not Found ──────────────────────────────────────────────────
  if (!driver || driver.error) {
    return (
      <div className="min-h-screen bg-[#0B0F17] p-8 text-red-500 font-sans flex flex-col items-center justify-center gap-4">
        <p className="text-lg">Driver Not Found</p>
        <button
          onClick={() => router.push("/drivers")}
          className="px-4 py-2 rounded border border-gray-700 text-gray-400 hover:bg-slate-800 transition-colors text-sm"
        >
          ← Back to Fleet
        </button>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0B0F17] text-white p-6 font-sans">
      <div className="max-w-7xl mx-auto">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex justify-between items-start mb-6 border-b border-white/10 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">
              {driver.firstName} {driver.lastName}
            </h1>
            <p className="text-gray-400 text-sm mt-2">
              <span className="bg-[#121824] px-2 py-1 rounded border border-white/5 mr-2 font-mono text-cyan-400">
                ID: {driver.driverId || driver.id.slice(0, 8)}
              </span>
              {driver.user?.username && (
                <span className="text-gray-500">@{driver.user.username}</span>
              )}
            </p>
          </div>
          <button
            onClick={() => router.push("/drivers")}
            className="px-4 py-2 rounded text-gray-400 hover:bg-slate-800 transition-colors border border-white/10 text-sm"
          >
            ← Back to Fleet
          </button>
        </div>

        {/* ── Top Metrics Bar ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-[#121824] border border-white/5 rounded-xl p-5">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
              Driver
            </p>
            <p className="text-white text-lg font-bold">
              {driver.firstName} {driver.lastName}
            </p>
            <p className="text-gray-500 text-xs mt-0.5">
              ID: {driver.driverId || driver.id.slice(0, 8)}
            </p>
          </div>
          <div className="bg-[#121824] border border-white/5 rounded-xl p-5">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
              Assigned Orders
            </p>
            <p className="text-cyan-400 text-2xl font-bold">
              {assignedOrders.length}
            </p>
            <div className="flex gap-3 mt-1 text-xs">
              <span className="text-green-400 font-mono">
                ${assignedUsdSum.toFixed(2)}
              </span>
              <span className="text-yellow-400 font-mono">
                {assignedLbpSum.toLocaleString()} LL
              </span>
            </div>
          </div>
          <div className="bg-[#121824] border border-white/5 rounded-xl p-5">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
              Delivered Orders
            </p>
            <p className="text-green-400 text-2xl font-bold">
              {deliveredOrders.length}
            </p>
            <div className="flex gap-3 mt-1 text-xs">
              <span className="text-green-400 font-mono">
                ${totalDeliveredUsd.toFixed(2)}
              </span>
              <span className="text-yellow-400 font-mono">
                {totalDeliveredLbp.toLocaleString()} LL
              </span>
            </div>
          </div>
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-6 border-b border-white/10">
          {(
            [
              ["assigned", "Assigned"],
              ["delivered", "Delivered"],
              ["returns", "Returns"],
              ["payouts", `Pending Payouts (${payouts.length})`],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-5 py-3 text-sm font-semibold rounded-t-lg transition-colors ${
                activeTab === key
                  ? "bg-[#121824] text-cyan-400 border border-white/10 border-b-[#121824] -mb-[1px]"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]"
              }`}
            >
              {label}
              {key === "assigned" && (
                <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  {assignedOrders.length}
                </span>
              )}
              {key === "delivered" && (
                <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-green-500/10 text-green-400 border border-green-500/20">
                  {deliveredOrders.length}
                </span>
              )}
              {key === "returns" && (
                <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-red-500/10 text-red-400 border border-red-500/20">
                  {returnedOrders.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab: Assigned Orders ───────────────────────────────────── */}
        {activeTab === "assigned" && (
          <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
            {/* ── Bulk Action Toolbar ──────────────────────────────────── */}
            {selectedOrders.length > 0 && (
              <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-cyan-500/5">
                <span className="text-sm text-gray-400">
                  {selectedOrders.length} selected
                </span>
                <button
                  onClick={() => handleBulkAction("DELIVERED")}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-500/20"
                >
                  🚚 Deliver
                </button>
                <button
                  onClick={() => handleBulkAction("WAREHOUSE")}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-yellow-600 hover:bg-yellow-500 transition-colors shadow-lg shadow-yellow-500/20"
                >
                  📦 Return to Warehouse
                </button>
                <button
                  onClick={() => handleBulkAction("RETURN")}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-500 transition-colors shadow-lg shadow-red-500/20"
                >
                  ↩ Return
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-5 py-4 font-semibold w-10">
                      <input
                        type="checkbox"
                        checked={
                          assignedOrders.length > 0 &&
                          selectedOrders.length === assignedOrders.length
                        }
                        onChange={() =>
                          toggleSelectAll(assignedOrders.map((o: any) => o.id))
                        }
                        className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                      />
                    </th>
                    <th className="px-5 py-4 font-semibold">Tracking ID</th>
                    <th className="px-5 py-4 font-semibold">Customer</th>
                    <th className="px-5 py-4 font-semibold">Zone</th>
                    <th className="px-5 py-4 font-semibold">Location</th>
                    <th className="px-5 py-4 font-semibold text-right">
                      $ Amt
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      LL Amt
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {assignedOrders.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="text-center py-10 text-gray-500 italic"
                      >
                        No active assignments for this driver.
                      </td>
                    </tr>
                  ) : (
                    assignedOrders.map((order: any) => (
                      <tr
                        key={order.id}
                        className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="px-5 py-3.5">
                          <input
                            type="checkbox"
                            checked={selectedOrders.includes(order.id)}
                            onChange={() => toggleSelection(order.id)}
                            className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                          />
                        </td>
                        <td className="px-5 py-3.5 font-mono text-cyan-400 text-sm">
                          {order.orderId}
                        </td>
                        <td className="px-5 py-3.5 text-white text-sm">
                          {order.customerName}
                        </td>
                        <td className="px-5 py-3.5 text-gray-400 text-sm">
                          {order.zone?.name || "—"}
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={`px-2 py-1 text-[10px] font-bold rounded border ${
                              order.location === "WITH_DRIVER"
                                ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                : order.location === "WAREHOUSE"
                                  ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                                  : "bg-gray-500/10 text-gray-400 border-gray-500/20"
                            }`}
                          >
                            {order.location}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right text-green-400 font-mono text-sm">
                          ${(order.amountUsd || 0).toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                          {(order.amountLbp || 0).toLocaleString()} LL
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Tab: Delivered ─────────────────────────────────────────── */}
        {activeTab === "delivered" && (
          <>
            {deliveredOrders.length > 0 && (
              <div className="mb-4 flex items-center gap-3">
                <button
                  onClick={() => setShowPayoutModal(true)}
                  className="px-5 py-2.5 rounded-lg font-bold text-white bg-cyan-600 hover:bg-cyan-500 transition-colors text-sm shadow-lg shadow-cyan-500/20"
                >
                  ⚡ Generate Payout Batch
                </button>
              </div>
            )}

            <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
              {/* ── Settlement Action Bar (sticky) ────────────────────────── */}
              {selectedWdOrders.length > 0 && (
                <div className="sticky top-0 z-10 flex flex-wrap items-center gap-4 px-5 py-4 border-b border-white/10 bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 backdrop-blur-md">
                  <span className="text-sm text-gray-300 font-semibold">
                    {selectedWdOrders.length} selected
                  </span>

                  <div className="flex items-center gap-4 text-xs font-mono ml-auto">
                    <div className="text-center">
                      <p className="text-gray-500">Total Collected</p>
                      <p className="text-green-400 font-bold">
                        ${settlement.totalCollectedUsd.toFixed(2)}
                      </p>
                      <p className="text-yellow-400">
                        {settlement.totalCollectedLbp.toLocaleString()} LL
                      </p>
                    </div>

                    <span className="text-gray-600">−</span>

                    <div className="text-center">
                      <p className="text-gray-500">Commission</p>
                      <p className="text-red-400 font-bold">
                        −${settlement.commission.toFixed(2)}
                      </p>
                    </div>

                    <span className="text-gray-600">=</span>

                    <div className="text-center">
                      <p className="text-gray-500">Net to Office</p>
                      <p className="text-cyan-400 font-bold text-sm">
                        ${settlement.net.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleClearWithOffice}
                    disabled={clearing}
                    className="px-5 py-2 rounded-lg font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors text-sm shadow-lg shadow-emerald-500/20 ml-4"
                  >
                    {clearing ? "Clearing…" : "✓ Clear With Office"}
                  </button>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                      <th className="px-5 py-4 font-semibold w-10">
                        <input
                          type="checkbox"
                          checked={
                            deliveredOrders.length > 0 &&
                            selectedOrders.length ===
                              deliveredOrders.filter(
                                (o: any) => !o.driverPayoutId,
                              ).length
                          }
                          onChange={() =>
                            toggleSelectAll(
                              deliveredOrders
                                .filter((o: any) => !o.driverPayoutId)
                                .map((o: any) => o.id),
                            )
                          }
                          className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                        />
                      </th>
                      <th className="px-5 py-4 font-semibold">Tracking ID</th>
                      <th className="px-5 py-4 font-semibold">Customer</th>
                      <th className="px-5 py-4 font-semibold">Zone</th>
                      <th className="px-5 py-4 font-semibold">Fin. Status</th>
                      <th className="px-5 py-4 font-semibold text-right">
                        $ Amt
                      </th>
                      <th className="px-5 py-4 font-semibold text-right">
                        LL Amt
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveredOrders.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="text-center py-10 text-gray-500 italic"
                        >
                          No delivered orders awaiting payout.
                        </td>
                      </tr>
                    ) : (
                      deliveredOrders.map((order: any) => {
                        const isPayoutLocked = !!order.driverPayoutId;
                        return (
                          <tr
                            key={order.id}
                            className={`border-b border-white/5 hover:bg-white/[0.02] transition-colors ${
                              isPayoutLocked ? "opacity-50" : ""
                            }`}
                          >
                            <td className="px-5 py-3.5">
                              <input
                                type="checkbox"
                                checked={selectedOrders.includes(order.id)}
                                onChange={() => toggleSelection(order.id)}
                                disabled={isPayoutLocked}
                                className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0 disabled:opacity-30 disabled:cursor-not-allowed"
                              />
                            </td>
                            <td className="px-5 py-3.5 font-mono text-cyan-400 text-sm">
                              {order.orderId}
                            </td>
                            <td className="px-5 py-3.5 text-white text-sm">
                              {order.customerName}
                            </td>
                            <td className="px-5 py-3.5 text-gray-400 text-sm">
                              {order.zone?.name || "—"}
                            </td>
                            <td className="px-5 py-3.5">
                              <span className="px-2 py-1 text-[10px] font-bold rounded bg-green-500/10 text-green-400 border border-green-500/20">
                                {order.financialStatus}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-right text-green-400 font-mono text-sm">
                              ${(order.amountUsd || 0).toFixed(2)}
                            </td>
                            <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                              {(order.amountLbp || 0).toLocaleString()} LL
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── Tab: Returns ───────────────────────────────────────────── */}
        {activeTab === "returns" && (
          <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-5 py-4 font-semibold">Tracking ID</th>
                    <th className="px-5 py-4 font-semibold">Customer</th>
                    <th className="px-5 py-4 font-semibold">Zone</th>
                    <th className="px-5 py-4 font-semibold">Location</th>
                    <th className="px-5 py-4 font-semibold">Fin. Status</th>
                    <th className="px-5 py-4 font-semibold text-right">
                      $ Amt
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      LL Amt
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {returnedOrders.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="text-center py-10 text-gray-500 italic"
                      >
                        No returned orders for this driver.
                      </td>
                    </tr>
                  ) : (
                    returnedOrders.map((order: any) => (
                      <tr
                        key={order.id}
                        className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="px-5 py-3.5 font-mono text-cyan-400 text-sm">
                          {order.orderId}
                        </td>
                        <td className="px-5 py-3.5 text-white text-sm">
                          {order.customerName}
                        </td>
                        <td className="px-5 py-3.5 text-gray-400 text-sm">
                          {order.zone?.name || "—"}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="px-2 py-1 text-[10px] font-bold rounded bg-red-500/10 text-red-400 border border-red-500/20">
                            {order.location}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="px-2 py-1 text-[10px] font-bold rounded bg-red-500/10 text-red-400 border border-red-500/20">
                            {order.financialStatus}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right text-red-400 font-mono text-sm">
                          ${(order.amountUsd || 0).toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                          {(order.amountLbp || 0).toLocaleString()} LL
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Tab: Pending Payouts ───────────────────────────────────── */}
        {activeTab === "payouts" && (
          <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-5 py-4 font-semibold">Payout ID</th>
                    <th className="px-5 py-4 font-semibold">Date</th>
                    <th className="px-5 py-4 font-semibold">Status</th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Total USD
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Total LBP
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Commission
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Net USD
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Orders
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="text-center py-10 text-gray-500 italic"
                      >
                        No pending payout batches for this driver.
                      </td>
                    </tr>
                  ) : (
                    payouts.map((payout: any) => (
                      <tr
                        key={payout.id}
                        className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="px-5 py-3.5 font-mono text-cyan-400 text-sm">
                          {driver.driverId}-
                          {String(payout.sequentialIndex || 1).padStart(2, "0")}
                        </td>
                        <td className="px-5 py-3.5 text-gray-300 text-sm">
                          {new Date(payout.createdAt).toLocaleString("en-US", {
                            timeZone: "Asia/Beirut",
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="px-2 py-1 text-[10px] font-bold rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                            {payout.status}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right text-green-400 font-mono text-sm">
                          ${(payout.totalUsd || 0).toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                          {(payout.totalLbp || 0).toLocaleString()} LL
                        </td>
                        <td className="px-5 py-3.5 text-right text-red-400 font-mono text-sm">
                          -${(payout.commissionUsd || 0).toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 text-right text-cyan-400 font-mono text-sm">
                          ${(payout.netUsd || 0).toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 text-right text-gray-400 text-sm">
                          {payout.orders?.length || 0}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            onClick={() => setSelectedPayout(payout)}
                            className="px-3 py-1.5 rounded text-xs font-semibold bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-600/40 transition-colors"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── View Payout Details Modal ───────────────────────────────── */}
        {selectedPayout && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-[#121824] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 mx-4">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    Payout Details
                  </h2>
                  <p className="text-gray-400 text-sm mt-1">
                    {driver.driverId}-
                    {String(selectedPayout.sequentialIndex || 1).padStart(
                      2,
                      "0",
                    )}{" "}
                    &middot;{" "}
                    {new Date(selectedPayout.createdAt).toLocaleString(
                      "en-US",
                      {
                        timeZone: "Asia/Beirut",
                        dateStyle: "medium",
                        timeStyle: "short",
                      },
                    )}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedPayout(null)}
                  className="text-gray-500 hover:text-white transition-colors text-xl leading-none"
                >
                  ✕
                </button>
              </div>

              {/* Financial Summary */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Total USD
                  </p>
                  <p className="text-green-400 font-mono text-sm font-bold">
                    ${(selectedPayout.totalUsd || 0).toFixed(2)}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Commission
                  </p>
                  <p className="text-red-400 font-mono text-sm font-bold">
                    -${(selectedPayout.commissionUsd || 0).toFixed(2)}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Net USD
                  </p>
                  <p className="text-cyan-400 font-mono text-sm font-bold">
                    ${(selectedPayout.netUsd || 0).toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Orders List */}
              <h3 className="text-sm font-semibold text-gray-300 mb-3">
                Linked Orders ({selectedPayout.orders?.length || 0})
              </h3>
              <div className="bg-[#0B0F17] border border-white/5 rounded-lg overflow-hidden mb-6">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 uppercase tracking-wider">
                      <th className="px-4 py-2.5 font-semibold">Order ID</th>
                      <th className="px-4 py-2.5 font-semibold">Customer</th>
                      <th className="px-4 py-2.5 font-semibold text-right">
                        $ Amt
                      </th>
                      <th className="px-4 py-2.5 font-semibold text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedPayout.orders || []).length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="text-center py-6 text-gray-500 italic"
                        >
                          No orders linked to this payout.
                        </td>
                      </tr>
                    ) : (
                      (selectedPayout.orders || []).map((order: any) => (
                        <tr
                          key={order.id}
                          className="border-b border-white/5 hover:bg-white/[0.02]"
                        >
                          <td className="px-4 py-2.5 font-mono text-cyan-400">
                            {order.orderId}
                          </td>
                          <td className="px-4 py-2.5 text-white">
                            {order.customerName}
                          </td>
                          <td className="px-4 py-2.5 text-right text-green-400 font-mono">
                            ${(order.amountUsd || 0).toFixed(2)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex gap-1.5 justify-end">
                              <button
                                onClick={async () => {
                                  const res = await fetch(
                                    `/api/drivers/payouts/items/${order.id}`,
                                    { method: "POST" },
                                  );
                                  if (res.ok) {
                                    const data = await res.json();
                                    if (data.deleted) {
                                      // Last order — close modal entirely
                                      setSelectedPayout(null);
                                    } else {
                                      // Orders remain — filter out the removed order locally
                                      setSelectedPayout((prev: any) => {
                                        if (!prev) return prev;
                                        const updatedOrders = (
                                          prev.orders || []
                                        ).filter((o: any) => o.id !== order.id);
                                        // Recalculate displayed totals from remaining orders
                                        const newTotalUsd =
                                          updatedOrders.reduce(
                                            (s: number, o: any) =>
                                              s + (o.amountUsd || 0),
                                            0,
                                          );
                                        const newTotalLbp =
                                          updatedOrders.reduce(
                                            (s: number, o: any) =>
                                              s + (o.amountLbp || 0),
                                            0,
                                          );
                                        return {
                                          ...prev,
                                          orders: updatedOrders,
                                          totalUsd: newTotalUsd,
                                          totalLbp: newTotalLbp,
                                          netUsd: data.netUsd ?? prev.netUsd,
                                          commissionUsd:
                                            data.commissionUsd ??
                                            prev.commissionUsd,
                                        };
                                      });
                                    }
                                    await refreshData();
                                  }
                                }}
                                className="px-2 py-1 rounded text-[10px] font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 transition-colors"
                              >
                                Return to Driver
                              </button>
                              <button className="px-2 py-1 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors">
                                Edit Price
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Approve Action */}
              <div className="flex gap-3">
                <button
                  onClick={() => setSelectedPayout(null)}
                  disabled={approving}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] transition-colors text-sm font-semibold disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApprovePayout}
                  disabled={approving}
                  className="flex-1 px-4 py-2.5 rounded-lg font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors text-sm shadow-lg shadow-emerald-500/20"
                >
                  {approving ? "Processing…" : "✓ Approve & Settle Payout"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Payout Confirmation Modal ──────────────────────────────── */}
        {showPayoutModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-[#121824] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 mx-4">
              <h2 className="text-xl font-bold text-white mb-1">
                Confirm Payout Batch
              </h2>
              <p className="text-gray-400 text-sm mb-6">
                You are about to create a payout for{" "}
                <span className="text-cyan-400 font-semibold">
                  {deliveredOrders.length}
                </span>{" "}
                delivered {deliveredOrders.length === 1 ? "order" : "orders"}.
              </p>

              {/* Receipt-style breakdown */}
              <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-5 mb-6 space-y-3 font-mono">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Total USD</span>
                  <span className="text-green-400 font-bold">
                    ${totalDeliveredUsd.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Total LBP</span>
                  <span className="text-yellow-400 font-bold">
                    {totalDeliveredLbp.toLocaleString()} LL
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Order Count</span>
                  <span className="text-white font-bold">
                    {deliveredOrders.length}
                  </span>
                </div>
                <hr className="border-white/10" />
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Commission (zone‑based)</span>
                  <span className="text-red-400 font-bold">
                    -${totalCommission.toFixed(2)}
                  </span>
                </div>
                <hr className="border-white/10" />
                <div className="flex justify-between text-sm">
                  <span className="text-gray-300 font-semibold">
                    Net Payout
                  </span>
                  <span className="text-cyan-400 font-bold text-base">
                    ${netPayoutUsd.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowPayoutModal(false)}
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] transition-colors text-sm font-semibold disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGeneratePayout}
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-lg font-bold text-white bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors text-sm shadow-lg shadow-cyan-500/20"
                >
                  {submitting ? "Submitting…" : "Confirm & Submit"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
