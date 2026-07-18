"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import SellerRateForm from "@/components/drivers/SellerRateForm";
import ConfirmPayoutModal from "@/components/payouts/ConfirmPayoutModal";
import * as XLSX from "xlsx";

type Tab = "assigned" | "delivered" | "returns" | "payouts" | "rates";

type SortKey =
  | "orderId"
  | "merchantName"
  | "customerName"
  | "customerPhone"
  | "customerAddress"
  | "zoneName"
  | "location"
  | "financialStatus"
  | "amountUsd"
  | "amountLbp"
  | "createdAt";
type SortDir = "asc" | "desc";

type SortConfig = { key: SortKey; dir: SortDir };

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

  // ─── Settlement Modal State ────────────────────────────────────────────
  const [treasuryBoxes, setTreasuryBoxes] = useState<any[]>([]);
  const [settlementModal, setSettlementModal] = useState<any | null>(null);
  const [settlementBoxId, setSettlementBoxId] = useState("");
  const [settlementAmountPaid, setSettlementAmountPaid] = useState(0);
  const [settling, setSettling] = useState(false);

  // ─── Sort State per Tab ─────────────────────────────────────────────────
  const [sortConfig, setSortConfig] = useState<Record<Tab, SortConfig | null>>({
    assigned: null,
    delivered: null,
    returns: null,
    payouts: null,
    rates: null,
  });

  const handleSort = (tab: Tab, key: SortKey) => {
    setSortConfig((prev) => {
      const current = prev[tab];
      let dir: SortDir = "asc";
      if (current && current.key === key) {
        dir = current.dir === "asc" ? "desc" : "asc";
      }
      return { ...prev, [tab]: { key, dir } };
    });
  };

  const sortOrders = <T extends Record<string, any>>(
    orders: T[],
    tab: Tab,
  ): T[] => {
    const config = sortConfig[tab];
    if (!config) return orders;
    return [...orders].sort((a, b) => {
      let aVal: any = a[config.key];
      let bVal: any = b[config.key];
      // Navigate nested objects
      if (config.key === "merchantName") {
        aVal = a.merchant?.merchantName || "";
        bVal = b.merchant?.merchantName || "";
      } else if (config.key === "zoneName") {
        aVal = a.zone?.name || "";
        bVal = b.zone?.name || "";
      }
      if (typeof aVal === "string" && typeof bVal === "string") {
        return config.dir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      if (typeof aVal === "number" && typeof bVal === "number") {
        return config.dir === "asc" ? aVal - bVal : bVal - aVal;
      }
      // Fallback: treat as strings
      return config.dir === "asc"
        ? String(aVal ?? "").localeCompare(String(bVal ?? ""))
        : String(bVal ?? "").localeCompare(String(aVal ?? ""));
    });
  };

  const formatDate = (dateStr: string | Date | null | undefined) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const SortHeader = ({
    tab,
    sortKey,
    children,
    className = "",
  }: {
    tab: Tab;
    sortKey: SortKey;
    children: React.ReactNode;
    className?: string;
  }) => {
    const config = sortConfig[tab];
    const isActive = config?.key === sortKey;
    return (
      <th
        className={`${className} cursor-pointer select-none hover:text-white transition-colors`}
        onClick={() => handleSort(tab, sortKey)}
        title={`Sort by ${sortKey}`}
      >
        <span className="flex items-center gap-1">
          {children}
          {isActive && (
            <span className="text-cyan-400 text-[10px]">
              {config.dir === "asc" ? "↑" : "↓"}
            </span>
          )}
        </span>
      </th>
    );
  };

  // ─── Seller Flat Rate Exceptions State ─────────────────────────────────
  const [sellerRates, setSellerRates] = useState<any[]>([]);
  const [merchants, setMerchants] = useState<any[]>([]);
  const [showRateModal, setShowRateModal] = useState(false);
  const [editingRate, setEditingRate] = useState<any>(null);
  const [rateForm, setRateForm] = useState({
    merchantId: "",
    rateUsd: "",
    rateLbp: "",
  });
  const [rateSaving, setRateSaving] = useState(false);

  // ─── Data Fetching ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/admin/drivers/${driverId}`)
      .then((res) => {
        if (!res.ok) {
          setDriver(null);
          setLoading(false);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data !== null) {
          setDriver(data);
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));

    fetch(`/api/drivers/${driverId}/payouts`)
      .then((res) => res.json())
      .then((data) => setPayouts(Array.isArray(data) ? data : []))
      .catch(() => {});

    // Fetch seller-specific flat rates
    fetch(`/api/admin/drivers/${driverId}/rates`)
      .then((res) => res.json())
      .then((data) => setSellerRates(Array.isArray(data) ? data : []))
      .catch(() => {});

    // Fetch merchants list for the rate form dropdown
    fetch("/api/admin/merchants")
      .then((res) => res.json())
      .then((data) => setMerchants(Array.isArray(data) ? data : []))
      .catch(() => {});

    // Fetch treasury boxes for settlement modal
    fetch("/api/admin/treasury")
      .then((res) => res.json())
      .then((data) => setTreasuryBoxes(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [driverId, activeTab]);

  // ─── Derived Data ───────────────────────────────────────────────────────
  const deliveries: any[] = driver?.deliveries || [];

  const assignedOrders = useMemo(
    () =>
      deliveries.filter((o: any) => {
        const loc = String(o.location).toUpperCase();
        return loc === "WITH_DRIVER" || loc === "ASSIGNED";
      }),
    [deliveries],
  );

  const deliveredOrders = useMemo(
    () =>
      deliveries.filter((o: any) => {
        const loc = String(o.location).toUpperCase();
        const fin = String(o.financialStatus).toUpperCase();
        const isUnpaid = !o.driverPayoutId;
        // Exclude PS (Paid to Seller) — these orders have been printed in a
        // merchant statement and should only appear in universal orders /
        // merchant profile "All Orders" tab, not in the driver delivered tab.
        const isPaidToSeller = fin === "PS";
        return loc === "DELIVERED" && isUnpaid && !isPaidToSeller;
      }),
    [deliveries],
  );

  const returnedOrders = useMemo(
    () =>
      deliveries.filter((o: any) => {
        const loc = String(o.location).toUpperCase();
        const fin = String(o.financialStatus).toUpperCase();
        return (loc === "RETURN" || loc === "RETURNED") && fin === "RWD";
      }),
    [deliveries],
  );

  // ─── Financial Aggregates ───────────────────────────────────────────────
  const assignedUsdSum = assignedOrders.reduce(
    (sum: number, o: any) => sum + (o.amountUsd ?? 0),
    0,
  );
  const assignedLbpSum = assignedOrders.reduce(
    (sum: number, o: any) => sum + (o.amountLbp ?? 0),
    0,
  );

  const totalDeliveredUsd = deliveredOrders.reduce(
    (sum: number, o: any) => sum + (o.amountUsd ?? 0),
    0,
  );
  const totalDeliveredLbp = deliveredOrders.reduce(
    (sum: number, o: any) => sum + (o.amountLbp ?? 0),
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

  // ─── Seller Rate Exceptions Map (merchantId -> rateUsd) ────────────────
  // Merges both DriverSellerRate AND DriverCashSellerRate exceptions.
  // DriverCashSellerRate takes precedence for cash sellers.
  const sellerExceptionMap = useMemo(() => {
    const map = new Map<string, number>();
    // First: DriverSellerRate (from "Seller Rate Exceptions" tab)
    const safeSellerRates = sellerRates || [];
    for (const sr of safeSellerRates) {
      if (sr.rateUsd > 0) {
        map.set(sr.merchantId, sr.rateUsd);
      }
    }
    // Second: DriverCashSellerRate (from driver.user, overrides for cash sellers)
    const cashRates = driver?.user?.driverCashSellerRates || [];
    for (const cr of cashRates) {
      if (cr.rateUsd > 0) {
        map.set(cr.merchantId, cr.rateUsd);
      }
    }
    console.log(
      "[Payout Pipeline] Seller Exception Map (merchantId → rateUsd):",
      Array.from(map.entries()),
    );
    return map;
  }, [sellerRates, driver]);

  const totalCommission = useMemo(() => {
    console.log(
      "[Payout Pipeline] Calculating totalCommission for",
      deliveredOrders.length,
      "delivered orders",
    );
    return deliveredOrders.reduce((sum: number, o: any) => {
      // Force string conversion to prevent integer/string mismatch failures
      const orderMerchantId = String(o.merchantId ?? o.merchant?.id);
      const orderZoneId = String(o.zoneId);
      // Tier 1: Seller Exception
      const exceptionRate = orderMerchantId
        ? sellerExceptionMap.get(orderMerchantId)
        : undefined;
      if (exceptionRate !== undefined) {
        console.log(
          `[Payout Pipeline] Order ${o.orderId} → Merch: ${orderMerchantId}, Using EXCEPTION rate: $${exceptionRate}`,
        );
        return sum + Number(exceptionRate || 0);
      }
      // Tier 2: Zone Rate
      const zoneRate = zoneRateMap.get(orderZoneId);
      console.log(
        `[Payout Pipeline] Order ${o.orderId} → Zone: ${orderZoneId}, Using ZONE rate: $${zoneRate ?? 0}`,
      );
      return sum + Number(zoneRate || 0);
    }, 0);
  }, [deliveredOrders, zoneRateMap, sellerExceptionMap]);

  const netPayoutUsd = totalDeliveredUsd - totalCommission;

  // ─── Payout Button Visibility (Bulletproof) ───────────────────────────
  // The "Generate Payout" button is active if there is AT LEAST ONE delivered,
  // unpaid order. It pays out ALL delivered orders — no checkbox selection needed.
  const canGeneratePayout = deliveredOrders?.length > 0;

  const selectedWdOrders = useMemo(
    () =>
      deliveredOrders.filter((o: any) => {
        const selectedOrderIds = new Set(selectedOrders);
        return selectedOrderIds.has(o.id);
      }),
    [deliveredOrders, selectedOrders],
  );

  // Bulletproof disabled logic for "Clear With Office" button
  const hasValidClearSelection = selectedWdOrders?.length > 0;

  const settlement = useMemo(() => {
    const totalCollectedUsd = selectedWdOrders.reduce(
      (sum: number, o: any) => sum + (o.collectedUsd ?? o.amountUsd ?? 0),
      0,
    );
    const totalCollectedLbp = selectedWdOrders.reduce(
      (sum: number, o: any) => sum + (o.collectedLbp ?? o.amountLbp ?? 0),
      0,
    );
    const commission = selectedWdOrders.reduce((sum: number, o: any) => {
      // Seller Rate Exception overrides zone rate
      const orderMerchantId = String(o.merchantId ?? o.merchant?.id ?? "");
      const orderZoneId = String(o.zoneId ?? "");
      const exceptionRate = orderMerchantId
        ? sellerExceptionMap.get(orderMerchantId)
        : undefined;
      const rate = exceptionRate ?? zoneRateMap.get(orderZoneId) ?? 0;
      console.log(
        `[Settlement Pipeline] Order ${o.orderId} → Merch: ${orderMerchantId}, Zone: ${orderZoneId}, Rate: $${rate}${exceptionRate !== undefined ? " (EXCEPTION)" : " (ZONE)"}`,
      );
      return sum + rate;
    }, 0);
    const net = totalCollectedUsd - commission;
    return { totalCollectedUsd, totalCollectedLbp, commission, net };
  }, [selectedWdOrders, zoneRateMap, sellerExceptionMap]);

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
    const [driverRes, payoutsRes, ratesRes] = await Promise.all([
      fetch(`/api/admin/drivers/${driverId}`),
      fetch(`/api/drivers/${driverId}/payouts`),
      fetch(`/api/admin/drivers/${driverId}/rates`),
    ]);
    setDriver(await driverRes.json());
    setPayouts(await payoutsRes.json());
    const ratesData = await ratesRes.json();
    setSellerRates(Array.isArray(ratesData) ? ratesData : []);
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
          body: JSON.stringify({
            id: orderId,
            location: newLocation,
            // Synchronize financialStatus so the UI filters match:
            // "Delivered" tab expects location === "DELIVERED" && financialStatus === "WD"
            ...(newLocation === "DELIVERED" && { financialStatus: "WD" }),
            ...(newLocation === "RETURN" && {
              financialStatus: "Re",
              status: "Re",
            }),
          }),
        }),
      ),
    );
    setSelectedOrders([]);
    await refreshData();
  };

  // ─── Bulk Return to Warehouse Handler (RWD -> Re) ───────────────────────
  const [returningToWarehouse, setReturningToWarehouse] = useState(false);
  const handleReturnToWarehouse = async () => {
    if (selectedOrders.length === 0) return;
    setReturningToWarehouse(true);
    try {
      const res = await fetch("/api/admin/orders/returns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: selectedOrders, newStatus: "Re" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update returns");
      }
      setSelectedOrders([]);
      await refreshData();
    } catch (e: any) {
      alert(e.message || "Error updating returns");
    } finally {
      setReturningToWarehouse(false);
    }
  };

  // ─── Export Helpers ─────────────────────────────────────────────────────────
  const exportOrdersToExcel = (orders: any[], filename: string) => {
    const rows = orders.map((o) => ({
      "Order ID": o.orderId,
      Customer: o.customerName,
      Phone: o.customerPhone || "",
      Address: o.customerAddress || "",
      Zone: o.zone?.name || "",
      Location: o.location,
      "Financial Status": o.financialStatus || "",
      "Amount USD": o.amountUsd ?? 0,
      "Amount LBP": o.amountLbp ?? 0,
      Merchant: o.merchant?.merchantName || o.merchantId || "",
      Driver: o.driver ? `${o.driver.firstName} ${o.driver.lastName}` : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    XLSX.writeFile(wb, `${filename}.xlsx`);
  };

  const openOrdersInNewTab = (orders: any[]) => {
    const orderIds = orders.map((o) => o.id).join(",");
    window.open(`/print/orders?ids=${orderIds}`, "_blank");
  };

  // ─── Seller Flat Rate CRUD Handlers ────────────────────────────────────
  const openAddRateModal = () => {
    setEditingRate(null);
    setRateForm({ merchantId: "", rateUsd: "", rateLbp: "" });
    setShowRateModal(true);
  };

  const openEditRateModal = (rate: any) => {
    setEditingRate(rate);
    setRateForm({
      merchantId: rate.merchantId,
      rateUsd: String(rate.rateUsd ?? 0),
      rateLbp: String(rate.rateLbp ?? 0),
    });
    setShowRateModal(true);
  };

  const handleSaveRate = async () => {
    if (!rateForm.merchantId) return alert("Please select a seller.");
    setRateSaving(true);
    try {
      const body = {
        merchantId: rateForm.merchantId,
        rateUsd: parseFloat(rateForm.rateUsd) || 0,
        rateLbp: parseFloat(rateForm.rateLbp) || 0,
      };
      const url = `/api/admin/drivers/${driverId}/rates`;
      const method = editingRate ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingRate ? { ...body, rateId: editingRate.id } : body,
        ),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save rate");
      }
      setShowRateModal(false);
      // Refresh rates
      const ratesRes = await fetch(`/api/admin/drivers/${driverId}/rates`);
      setSellerRates(await ratesRes.json());
    } catch (e: any) {
      alert(e.message || "Error saving rate");
    } finally {
      setRateSaving(false);
    }
  };

  const handleDeleteRate = async (rateId: number) => {
    if (!window.confirm("Delete this seller flat rate exception?")) return;
    try {
      const res = await fetch(
        `/api/admin/drivers/${driverId}/rates?rateId=${rateId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete");
      setSellerRates((prev) => prev.filter((r) => r.id !== rateId));
    } catch (e: any) {
      alert(e.message || "Error deleting rate");
    }
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

  // ─── Settlement Submit Handler ─────────────────────────────────────────
  const handleSettlementSubmit = async () => {
    if (!settlementModal || !settlementBoxId) return;
    setSettling(true);
    try {
      const res = await fetch("/api/admin/drivers/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payoutId: settlementModal.id,
          treasuryBoxId: settlementBoxId,
          amountPaidUsd: settlementAmountPaid,
          amountPaidLbp: 0,
        }),
      });
      const result = await res.json();
      if (result.success) {
        setSettlementModal(null);
        setSettlementBoxId("");
        await refreshData();
      } else {
        alert(result.error || "Failed to process settlement.");
      }
    } catch (error) {
      console.error(error);
      alert("Network error during settlement.");
    } finally {
      setSettling(false);
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
              ["rates", `Seller Rates (${sellerRates.length})`],
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
          <>
            {selectedOrders.length > 0 && (
              <div className="mb-4 flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-400">
                  {selectedOrders.length} of {assignedOrders.length} selected
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => openOrdersInNewTab(assignedOrders)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                    title="Open all in new tab"
                  >
                    🔗 All
                  </button>
                  <button
                    onClick={() =>
                      exportOrdersToExcel(
                        assignedOrders,
                        `assigned_all_${driverId}`,
                      )
                    }
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-colors"
                    title="Download all as Excel"
                  >
                    📊 Excel
                  </button>
                  <button
                    onClick={() => {
                      const orderIds = assignedOrders
                        .map((o: any) => o.id)
                        .join(",");
                      window.open(
                        `/orders/print?ids=${orderIds}&pdf=true`,
                        "_blank",
                      );
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                    title="Download all as PDF"
                  >
                    📑 PDF
                  </button>
                </div>
              </div>
            )}
            <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
              {/* ── Bulk Action Toolbar ──────────────────────────────────── */}
              {selectedOrders.length > 0 && (
                <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-cyan-500/5 flex-wrap">
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
                  <div className="flex items-center gap-1.5 ml-auto border-l border-white/10 pl-3">
                    <button
                      onClick={() => {
                        const sel = assignedOrders.filter((o: any) =>
                          selectedOrders.includes(o.id),
                        );
                        openOrdersInNewTab(sel);
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                      title="Open in new tab"
                    >
                      🔗 New Tab
                    </button>
                    <button
                      onClick={() => {
                        const sel = assignedOrders.filter((o: any) =>
                          selectedOrders.includes(o.id),
                        );
                        exportOrdersToExcel(sel, `assigned_orders_${driverId}`);
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-colors"
                      title="Download as Excel"
                    >
                      📊 Excel
                    </button>
                    <button
                      onClick={() => {
                        const sel = assignedOrders.filter((o: any) =>
                          selectedOrders.includes(o.id),
                        );
                        const orderIds = sel.map((o: any) => o.id).join(",");
                        window.open(
                          `/orders/print?ids=${orderIds}&pdf=true`,
                          "_blank",
                        );
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                      title="Download as PDF"
                    >
                      📑 PDF
                    </button>
                  </div>
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
                            toggleSelectAll(
                              assignedOrders.map((o: any) => o.id),
                            )
                          }
                          className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                        />
                      </th>
                      <SortHeader tab="assigned" sortKey="orderId">
                        Tracking ID
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="createdAt">
                        Date Received
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="merchantName">
                        Seller
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="customerName">
                        Customer
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="customerPhone">
                        Phone
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="customerAddress">
                        Address
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="zoneName">
                        Zone
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="location">
                        Location
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="financialStatus">
                        Fin. Status
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="amountUsd">
                        <span className="text-right block">$ Amt</span>
                      </SortHeader>
                      <SortHeader tab="assigned" sortKey="amountLbp">
                        <span className="text-right block">LL Amt</span>
                      </SortHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {sortOrders(assignedOrders, "assigned").length === 0 ? (
                      <tr>
                        <td
                          colSpan={12}
                          className="text-center py-10 text-gray-500 italic"
                        >
                          No active assignments for this driver.
                        </td>
                      </tr>
                    ) : (
                      sortOrders(assignedOrders, "assigned").map(
                        (order: any) => (
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
                            <td className="px-5 py-3.5 text-gray-300 text-sm whitespace-nowrap">
                              {formatDate(order.createdAt)}
                            </td>
                            <td className="px-5 py-3.5 text-white text-sm">
                              {order.merchant?.merchantName || "—"}
                            </td>
                            <td className="px-5 py-3.5 text-white text-sm">
                              {order.customerName}
                            </td>
                            <td className="px-5 py-3.5 text-gray-300 text-sm font-mono">
                              {order.customerPhone || "—"}
                            </td>
                            <td className="px-5 py-3.5 text-gray-400 text-sm max-w-[200px] truncate">
                              {order.customerAddress || "—"}
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
                            <td className="px-5 py-3.5">
                              <span className="px-2 py-1 text-[10px] font-bold rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                                {order.financialStatus || "—"}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-right text-green-400 font-mono text-sm">
                              ${(order.amountUsd ?? 0).toFixed(2)}
                            </td>
                            <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                              {(order.amountLbp ?? 0).toLocaleString()} LL
                            </td>
                          </tr>
                        ),
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── Tab: Delivered ─────────────────────────────────────────── */}
        {activeTab === "delivered" && (
          <>
            <div className="mb-4 flex items-center gap-3 flex-wrap">
              <button
                onClick={() => setShowPayoutModal(true)}
                disabled={!canGeneratePayout}
                className={`px-5 py-2.5 rounded-lg font-bold text-white bg-cyan-600 transition-colors text-sm shadow-lg shadow-cyan-500/20 ${!canGeneratePayout ? "opacity-50 cursor-not-allowed" : "hover:bg-cyan-500"}`}
              >
                ⚡ Generate Payout Batch
              </button>
              <div className="flex items-center gap-1.5 border-l border-white/10 pl-3">
                <button
                  onClick={() => openOrdersInNewTab(deliveredOrders)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                  title="Open all in new tab"
                >
                  🔗 All
                </button>
                <button
                  onClick={() =>
                    exportOrdersToExcel(
                      deliveredOrders,
                      `delivered_all_${driverId}`,
                    )
                  }
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-colors"
                  title="Download all as Excel"
                >
                  📊 Excel
                </button>
                <button
                  onClick={() => {
                    const orderIds = deliveredOrders
                      .map((o: any) => o.id)
                      .join(",");
                    window.open(
                      `/orders/print?ids=${orderIds}&pdf=true`,
                      "_blank",
                    );
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                  title="Download all as PDF"
                >
                  📑 PDF
                </button>
              </div>
            </div>

            <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
              {/* ── Settlement Action Bar (sticky) ────────────────────────── */}
              <div
                className={`sticky top-0 z-10 flex flex-wrap items-center gap-4 px-5 py-4 border-b border-white/10 backdrop-blur-md ${hasValidClearSelection ? "bg-gradient-to-r from-emerald-500/10 to-cyan-500/10" : "bg-white/[0.02]"}`}
              >
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

                <div className="flex items-center gap-1.5 border-l border-white/10 pl-3 ml-2">
                  <button
                    onClick={() => openOrdersInNewTab(selectedWdOrders)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                    title="Open in new tab"
                  >
                    🔗 New Tab
                  </button>
                  <button
                    onClick={() =>
                      exportOrdersToExcel(
                        selectedWdOrders,
                        `delivered_orders_${driverId}`,
                      )
                    }
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-colors"
                    title="Download as Excel"
                  >
                    📊 Excel
                  </button>
                  <button
                    onClick={() => {
                      const orderIds = selectedWdOrders
                        .map((o: any) => o.id)
                        .join(",");
                      window.open(
                        `/orders/print?ids=${orderIds}&pdf=true`,
                        "_blank",
                      );
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                    title="Download as PDF"
                  >
                    📑 PDF
                  </button>
                </div>
                <button
                  onClick={handleClearWithOffice}
                  disabled={!hasValidClearSelection || clearing}
                  className={`px-5 py-2 rounded-lg font-bold text-white bg-emerald-600 transition-colors text-sm shadow-lg shadow-emerald-500/20 ${!hasValidClearSelection || clearing ? "opacity-50 cursor-not-allowed" : "hover:bg-emerald-500"}`}
                >
                  {clearing ? "Clearing…" : "✓ Clear With Office"}
                </button>
              </div>

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
                      <SortHeader tab="delivered" sortKey="orderId">
                        Tracking ID
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="createdAt">
                        Date Received
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="merchantName">
                        Seller
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="customerName">
                        Customer
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="customerAddress">
                        Address
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="zoneName">
                        Zone
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="financialStatus">
                        Fin. Status
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="amountUsd">
                        <span className="text-right block">$ Amt</span>
                      </SortHeader>
                      <SortHeader tab="delivered" sortKey="amountLbp">
                        <span className="text-right block">LL Amt</span>
                      </SortHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {sortOrders(deliveredOrders, "delivered").length === 0 ? (
                      <tr>
                        <td
                          colSpan={10}
                          className="text-center py-10 text-gray-500 italic"
                        >
                          No delivered orders awaiting payout.
                        </td>
                      </tr>
                    ) : (
                      sortOrders(deliveredOrders, "delivered").map(
                        (order: any) => {
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
                              <td className="px-5 py-3.5 text-gray-300 text-sm whitespace-nowrap">
                                {formatDate(order.createdAt)}
                              </td>
                              <td className="px-5 py-3.5 text-white text-sm">
                                {order.merchant?.merchantName || "—"}
                              </td>
                              <td className="px-5 py-3.5 text-white text-sm">
                                {order.customerName}
                              </td>
                              <td className="px-5 py-3.5 text-gray-400 text-sm max-w-[200px] truncate">
                                {order.customerAddress || "—"}
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
                                ${(order.amountUsd ?? 0).toFixed(2)}
                              </td>
                              <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                                {(order.amountLbp ?? 0).toLocaleString()} LL
                              </td>
                            </tr>
                          );
                        },
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── Tab: Returns ───────────────────────────────────────────── */}
        {activeTab === "returns" && (
          <>
            {/* ── Bulk Action Toolbar ──────────────────────────────────── */}
            {selectedOrders.length > 0 && (
              <div className="mb-4 flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-400">
                  {selectedOrders.length} of {returnedOrders.length} selected
                </span>
                <button
                  onClick={handleReturnToWarehouse}
                  disabled={returningToWarehouse}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-orange-600 hover:bg-orange-500 transition-colors shadow-lg shadow-orange-500/20 ${returningToWarehouse ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {returningToWarehouse
                    ? "Updating…"
                    : "📦 Add to return's warehouse"}
                </button>
                <div className="flex items-center gap-1.5 ml-auto border-l border-white/10 pl-3">
                  <button
                    onClick={() => {
                      const sel = returnedOrders.filter((o: any) =>
                        selectedOrders.includes(o.id),
                      );
                      const orderIds = sel.map((o: any) => o.id).join(",");
                      window.open(`/print/orders?ids=${orderIds}`, "_blank");
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                  >
                    🔗 New Tab
                  </button>
                  <button
                    onClick={() => {
                      const sel = returnedOrders.filter((o: any) =>
                        selectedOrders.includes(o.id),
                      );
                      exportOrdersToExcel(sel, `returns_${driverId}`);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-colors"
                  >
                    📊 Excel
                  </button>
                </div>
              </div>
            )}
            <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                      <th className="px-5 py-4 font-semibold w-10">
                        <input
                          type="checkbox"
                          checked={
                            returnedOrders.length > 0 &&
                            selectedOrders.length === returnedOrders.length
                          }
                          onChange={() =>
                            toggleSelectAll(
                              returnedOrders.map((o: any) => o.id),
                            )
                          }
                          className="rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                        />
                      </th>
                      <SortHeader tab="returns" sortKey="orderId">
                        Tracking ID
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="createdAt">
                        Date Received
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="merchantName">
                        Seller
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="customerName">
                        Customer
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="customerAddress">
                        Address
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="zoneName">
                        Zone
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="location">
                        Location
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="financialStatus">
                        Fin. Status
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="amountUsd">
                        <span className="text-right block">$ Amt</span>
                      </SortHeader>
                      <SortHeader tab="returns" sortKey="amountLbp">
                        <span className="text-right block">LL Amt</span>
                      </SortHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {sortOrders(returnedOrders, "returns").length === 0 ? (
                      <tr>
                        <td
                          colSpan={11}
                          className="text-center py-10 text-gray-500 italic"
                        >
                          No returned orders currently with this driver.
                        </td>
                      </tr>
                    ) : (
                      sortOrders(returnedOrders, "returns").map(
                        (order: any) => (
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
                            <td className="px-5 py-3.5 text-gray-300 text-sm whitespace-nowrap">
                              {formatDate(order.createdAt)}
                            </td>
                            <td className="px-5 py-3.5 text-white text-sm">
                              {order.merchant?.merchantName || "—"}
                            </td>
                            <td className="px-5 py-3.5 text-white text-sm">
                              {order.customerName}
                            </td>
                            <td className="px-5 py-3.5 text-gray-400 text-sm max-w-[200px] truncate">
                              {order.customerAddress || "—"}
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
                              <span className="px-2 py-1 text-[10px] font-bold rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">
                                RWD
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-right text-red-400 font-mono text-sm">
                              ${(order.amountUsd ?? 0).toFixed(2)}
                            </td>
                            <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                              {(order.amountLbp ?? 0).toLocaleString()} LL
                            </td>
                          </tr>
                        ),
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
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
                      Prev. Debt
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
                        colSpan={10}
                        className="text-center py-10 text-gray-500 italic"
                      >
                        No pending payout batches for this driver.
                      </td>
                    </tr>
                  ) : (
                    payouts.map((payout: any) => {
                      const ordersNet =
                        (payout.netUsd || 0) - (payout.previousDebtUsd || 0);
                      const hasPreviousDebt =
                        (payout.previousDebtUsd || 0) > 0.01;
                      return (
                        <tr
                          key={payout.id}
                          className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="px-5 py-3.5 font-mono text-cyan-400 text-sm">
                            {driver.driverId}-
                            {String(payout.sequentialIndex || 1).padStart(
                              2,
                              "0",
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-gray-300 text-sm">
                            {new Date(payout.createdAt).toLocaleString(
                              "en-US",
                              {
                                timeZone: "Asia/Beirut",
                                dateStyle: "medium",
                                timeStyle: "short",
                              },
                            )}
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
                          <td className="px-5 py-3.5 text-right font-mono text-sm">
                            {hasPreviousDebt ? (
                              <span className="text-red-400">
                                +${(payout.previousDebtUsd || 0).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-gray-600">$0.00</span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right font-mono text-sm">
                            <div className="flex flex-col items-end gap-0.5">
                              {hasPreviousDebt && (
                                <span className="text-[10px] text-gray-500">
                                  Orders: ${ordersNet.toFixed(2)}
                                </span>
                              )}
                              <span
                                className={`font-bold ${hasPreviousDebt ? "text-cyan-400 text-xs" : "text-cyan-400"}`}
                              >
                                ${(payout.netUsd || 0).toFixed(2)}
                              </span>
                              {hasPreviousDebt && (
                                <span className="text-[10px] text-red-400">
                                  +$
                                  {(payout.previousDebtUsd || 0).toFixed(
                                    2,
                                  )}{" "}
                                  prev. debt
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-right text-gray-400 text-sm">
                            {payout.orders?.length || 0}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex gap-1.5 justify-end">
                              <button
                                onClick={() => {
                                  setSettlementModal(payout);
                                  setSettlementBoxId("");
                                  setSettlementAmountPaid(payout.netUsd || 0);
                                }}
                                className="px-3 py-1.5 rounded text-xs font-semibold bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/40 transition-colors"
                              >
                                Receive Cash & Clear
                              </button>
                              <button
                                onClick={() => setSelectedPayout(payout)}
                                className="px-3 py-1.5 rounded text-xs font-semibold bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-600/40 transition-colors"
                              >
                                View
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Tab: Seller Flat Rate Exceptions ─────────────────────────── */}
        {activeTab === "rates" && (
          <div className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden backdrop-blur-md">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div>
                <h3 className="text-white font-semibold text-sm">
                  Seller Flat Rate Exceptions
                </h3>
                <p className="text-gray-500 text-xs mt-0.5">
                  Custom flat rates override zone-based commission for specific
                  sellers.
                </p>
              </div>
              <button
                onClick={openAddRateModal}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-500 transition-colors shadow-lg shadow-cyan-500/20"
              >
                + Add Exception
              </button>
            </div>

            {/* Inline Seller Rate Exception Form */}
            <SellerRateForm driverId={driverId} merchants={merchants} />

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-5 py-4 font-semibold">Seller</th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Rate USD
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Rate LBP
                    </th>
                    <th className="px-5 py-4 font-semibold text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sellerRates.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="text-center py-10 text-gray-500 italic"
                      >
                        No seller-specific flat rate exceptions configured.
                      </td>
                    </tr>
                  ) : (
                    sellerRates.map((rate: any) => (
                      <tr
                        key={rate.id}
                        className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="px-5 py-3.5 text-white text-sm">
                          {rate.merchant?.merchantName ||
                            `Seller #${rate.merchant?.merchantId || rate.merchantId}`}
                        </td>
                        <td className="px-5 py-3.5 text-right text-green-400 font-mono text-sm">
                          ${(rate.rateUsd ?? 0).toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 text-right text-yellow-400 font-mono text-sm">
                          {(rate.rateLbp ?? 0).toLocaleString()} LL
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex gap-1.5 justify-end">
                            <button
                              onClick={() => openEditRateModal(rate)}
                              className="px-3 py-1.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteRate(rate.id)}
                              className="px-3 py-1.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Rate Add/Edit Modal */}
            {showRateModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                <div className="bg-[#121824] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 mx-4">
                  <h2 className="text-xl font-bold text-white mb-1">
                    {editingRate
                      ? "Edit Flat Rate Exception"
                      : "Add Flat Rate Exception"}
                  </h2>
                  <p className="text-gray-400 text-sm mb-6">
                    Set a custom flat commission rate for a specific seller.
                  </p>

                  <div className="space-y-4 mb-6">
                    {/* Seller Dropdown */}
                    <div>
                      <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">
                        Seller
                      </label>
                      <select
                        value={rateForm.merchantId}
                        onChange={(e) =>
                          setRateForm((prev) => ({
                            ...prev,
                            merchantId: e.target.value,
                          }))
                        }
                        disabled={!!editingRate}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 text-white border border-gray-700 outline-none focus:border-cyan-500 text-sm disabled:opacity-50"
                      >
                        <option value="">Select a seller…</option>
                        {merchants.map((m: any) => (
                          <option key={m.id} value={m.id}>
                            {m.merchantName} (#{m.merchantId})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Rate USD */}
                    <div>
                      <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">
                        Flat Rate USD
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="e.g. 4.00"
                        value={rateForm.rateUsd}
                        onChange={(e) =>
                          setRateForm((prev) => ({
                            ...prev,
                            rateUsd: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 text-white border border-gray-700 outline-none focus:border-cyan-500 text-sm"
                      />
                    </div>

                    {/* Rate LBP */}
                    <div>
                      <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">
                        Flat Rate LBP
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        placeholder="e.g. 120000"
                        value={rateForm.rateLbp}
                        onChange={(e) =>
                          setRateForm((prev) => ({
                            ...prev,
                            rateLbp: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 text-white border border-gray-700 outline-none focus:border-cyan-500 text-sm"
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowRateModal(false)}
                      disabled={rateSaving}
                      className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] transition-colors text-sm font-semibold disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveRate}
                      disabled={rateSaving}
                      className="flex-1 px-4 py-2.5 rounded-lg font-bold text-white bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors text-sm shadow-lg shadow-cyan-500/20"
                    >
                      {rateSaving
                        ? "Saving…"
                        : editingRate
                          ? "Update Rate"
                          : "Add Rate"}
                    </button>
                  </div>
                </div>
              </div>
            )}
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
              <div className="grid grid-cols-4 gap-3 mb-6">
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
                    Orders Net
                  </p>
                  <p className="text-cyan-400 font-mono text-sm font-bold">
                    $
                    {(
                      (selectedPayout.netUsd || 0) -
                      (selectedPayout.previousDebtUsd || 0)
                    ).toFixed(2)}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Net USD
                  </p>
                  <p className="text-cyan-400 font-mono text-sm font-bold">
                    ${(selectedPayout.netUsd || 0).toFixed(2)}
                  </p>
                  {(selectedPayout.previousDebtUsd || 0) > 0.01 && (
                    <p className="text-red-400 text-[10px] mt-0.5">
                      +${(selectedPayout.previousDebtUsd || 0).toFixed(2)} prev.
                      debt
                    </p>
                  )}
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
                            ${(order.amountUsd ?? 0).toFixed(2)}
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
                                              s + (o.amountUsd ?? 0),
                                            0,
                                          );
                                        const newTotalLbp =
                                          updatedOrders.reduce(
                                            (s: number, o: any) =>
                                              s + (o.amountLbp ?? 0),
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

        {/* ── Settlement Modal (Receive Cash & Clear) ─────────────────── */}
        {settlementModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-[#121824] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 mx-4">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    Receive Cash & Clear
                  </h2>
                  <p className="text-gray-400 text-sm mt-1">
                    {driver.driverId}-
                    {String(settlementModal.sequentialIndex || 1).padStart(
                      2,
                      "0",
                    )}{" "}
                    &middot;{" "}
                    {new Date(settlementModal.createdAt).toLocaleString(
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
                  onClick={() => {
                    setSettlementModal(null);
                    setSettlementBoxId("");
                  }}
                  className="text-gray-500 hover:text-white transition-colors text-xl leading-none"
                >
                  ✕
                </button>
              </div>

              {/* Read-only Summary */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Payout Batch #
                  </p>
                  <p className="text-white font-mono text-sm font-bold">
                    {driver.driverId}-
                    {String(settlementModal.sequentialIndex || 1).padStart(
                      2,
                      "0",
                    )}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Total Orders
                  </p>
                  <p className="text-white font-mono text-sm font-bold">
                    {settlementModal.orders?.length || 0}
                  </p>
                </div>
                <div className="bg-[#0B0F17] border border-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider">
                    Net Payout Amount
                  </p>
                  <p className="text-cyan-400 font-mono text-sm font-bold">
                    ${(settlementModal.netUsd || 0).toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Treasury Box Dropdown */}
              <div className="mb-4">
                <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">
                  Treasury Box
                </label>
                <select
                  value={settlementBoxId}
                  onChange={(e) => setSettlementBoxId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 text-white border border-gray-700 outline-none focus:border-cyan-500 text-sm"
                >
                  <option value="">-- Select a Treasury Box --</option>
                  {treasuryBoxes.map((box: any) => (
                    <option key={box.id} value={box.id}>
                      {box.name} {box.isPositive ? "(Asset)" : "(Liability)"} —
                      ${(box.balanceUsd ?? 0).toFixed(2)}
                    </option>
                  ))}
                </select>
                {!settlementBoxId && (
                  <p className="text-xs text-red-400 mt-1">
                    A treasury box must be selected.
                  </p>
                )}
              </div>

              {/* Amount Paid Input */}
              <div className="mb-4">
                <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">
                  Amount Paid (USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={settlementAmountPaid}
                  onChange={(e) =>
                    setSettlementAmountPaid(parseFloat(e.target.value) || 0)
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 text-white border border-gray-700 outline-none focus:border-cyan-500 text-sm font-mono"
                />
              </div>

              {/* Remaining Debt Display */}
              {(() => {
                const remaining =
                  (settlementModal.netUsd || 0) - settlementAmountPaid;
                const hasDeficit = remaining > 0.01;
                return (
                  <div
                    className={`rounded-lg p-4 text-center mb-6 ${
                      hasDeficit
                        ? "bg-red-900/30 border border-red-500/40"
                        : "bg-green-900/30 border border-green-500/40"
                    }`}
                  >
                    <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                      Remaining Debt
                    </p>
                    <p
                      className={`text-2xl font-bold font-mono ${
                        hasDeficit ? "text-red-400" : "text-green-400"
                      }`}
                    >
                      ${remaining.toFixed(2)}
                    </p>
                    {hasDeficit && (
                      <p className="text-xs text-red-300 mt-1">
                        This deficit will be carried over to the driver's next
                        payout.
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setSettlementModal(null);
                    setSettlementBoxId("");
                  }}
                  disabled={settling}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/[0.05] transition-colors text-sm font-semibold disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSettlementSubmit}
                  disabled={!settlementBoxId || settling}
                  className="flex-1 px-4 py-2.5 rounded-lg font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors text-sm shadow-lg shadow-emerald-500/20"
                >
                  {settling ? "Processing…" : "Confirm Settlement"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Payout Confirmation Modal ──────────────────────────────── */}
        {showPayoutModal && (
          <ConfirmPayoutModal
            orders={deliveredOrders}
            driverSellerRates={sellerRates}
            driverZoneRates={driverZoneRates}
            totalUsd={totalDeliveredUsd}
            totalLbp={totalDeliveredLbp}
            carriedDebtUsd={driver?.carriedDebtUsd ?? 0}
            carriedDebtLbp={driver?.carriedDebtLbp ?? 0}
            onConfirm={handleGeneratePayout}
            onCancel={() => setShowPayoutModal(false)}
            submitting={submitting}
          />
        )}
      </div>
    </div>
  );
}
