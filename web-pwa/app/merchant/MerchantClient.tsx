"use client";

import { useState, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Zone {
  id: string;
  name: string;
}

interface Order {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  zone: { id: string; name: string } | null;
  amountUsd: number;
  amountLbp: number;
  collectedUsd: number;
  collectedLbp: number;
  location: string;
  financialStatus: string;
  notes: string | null;
  createdAt: string;
}

interface MerchantPayout {
  id: string;
  sequentialIndex: number;
  totalUsd: number;
  totalLbp: number;
  shippingUsd: number;
  shippingLbp: number;
  netUsd: number;
  netLbp: number;
  status: string;
  createdAt: string;
}

interface ZoneRate {
  id: string;
  zoneId: string;
  rate: number;
  zone: { id: string; name: string };
}

interface MerchantData {
  id: string;
  merchantId: number;
  merchantName: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  zoneRates: ZoneRate[];
  orders: Order[];
}

interface MerchantClientProps {
  merchant: MerchantData;
  zones: Zone[];
  payouts: MerchantPayout[];
}

type TabKey = "deliveries" | "newOrder" | "statements";

// ─── Component ────────────────────────────────────────────────────────────────
export default function MerchantClient({
  merchant,
  zones,
  payouts,
}: MerchantClientProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("deliveries");
  const [selectedStatement, setSelectedStatement] = useState<any | null>(null);

  // ── Interactive Data Grid states ─────────────────────────────────────────
  const [boxFilter, setBoxFilter] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);

  // ── Order Form State ────────────────────────────────────────────────────
  const [formData, setFormData] = useState({
    orderId: "",
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    zoneId: "",
    price: "",
    amountLbp: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // ── Orders state ────────────────────────────────────────────────────────
  const [orders, setOrders] = useState<Order[]>(merchant.orders || []);

  // ── Interactive filtering with multi-keyword search ─────────────────────
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Box Filter Logic
      if (boxFilter === "DELIVERED" && order.location !== "DELIVERED")
        return false;
      if (
        boxFilter === "IN_TRANSIT" &&
        order.location !== "WITH_DRIVER" &&
        order.location !== "ASSIGNED"
      )
        return false;
      if (boxFilter === "WAREHOUSE" && order.location !== "WAREHOUSE")
        return false;
      if (boxFilter === "RETURNED" && order.location !== "RETURNED")
        return false;
      if (boxFilter === "PAID" && order.financialStatus !== "PS") return false;
      if (boxFilter === "UNPAID" && order.financialStatus === "PS")
        return false;

      // Dropdown Filters
      if (locationFilter && order.location !== locationFilter) return false;
      if (
        dateFilter &&
        new Date(order.createdAt).toISOString().split("T")[0] !== dateFilter
      )
        return false;

      // Multi-Keyword Search (Comma Separated)
      if (searchTerm) {
        const keywords = searchTerm
          .toLowerCase()
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k);
        const searchString =
          `${order.id} ${order.orderId} ${order.customerName} ${order.customerPhone} ${order.customerAddress}`.toLowerCase();
        const matchesSearch = keywords.some((keyword) =>
          searchString.includes(keyword),
        );
        if (!matchesSearch) return false;
      }

      return true;
    });
  }, [orders, boxFilter, locationFilter, dateFilter, searchTerm]);

  // ── Stat summaries (computed from full dataset) ─────────────────────────
  const stats = useMemo(() => {
    const total = orders.length;
    const delivered = orders.filter((o) => o.location === "DELIVERED").length;
    const inTransit = orders.filter(
      (o) => o.location === "WITH_DRIVER" || o.location === "ASSIGNED",
    ).length;
    const warehouse = orders.filter((o) => o.location === "WAREHOUSE").length;
    const paidCount = orders.filter((o) => o.financialStatus === "PS").length;
    const unpaidCount = orders.filter((o) => o.financialStatus !== "PS").length;
    const totalUsd = orders.reduce((s, o) => s + (o.amountUsd || 0), 0);
    const totalLbp = orders.reduce((s, o) => s + (o.amountLbp || 0), 0);
    return {
      total,
      delivered,
      inTransit,
      warehouse,
      paidCount,
      unpaidCount,
      totalUsd,
      totalLbp,
    };
  }, [orders]);

  // ── Submit new order ────────────────────────────────────────────────────
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormMessage(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/merchant/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: formData.orderId,
          customerName: formData.customerName,
          customerPhone: formData.customerPhone,
          customerAddress: formData.customerAddress,
          zoneId: formData.zoneId,
          price: formData.price,
          amountLbp: formData.amountLbp || "0",
          notes: formData.notes,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create order");
      }

      const newOrder = await res.json();
      setOrders((prev) => [newOrder, ...prev]);
      setFormData({
        orderId: "",
        customerName: "",
        customerPhone: "",
        customerAddress: "",
        zoneId: "",
        price: "",
        amountLbp: "",
        notes: "",
      });
      setFormMessage({ type: "success", text: "Order created successfully!" });
    } catch (error: any) {
      setFormMessage({
        type: "error",
        text: error.message || "Failed to create order",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Fetch full statement detail (with orders) when "View Details" clicked ──
  const fetchStatementDetail = async (payout: MerchantPayout) => {
    try {
      const res = await fetch(`/api/statements?merchantId=${merchant.id}`);
      if (res.ok) {
        const all: any[] = await res.json();
        const found = all.find((s: any) => s.id === payout.id);
        if (found) {
          setSelectedStatement(found);
          return;
        }
      }
    } catch (err) {
      console.error("Failed to fetch statement detail", err);
    }
    // Fallback: use the summary payout data (no nested orders)
    setSelectedStatement(payout);
  };

  // ── Export selected orders to Excel ─────────────────────────────────────
  const exportSelectedOrders = async () => {
    if (selectedOrders.length === 0) return;

    const selectedData = orders.filter((o) => selectedOrders.includes(o.id));
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Selected_Orders");

    worksheet.columns = [
      { header: "Order ID", key: "orderId", width: 15 },
      { header: "Date", key: "date", width: 15 },
      { header: "Customer Name", key: "customerName", width: 25 },
      { header: "Phone", key: "phone", width: 15 },
      { header: "Address", key: "address", width: 30 },
      { header: "Location", key: "location", width: 15 },
      { header: "Financial Status", key: "financialStatus", width: 18 },
      { header: "Amount USD", key: "amountUsd", width: 15 },
      { header: "Amount LBP", key: "amountLbp", width: 15 },
    ];

    selectedData.forEach((order) => {
      worksheet.addRow({
        orderId: order.orderId,
        date: formatDate(order.createdAt),
        customerName: order.customerName,
        phone: order.customerPhone || "—",
        address: order.customerAddress || "—",
        location: order.location,
        financialStatus: order.financialStatus,
        amountUsd: order.amountUsd,
        amountLbp: order.amountLbp,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Orders_${merchant.merchantName}_${new Date().toISOString().split("T")[0]}.xlsx`;
    link.click();
  };

  // ── Export statement to Excel ───────────────────────────────────────────
  const exportToExcel = async (statement: any) => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(
      `Statement_${statement.sequentialIndex}`,
    );

    worksheet.columns = [
      { header: "Tracking ID", key: "orderId", width: 15 },
      { header: "Customer Name", key: "customer", width: 25 },
      { header: "Phone", key: "phone", width: 15 },
      { header: "Address", key: "address", width: 30 },
      { header: "Orig Price USD", key: "origUsd", width: 15 },
      { header: "Orig Price LBP", key: "origLbp", width: 15 },
      { header: "Collected USD", key: "collUsd", width: 15 },
      { header: "Collected LBP", key: "collLbp", width: 15 },
      { header: "Shipping USD", key: "shipUsd", width: 15 },
      { header: "Shipping LBP", key: "shipLbp", width: 15 },
      { header: "Net USD", key: "netUsd", width: 15 },
      { header: "Net LBP", key: "netLbp", width: 15 },
    ];

    const orders = statement.orders || [];
    const zoneRates = statement.merchant?.zoneRates || [];

    orders.forEach((order: any) => {
      const rate = zoneRates.find(
        (zr: any) =>
          String(zr.zoneId) === String(order.zoneId) ||
          String(zr.zoneId) === String(order.zone?.name),
      );
      const shipUsd = rate?.rateUsd ?? rate?.rate ?? rate?.price ?? 0;
      const shipLbp = rate?.rateLbp ?? 0;
      const origUsd = order.amountUsd || 0;
      const origLbp = order.amountLbp || 0;
      const collUsd = order.collectedUsd || order.amountUsd || 0;
      const collLbp = order.collectedLbp || order.amountLbp || 0;

      worksheet.addRow({
        orderId: order.orderId,
        customer: order.customerName,
        phone: order.customerPhone || "—",
        address: order.customerAddress || "—",
        origUsd: origUsd,
        origLbp: origLbp,
        collUsd: collUsd,
        collLbp: collLbp,
        shipUsd: shipUsd,
        shipLbp: shipLbp,
        netUsd: collUsd - shipUsd,
        netLbp: collLbp - shipLbp,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Statement_${merchant.merchantName}_#${statement.sequentialIndex}.xlsx`;
    link.click();
  };

  // ── Master checkbox toggle ──────────────────────────────────────────────
  const toggleAllFiltered = () => {
    if (
      selectedOrders.length === filteredOrders.length &&
      filteredOrders.length > 0
    ) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(filteredOrders.map((o) => o.id));
    }
  };

  const toggleOrder = (id: string) => {
    setSelectedOrders((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // ── Copy tracking link to clipboard ────────────────────────────────────
  const handleCopyLink = (orderId: string) => {
    const trackingUrl = window.location.origin + "/track/" + orderId;

    if (navigator.clipboard && window.isSecureContext) {
      // Modern HTTPS approach
      navigator.clipboard
        .writeText(trackingUrl)
        .then(() => alert(`Tracking link copied!\n${trackingUrl}`))
        .catch(() => alert(`Failed to copy. Manual link:\n${trackingUrl}`));
    } else {
      // Legacy HTTP Fallback
      const textArea = document.createElement("textarea");
      textArea.value = trackingUrl;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand("copy");
        alert(`Tracking link copied!\n${trackingUrl}`);
      } catch (err) {
        alert(`Failed to copy link. Manual link:\n${trackingUrl}`);
      }
      textArea.remove();
    }
  };

  // ── Format helpers ──────────────────────────────────────────────────────
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "2-digit",
    });

  const formatCurrency = (val: number) => val.toFixed(2);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Global Print Override: Force hiding the Sidebar and external layout during print ── */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          aside, nav { display: none !important; }
          body { background: white !important; color: black !important; }
          @page { margin: 15mm; }
        }
      `,
        }}
      />

      <div
        className={`min-h-screen bg-[#0B0F17] text-white p-4 sm:p-6 font-sans ${selectedStatement ? "print:hidden" : ""}`}
      >
        <div className="max-w-[1400px] mx-auto">
          {/* ── Header ── */}
          <div className="mb-8 flex flex-col gap-2">
            <div className="flex items-end gap-4">
              <h1 className="text-3xl font-bold text-cyan-400">
                {merchant.merchantName}
              </h1>
              <span className="px-2 py-1 text-xs font-bold bg-cyan-500/10 text-cyan-500 rounded border border-cyan-500/20">
                Seller #{merchant.merchantId}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400 mt-2">
              {merchant.phone && (
                <span className="flex items-center gap-1">
                  📞 {merchant.phone}
                </span>
              )}
              {merchant.address && (
                <span className="flex items-center gap-1">
                  📍 {merchant.address}
                </span>
              )}
            </div>

            {/* Shipping Rates */}
            {merchant.zoneRates && merchant.zoneRates.length > 0 && (
              <div className="mt-4 p-4 rounded-xl border border-white/5 bg-[#121824] inline-block">
                <p className="text-xs text-gray-500 font-bold uppercase mb-2">
                  Shipping Rates
                </p>
                <div className="flex gap-4">
                  {merchant.zoneRates.map((rate) => (
                    <div key={rate.id} className="text-sm">
                      <span className="text-gray-400">{rate.zone.name}: </span>
                      <span className="text-white font-bold">
                        ${rate.rate.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Stat Cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            <StatCard
              label="All Orders"
              value={stats.total}
              color="slate"
              isSelected={boxFilter === null}
              onClick={() => setBoxFilter(null)}
            />
            <StatCard
              label="In Transit"
              value={stats.inTransit}
              color="amber"
              isSelected={boxFilter === "IN_TRANSIT"}
              onClick={() => setBoxFilter("IN_TRANSIT")}
            />
            <StatCard
              label="Delivered"
              value={stats.delivered}
              color="green"
              isSelected={boxFilter === "DELIVERED"}
              onClick={() => setBoxFilter("DELIVERED")}
            />
            <StatCard
              label="Warehouse"
              value={stats.warehouse}
              color="purple"
              isSelected={boxFilter === "WAREHOUSE"}
              onClick={() => setBoxFilter("WAREHOUSE")}
            />
            <StatCard
              label="Unpaid"
              value={stats.unpaidCount}
              color="red"
              isSelected={boxFilter === "UNPAID"}
              onClick={() => setBoxFilter("UNPAID")}
            />
            <StatCard
              label="Paid"
              value={stats.paidCount}
              color="green"
              isSelected={boxFilter === "PAID"}
              onClick={() => setBoxFilter("PAID")}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <div className="backdrop-blur-xl bg-white/5 rounded-xl border border-white/10 p-4">
              <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
                Total Value (USD)
              </p>
              <p className="text-green-400 font-mono text-xl font-bold">
                ${formatCurrency(stats.totalUsd)}
              </p>
            </div>
            <div className="backdrop-blur-xl bg-white/5 rounded-xl border border-white/10 p-4">
              <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">
                Total Value (LBP)
              </p>
              <p className="text-yellow-400 font-mono text-xl font-bold">
                {stats.totalLbp.toLocaleString()} LL
              </p>
            </div>
          </div>

          {/* ── Tabs ── */}
          <div className="flex gap-1 mb-6 p-1 rounded-xl backdrop-blur-xl bg-white/5 border border-white/10 w-fit">
            <button
              onClick={() => setActiveTab("deliveries")}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                activeTab === "deliveries"
                  ? "bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              Active Deliveries ({filteredOrders.length})
            </button>
            <button
              onClick={() => setActiveTab("newOrder")}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                activeTab === "newOrder"
                  ? "bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              New Order Request
            </button>
            <button
              onClick={() => setActiveTab("statements")}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                activeTab === "statements"
                  ? "bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              My Statements ({payouts.length})
            </button>
          </div>

          {/* ════════════════════════════════ */}
          {/* TAB 1: ACTIVE DELIVERIES        */}
          {/* ════════════════════════════════ */}
          {activeTab === "deliveries" && (
            <>
              {/* ── Toolbar ── */}
              <div className="flex flex-wrap items-end gap-3 mb-4 p-4 rounded-xl backdrop-blur-xl bg-white/5 border border-white/10">
                <div className="flex flex-col gap-1 min-w-[180px]">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Multi-Keyword Search
                  </label>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="ID, name, phone, address..."
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-xs focus:border-cyan-500 outline-none transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Date
                  </label>
                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-xs focus:border-cyan-500 outline-none transition-colors [color-scheme:dark]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Location
                  </label>
                  <select
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-xs focus:border-cyan-500 outline-none transition-colors [&>option]:bg-slate-950 [&>option]:text-white"
                  >
                    <option value="">All</option>
                    <option value="WAREHOUSE">Warehouse</option>
                    <option value="WITH_DRIVER">With Driver</option>
                    <option value="ASSIGNED">Assigned</option>
                    <option value="DELIVERED">Delivered</option>
                    <option value="RETURNED">Returned</option>
                  </select>
                </div>
                <div className="flex-1" />
                {selectedOrders.length > 0 && (
                  <button
                    onClick={exportSelectedOrders}
                    className="px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg font-bold text-xs hover:bg-green-500/30 transition-colors"
                  >
                    Export Selected ({selectedOrders.length})
                  </button>
                )}
              </div>

              {filteredOrders.length === 0 ? (
                <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-12 text-center">
                  <p className="text-gray-500 text-sm">
                    No orders match the current filters.
                  </p>
                </div>
              ) : (
                <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/[0.03] text-gray-500 text-[10px] uppercase tracking-wider">
                          <th className="px-2 py-3 w-10">
                            <input
                              type="checkbox"
                              checked={
                                filteredOrders.length > 0 &&
                                selectedOrders.length === filteredOrders.length
                              }
                              onChange={toggleAllFiltered}
                              className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
                            />
                          </th>
                          <th className="px-2 py-3 text-left font-medium">
                            Order ID
                          </th>
                          <th className="px-2 py-3 text-left font-medium">
                            Date
                          </th>
                          <th className="px-2 py-3 text-left font-medium">
                            Customer
                          </th>
                          <th className="px-2 py-3 text-left font-medium">
                            Phone
                          </th>
                          <th className="px-2 py-3 text-left font-medium">
                            Address
                          </th>
                          <th className="px-2 py-3 text-left font-medium">
                            Amount
                          </th>
                          <th className="px-2 py-3 text-left font-medium">
                            Amount Collected
                          </th>
                          <th className="px-2 py-3 text-left font-medium">
                            Location
                          </th>
                          <th className="px-4 py-3 text-right font-medium">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOrders.map((order) => (
                          <tr
                            key={order.id}
                            className="border-b border-white/5 hover:bg-cyan-500/[0.03] transition-colors"
                          >
                            <td className="px-2 py-2.5">
                              <input
                                type="checkbox"
                                checked={selectedOrders.includes(order.id)}
                                onChange={() => toggleOrder(order.id)}
                                className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
                              />
                            </td>
                            <td className="px-2 py-2.5 text-xs font-mono text-cyan-400">
                              #{order.orderId}
                            </td>
                            <td className="px-2 py-2.5 text-xs text-gray-500">
                              {formatDate(order.createdAt)}
                            </td>
                            <td className="px-2 py-2.5 text-xs text-white">
                              {order.customerName}
                            </td>
                            <td className="px-2 py-2.5 text-xs text-gray-400">
                              {order.customerPhone || "—"}
                            </td>
                            <td
                              className="px-2 py-2.5 text-xs text-gray-400 max-w-[150px] truncate"
                              title={order.customerAddress}
                            >
                              {order.customerAddress}
                            </td>
                            <td className="px-2 py-2.5 text-xs">
                              <span className="text-green-400 font-mono">
                                ${order.amountUsd.toFixed(2)}
                              </span>
                              <span className="text-gray-600 mx-1">|</span>
                              <span className="text-yellow-400 font-mono">
                                {order.amountLbp.toLocaleString()} LL
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-xs">
                              <span className="text-green-300 font-mono">
                                ${(order.collectedUsd ?? 0).toFixed(2)}
                              </span>
                              <span className="text-gray-600 mx-1">|</span>
                              <span className="text-yellow-300 font-mono">
                                {(order.collectedLbp ?? 0).toLocaleString()} LL
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-xs">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                  order.location === "DELIVERED"
                                    ? "bg-green-500/10 text-green-400 border border-green-500/30"
                                    : order.location === "WITH_DRIVER" ||
                                        order.location === "ASSIGNED"
                                      ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30"
                                      : order.location === "RETURNED"
                                        ? "bg-red-500/10 text-red-400 border border-red-500/30"
                                        : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30"
                                }`}
                              >
                                {order.location === "WAREHOUSE"
                                  ? "Warehouse"
                                  : order.location === "WITH_DRIVER"
                                    ? "With Driver"
                                    : order.location === "ASSIGNED"
                                      ? "Assigned"
                                      : order.location === "DELIVERED"
                                        ? "Delivered"
                                        : order.location === "RETURNED"
                                          ? "Returned"
                                          : order.location}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right">
                              <button
                                onClick={() => handleCopyLink(order.orderId)}
                                className="px-3 py-1.5 text-xs font-bold text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded transition-colors"
                              >
                                🔗 Copy Link
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ════════════════════════════════ */}
          {/* TAB 2: NEW ORDER REQUEST        */}
          {/* ════════════════════════════════ */}
          {activeTab === "newOrder" && (
            <div className="max-w-lg mx-auto bg-[#121824] border border-white/5 rounded-xl p-5">
              <h2 className="text-lg font-bold text-white mb-4 border-b border-white/10 pb-2">
                New Delivery Request
              </h2>

              {formMessage && (
                <div
                  className={`mb-4 px-3 py-2 rounded-lg text-sm ${
                    formMessage.type === "success"
                      ? "bg-green-500/10 border border-green-500/30 text-green-400"
                      : "bg-red-500/10 border border-red-500/30 text-red-400"
                  }`}
                >
                  {formMessage.text}
                </div>
              )}

              <form onSubmit={handleCreateOrder} className="space-y-4">
                {/* Order ID */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-mono uppercase">
                    Tracking ID
                  </label>
                  <input
                    required
                    value={formData.orderId}
                    onChange={(e) =>
                      setFormData({ ...formData, orderId: e.target.value })
                    }
                    placeholder="e.g. M-1001"
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors"
                  />
                </div>

                {/* Customer Name */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-mono uppercase">
                    Customer Name
                  </label>
                  <input
                    required
                    value={formData.customerName}
                    onChange={(e) =>
                      setFormData({ ...formData, customerName: e.target.value })
                    }
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors"
                  />
                </div>

                {/* Customer Phone */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-mono uppercase">
                    Phone
                  </label>
                  <input
                    required
                    value={formData.customerPhone}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        customerPhone: e.target.value,
                      })
                    }
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors"
                  />
                </div>

                {/* Customer Address */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-mono uppercase">
                    Address
                  </label>
                  <input
                    required
                    value={formData.customerAddress}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        customerAddress: e.target.value,
                      })
                    }
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors"
                  />
                </div>

                {/* Destination Zone (lookup dropdown) */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-mono uppercase">
                    Destination Zone
                  </label>
                  <select
                    required
                    value={formData.zoneId}
                    onChange={(e) =>
                      setFormData({ ...formData, zoneId: e.target.value })
                    }
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors [&>option]:bg-slate-950 [&>option]:text-white"
                  >
                    <option
                      value=""
                      disabled
                      className="bg-slate-950 text-gray-500"
                    >
                      — Select Zone —
                    </option>
                    {zones.map((z) => (
                      <option
                        key={z.id}
                        value={z.id}
                        className="bg-slate-950 text-white"
                      >
                        {z.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Price USD */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-mono uppercase">
                    Price (USD)
                  </label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.price}
                    onChange={(e) =>
                      setFormData({ ...formData, price: e.target.value })
                    }
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors"
                  />
                </div>

                {/* Price LBP */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-mono uppercase">
                    Price (LBP)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.amountLbp}
                    onChange={(e) =>
                      setFormData({ ...formData, amountLbp: e.target.value })
                    }
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors"
                  />
                </div>

                {/* Notes */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-mono uppercase">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                    rows={2}
                    className="bg-slate-950 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:border-cyan-500 outline-none transition-colors resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-cyan-600 hover:bg-cyan-500 text-white py-2.5 rounded-lg font-bold transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Submitting..." : "Submit Delivery Request"}
                </button>
              </form>
            </div>
          )}

          {/* ════════════════════════════════ */}
          {/* MY STATEMENTS TAB                */}
          {/* ════════════════════════════════ */}
          {activeTab === "statements" && (
            <>
              {payouts.length === 0 ? (
                <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-12 text-center">
                  <p className="text-gray-500 text-sm">
                    No statements have been generated yet.
                  </p>
                </div>
              ) : (
                <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/[0.03] text-gray-500 text-[11px] uppercase tracking-wider">
                          <th className="px-4 py-3 text-left font-medium">
                            Statement #
                          </th>
                          <th className="px-4 py-3 text-left font-medium">
                            Date generated
                          </th>
                          <th className="px-4 py-3 text-right font-medium">
                            Gross Cash Collected
                          </th>
                          <th className="px-4 py-3 text-right font-medium">
                            Shipping Costs Deducted
                          </th>
                          <th className="px-4 py-3 text-right font-medium">
                            Net Cash Disbursed
                          </th>
                          <th className="px-4 py-3 text-right font-medium">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {payouts.map((p) => (
                          <tr
                            key={p.id}
                            className="border-b border-white/5 hover:bg-cyan-500/[0.03] transition-colors"
                          >
                            <td className="px-4 py-3 text-xs font-mono text-cyan-400">
                              #{p.sequentialIndex}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-400">
                              {formatDate(p.createdAt)}
                            </td>
                            <td className="px-4 py-3 text-xs text-right">
                              <span className="text-green-400 font-mono">
                                ${formatCurrency(p.totalUsd)}
                              </span>
                              <span className="text-gray-600 mx-1">|</span>
                              <span className="text-yellow-400 font-mono">
                                {p.totalLbp.toLocaleString()} LL
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-right">
                              <span className="text-red-400 font-mono">
                                -${formatCurrency(p.shippingUsd)}
                              </span>
                              <span className="text-gray-600 mx-1">|</span>
                              <span className="text-red-400 font-mono">
                                -{p.shippingLbp.toLocaleString()} LL
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-right">
                              <span className="text-green-300 font-mono font-bold">
                                ${formatCurrency(p.netUsd)}
                              </span>
                              <span className="text-gray-600 mx-1">|</span>
                              <span className="text-yellow-300 font-mono font-bold">
                                {p.netLbp.toLocaleString()} LL
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => fetchStatementDetail(p)}
                                className="px-3 py-1.5 text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/20"
                              >
                                View Details
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Statement Detail Modal (Prints as a clean Receipt) ── */}
      {selectedStatement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm print:absolute print:inset-0 print:bg-white print:p-0 print:items-start print:block">
          <div className="bg-[#121824] w-full max-w-6xl rounded-2xl border border-white/20 shadow-2xl flex flex-col max-h-[90vh] print:bg-white print:border-none print:shadow-none print:max-h-none print:overflow-visible">
            {/* Modal Header */}
            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-[#0B0F17] print:bg-white print:border-gray-300 print:pb-8">
              <div>
                <h2 className="text-2xl font-bold text-white print:text-black">
                  Statement #{selectedStatement.sequentialIndex}
                </h2>
                <p className="text-gray-400 text-sm print:text-gray-600 mt-1">
                  {merchant.merchantName} &middot;{" "}
                  {new Date(selectedStatement.createdAt).toLocaleString()}
                </p>
              </div>

              {/* Buttons (Hidden on Print) */}
              <div className="flex gap-3 print:hidden">
                <button
                  onClick={() => exportToExcel(selectedStatement)}
                  className="px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded font-bold text-sm hover:bg-green-500/30"
                >
                  Export Excel
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-white/10 text-white border border-white/20 rounded font-bold text-sm hover:bg-white/20"
                >
                  Print PDF
                </button>
                <button
                  onClick={() => setSelectedStatement(null)}
                  className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded font-bold text-sm hover:bg-red-500/30"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Modal Summary */}
            <div className="grid grid-cols-3 gap-4 p-6 bg-white/[0.02] border-b border-white/10 print:bg-white print:border-gray-300">
              <div className="p-4 rounded bg-[#0B0F17] border border-white/5 print:bg-gray-50 print:border-gray-200">
                <p className="text-gray-500 text-xs uppercase font-bold tracking-wider mb-1 print:text-gray-600">
                  Gross Collected
                </p>
                <p className="text-lg font-mono text-white print:text-black">
                  ${selectedStatement.totalUsd.toFixed(2)}{" "}
                  <span className="text-sm text-gray-500 print:text-gray-500">
                    | {selectedStatement.totalLbp.toLocaleString()} LL
                  </span>
                </p>
              </div>
              <div className="p-4 rounded bg-[#0B0F17] border border-white/5 print:bg-gray-50 print:border-gray-200">
                <p className="text-gray-500 text-xs uppercase font-bold tracking-wider mb-1 print:text-gray-600">
                  Shipping Deducted
                </p>
                <p className="text-lg font-mono text-red-400 print:text-red-600">
                  -${selectedStatement.shippingUsd.toFixed(2)}{" "}
                  <span className="text-sm text-red-500/70 print:text-red-500/70">
                    | -{selectedStatement.shippingLbp.toLocaleString()} LL
                  </span>
                </p>
              </div>
              <div className="p-4 rounded bg-[#0B0F17] border border-cyan-500/30 print:bg-gray-50 print:border-gray-400">
                <p className="text-cyan-400 text-xs uppercase font-bold tracking-wider mb-1 print:text-black">
                  Net Payout
                </p>
                <p className="text-2xl font-mono text-green-400 font-bold print:text-black">
                  ${selectedStatement.netUsd.toFixed(2)}{" "}
                  <span className="text-lg text-yellow-400 print:text-black">
                    | {selectedStatement.netLbp.toLocaleString()} LL
                  </span>
                </p>
              </div>
            </div>

            {/* Modal Table (Allows expansion on print) */}
            <div className="overflow-y-auto p-6 print:overflow-visible print:max-h-none">
              {selectedStatement.orders &&
              selectedStatement.orders.length > 0 ? (
                <table className="w-full text-sm text-left">
                  <thead className="text-gray-500 text-[10px] uppercase border-b border-white/10 print:text-black print:border-gray-300">
                    <tr>
                      <th className="py-2 pr-4">Tracking ID</th>
                      <th className="py-2 pr-4">Customer Details</th>
                      <th className="py-2 pr-4 text-right">Orig Price</th>
                      <th className="py-2 pr-4 text-right">
                        Collected (USD/LBP)
                      </th>
                      <th className="py-2 pr-4 text-right">Shipping Cost</th>
                      <th className="py-2 text-right text-cyan-400 print:text-black">
                        Net Item Payout
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedStatement.orders.map((order: any) => {
                      const zoneRates =
                        selectedStatement.merchant?.zoneRates || [];
                      const rate = zoneRates.find(
                        (zr: any) =>
                          String(zr.zoneId) === String(order.zoneId) ||
                          String(zr.zoneId) === String(order.zone?.name),
                      );
                      const shipUsd =
                        rate?.rateUsd ?? rate?.rate ?? rate?.price ?? 0;
                      const shipLbp = rate?.rateLbp ?? 0;

                      const origUsd = order.amountUsd || 0;
                      const origLbp = order.amountLbp || 0;
                      const collUsd =
                        order.collectedUsd || order.amountUsd || 0;
                      const collLbp =
                        order.collectedLbp || order.amountLbp || 0;

                      return (
                        <tr
                          key={order.id}
                          className="border-b border-white/5 print:border-gray-200"
                        >
                          {/* Tracking */}
                          <td className="py-3 pr-4 font-mono text-cyan-400 print:text-black align-top">
                            {order.orderId}
                          </td>

                          {/* Customer Details */}
                          <td className="py-3 pr-4 text-gray-300 print:text-black align-top">
                            <div className="font-bold text-white print:text-black">
                              {order.customerName}
                            </div>
                            <div className="text-xs text-gray-500 print:text-gray-600 mt-0.5">
                              {order.customerPhone || "—"} &middot;{" "}
                              {order.customerAddress || "—"}
                            </div>
                          </td>

                          {/* Original Price */}
                          <td className="py-3 pr-4 text-right align-top">
                            <span className="text-gray-400 font-mono print:text-gray-700">
                              ${origUsd.toFixed(2)}
                            </span>
                            {origLbp > 0 && (
                              <span className="text-gray-600 text-xs font-mono block print:text-gray-500">
                                {origLbp.toLocaleString()} LL
                              </span>
                            )}
                          </td>

                          {/* Collected */}
                          <td className="py-3 pr-4 text-right align-top">
                            <span className="text-white font-mono print:text-black">
                              ${collUsd.toFixed(2)}
                            </span>
                            {collLbp > 0 && (
                              <span className="text-gray-500 text-xs font-mono block print:text-gray-600">
                                {collLbp.toLocaleString()} LL
                              </span>
                            )}
                          </td>

                          {/* Shipping */}
                          <td className="py-3 pr-4 text-right align-top">
                            <span className="text-red-400 font-mono print:text-black">
                              -${shipUsd.toFixed(2)}
                            </span>
                            {shipLbp > 0 && (
                              <span className="text-red-500/70 text-xs font-mono block print:text-gray-600">
                                -{shipLbp.toLocaleString()} LL
                              </span>
                            )}
                          </td>

                          {/* Net */}
                          <td className="py-3 text-right align-top">
                            <span className="text-green-400 font-bold font-mono print:text-black">
                              ${(collUsd - shipUsd).toFixed(2)}
                            </span>
                            {collLbp - shipLbp > 0 && (
                              <span className="text-yellow-400 font-bold text-xs font-mono block print:text-black">
                                {(collLbp - shipLbp).toLocaleString()} LL
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="text-center text-gray-500 py-8 text-sm">
                  No order details available for this statement.
                </div>
              )}

              {/* Print Footer */}
              <div className="hidden print:block mt-12 text-center text-sm text-gray-500">
                End of Statement #{selectedStatement.sequentialIndex} &mdash;
                Generated by Delivery System
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Small Stat Card ──────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  color,
  isSelected,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  isSelected?: boolean;
  onClick?: () => void;
}) {
  const glowMap: Record<string, string> = {
    cyan: "shadow-[0_0_15px_rgba(6,182,212,0.2)] border-cyan-500/30",
    green: "shadow-[0_0_15px_rgba(34,197,94,0.2)] border-green-500/30",
    amber: "shadow-[0_0_15px_rgba(245,158,11,0.2)] border-amber-500/30",
    purple: "shadow-[0_0_15px_rgba(168,85,247,0.2)] border-purple-500/30",
    red: "shadow-[0_0_15px_rgba(239,68,68,0.2)] border-red-500/30",
    slate: "shadow-[0_0_15px_rgba(148,163,184,0.15)] border-slate-500/30",
  };

  const textMap: Record<string, string> = {
    cyan: "text-cyan-400",
    green: "text-green-400",
    amber: "text-amber-400",
    purple: "text-purple-400",
    red: "text-red-400",
    slate: "text-slate-300",
  };

  const selectedBorder = isSelected
    ? "border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.35)]"
    : "";

  return (
    <div
      onClick={onClick}
      className={`backdrop-blur-xl bg-white/5 rounded-xl border p-4 cursor-pointer hover:border-cyan-500/50 transition-all duration-200 ${glowMap[color] || glowMap.cyan} ${selectedBorder}`}
    >
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p
        className={`text-2xl font-extrabold ${textMap[color] || textMap.cyan}`}
      >
        {value}
      </p>
    </div>
  );
}
