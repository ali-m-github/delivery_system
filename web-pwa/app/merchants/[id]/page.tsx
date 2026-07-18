"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";

type Tab = "ALL" | "WAREHOUSE" | "ASSIGNED" | "WD" | "WO" | "RETURN" | "PS";

const TAB_LABELS: Record<Tab, string> = {
  ALL: "All Orders",
  WAREHOUSE: "Warehouse",
  ASSIGNED: "Dr",
  WD: "WD",
  WO: "WO",
  RETURN: "Returns",
  PS: "PS",
};

export default function MerchantProfilePage() {
  const params = useParams();
  const router = useRouter();
  const merchantId = params.id as string;

  const [merchant, setMerchant] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("ALL");

  // ─── Data Fetching ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/admin/merchants/${merchantId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data) => {
        setMerchant(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [merchantId]);

  // ─── Derived Orders ─────────────────────────────────────────────────────
  const orders: any[] = merchant?.orders || [];

  // ─── Header Aggregates ──────────────────────────────────────────────────
  const activeOrders = useMemo(
    () => orders.filter((o: any) => o.location !== "RETURN"),
    [orders],
  );

  const deliveredOrders = useMemo(
    () => orders.filter((o: any) => o.location === "DELIVERED"),
    [orders],
  );

  const activeVolumeUsd = useMemo(
    () => activeOrders.reduce((s: number, o: any) => s + (o.amountUsd ?? 0), 0),
    [activeOrders],
  );

  const activeVolumeLbp = useMemo(
    () => activeOrders.reduce((s: number, o: any) => s + (o.amountLbp ?? 0), 0),
    [activeOrders],
  );

  const deliveredVolumeUsd = useMemo(
    () =>
      deliveredOrders.reduce((s: number, o: any) => s + (o.amountUsd ?? 0), 0),
    [deliveredOrders],
  );

  const deliveredVolumeLbp = useMemo(
    () =>
      deliveredOrders.reduce((s: number, o: any) => s + (o.amountLbp ?? 0), 0),
    [deliveredOrders],
  );

  // ─── Tab Filtering ──────────────────────────────────────────────────────
  const tabFilters: Record<Tab, any[]> = useMemo(
    () => ({
      ALL: orders,
      WAREHOUSE: orders.filter((o: any) => o.location === "WAREHOUSE"),
      ASSIGNED: orders.filter((o: any) => o.location === "ASSIGNED"),
      WD: orders.filter(
        (o: any) =>
          o.location === "DELIVERED" &&
          ["WD", "PP"].includes(o.financialStatus),
      ),
      WO: orders.filter(
        (o: any) => o.location === "DELIVERED" && o.financialStatus === "WO",
      ),
      RETURN: orders.filter((o: any) => o.location === "RETURN"),
      PS: orders.filter(
        (o: any) => o.location === "DELIVERED" && o.financialStatus === "PS",
      ),
    }),
    [orders],
  );

  const filteredOrders = tabFilters[activeTab];

  // ─── Loading State ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F17] p-8 text-cyan-400 font-sans flex items-center justify-center">
        <p className="animate-pulse">Loading Merchant Profile…</p>
      </div>
    );
  }

  // ─── Error / Not Found ──────────────────────────────────────────────────
  if (!merchant || merchant.error) {
    return (
      <div className="min-h-screen bg-[#0B0F17] p-8 text-red-500 font-sans flex flex-col items-center justify-center gap-4">
        <p className="text-lg">Merchant Not Found</p>
        <button
          onClick={() => router.push("/merchants")}
          className="px-4 py-2 rounded border border-gray-700 text-gray-400 hover:bg-slate-800 transition-colors text-sm"
        >
          ← Back to Merchants
        </button>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0B0F17] text-white p-6 font-sans">
      <div className="max-w-7xl mx-auto">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex justify-between items-start mb-6 border-b border-white/10 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">
              {merchant.merchantName}
            </h1>
            <p className="text-gray-400 text-sm mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <span className="bg-[#121824] px-2 py-1 rounded border border-white/5 font-mono text-cyan-400">
                M-{merchant.merchantId}
              </span>
              {merchant.contactName && (
                <span>Contact: {merchant.contactName}</span>
              )}
              {merchant.phone && <span>Phone: {merchant.phone}</span>}
              {merchant.address && <span>Address: {merchant.address}</span>}
            </p>
          </div>
          <button
            onClick={() => router.push("/merchants")}
            className="px-4 py-2 rounded text-gray-400 hover:bg-slate-800 transition-colors border border-white/10 text-sm"
          >
            ← Back to Merchants
          </button>
        </div>

        {/* ── Statistical Cards ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Active Volume */}
          <div className="bg-[#121824] border border-white/5 rounded-xl p-5">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
              Active Volume (excl. Returns)
            </p>
            <p className="text-cyan-400 text-2xl font-bold">
              {activeOrders.length} orders
            </p>
            <div className="flex gap-4 mt-1.5 text-sm">
              <span className="text-green-400 font-mono">
                ${activeVolumeUsd.toFixed(2)}
              </span>
              <span className="text-yellow-400 font-mono">
                {activeVolumeLbp.toLocaleString()} LL
              </span>
            </div>
          </div>

          {/* Delivered Volume */}
          <div className="bg-[#121824] border border-white/5 rounded-xl p-5">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
              Delivered Volume
            </p>
            <p className="text-green-400 text-2xl font-bold">
              {deliveredOrders.length} orders
            </p>
            <div className="flex gap-4 mt-1.5 text-sm">
              <span className="text-green-400 font-mono">
                ${deliveredVolumeUsd.toFixed(2)}
              </span>
              <span className="text-yellow-400 font-mono">
                {deliveredVolumeLbp.toLocaleString()} LL
              </span>
            </div>
          </div>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-6 border-b border-white/10 overflow-x-auto">
          {(Object.keys(TAB_LABELS) as Tab[]).map((key) => {
            const count = tabFilters[key].length;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-3 text-sm font-semibold rounded-t-lg transition-colors whitespace-nowrap ${
                  activeTab === key
                    ? "bg-[#121824] text-cyan-400 border border-white/10 border-b-[#121824] -mb-[1px]"
                    : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]"
                }`}
              >
                {TAB_LABELS[key]}
                <span
                  className={`ml-2 px-1.5 py-0.5 text-[10px] rounded border ${
                    key === "RETURN"
                      ? "bg-red-500/10 text-red-400 border-red-500/20"
                      : key === "WAREHOUSE"
                        ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                        : key === "ASSIGNED"
                          ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                          : key === "WD"
                            ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                            : key === "WO"
                              ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                              : key === "PS"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Data Table ──────────────────────────────────────────────── */}
        <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                  <th className="px-5 py-4 font-semibold">Tracking ID</th>
                  <th className="px-5 py-4 font-semibold">Customer Name</th>
                  <th className="px-5 py-4 font-semibold">Zone</th>
                  <th className="px-5 py-4 font-semibold">Location</th>
                  <th className="px-5 py-4 font-semibold">Financial Status</th>
                  <th className="px-5 py-4 font-semibold text-right">
                    Amount (USD)
                  </th>
                  <th className="px-5 py-4 font-semibold text-right">
                    Amount (LBP)
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="text-center py-10 text-gray-500 italic"
                    >
                      No orders match the current filter.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order: any) => (
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
                        <LocationBadge location={order.location} />
                      </td>
                      <td className="px-5 py-3.5">
                        <FinancialBadge status={order.financialStatus} />
                      </td>
                      <td className="px-5 py-3.5 text-right text-green-400 font-mono text-sm">
                        ${(order.amountUsd ?? 0).toFixed(2)}
                      </td>
                      <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                        {(order.amountLbp ?? 0).toLocaleString()} LL
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Location Badge ─────────────────────────────────────────────────────
function LocationBadge({ location }: { location: string }) {
  const colorMap: Record<string, string> = {
    WAREHOUSE: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    ASSIGNED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    DELIVERED: "bg-green-500/10 text-green-400 border-green-500/20",
    RETURN: "bg-red-500/10 text-red-400 border-red-500/20",
  };

  const classes =
    colorMap[location] || "bg-gray-500/10 text-gray-400 border-gray-500/20";

  return (
    <span
      className={`px-2 py-1 text-[10px] font-bold rounded border ${classes}`}
    >
      {location}
    </span>
  );
}

// ─── Financial Status Badge ─────────────────────────────────────────────
function FinancialBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    UD: "bg-gray-500/10 text-gray-400 border-gray-500/20",
    PAID: "bg-green-500/10 text-green-400 border-green-500/20",
    PENDING: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    WO: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    PS: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    PP: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  };

  const classes =
    colorMap[status] || "bg-gray-500/10 text-gray-400 border-gray-500/20";

  return (
    <span
      className={`px-2 py-1 text-[10px] font-bold rounded border ${classes}`}
    >
      {status}
    </span>
  );
}
