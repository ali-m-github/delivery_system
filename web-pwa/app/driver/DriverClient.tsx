"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import SettingsModal from "@/components/SettingsModal";

type Order = {
  id: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  amountUsd: number;
  amountLbp: number;
  collectedUsd: number;
  collectedLbp: number;
  location: string;
  financialStatus?: string;
  notes?: string | null;
  zoneId: string;
};

type ZoneRate = {
  zoneId: string;
  rate: number;
};

type Driver = {
  id: string;
  firstName: string;
  lastName: string;
  deliveries: Order[];
  zoneRates: ZoneRate[];
};

type Props = {
  driver: Driver;
};

const NOTE_OPTIONS = [
  "Canceled by customer",
  "Wrong Item",
  "No answer",
  "Refused to receive the package upon arrival",
  "Wrong number",
] as const;

export default function DriverClient({ driver }: Props) {
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<Order[]>(driver.deliveries);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [collectedUsd, setCollectedUsd] = useState("");
  const [collectedLbp, setCollectedLbp] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);

  // ── Logout Handler ──────────────────────────────────────────────────
  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch (error) {
      console.error("Logout failed");
    }
  };

  // ── Postpone Modal State ─────────────────────────────────────────────
  const [postponeModal, setPostponeModal] = useState<string | null>(null);
  const [postponeDate, setPostponeDate] = useState("");
  const [postponeComment, setPostponeComment] = useState("");

  // ── Note Modal State ─────────────────────────────────────────────────
  const [noteModal, setNoteModal] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<string>("");
  const [customNote, setCustomNote] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  // ── Tab State ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"ACTIVE" | "DELIVERED">("ACTIVE");

  // ── Settings Modal State ─────────────────────────────────────────────
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // ── Payout Modal State ───────────────────────────────────────────────
  const [payoutModalOpen, setPayoutModalOpen] = useState(false);

  // ── Split orders into active / delivered ─────────────────────────────
  const activeOrders = useMemo(
    () =>
      deliveries.filter(
        (o) => o.location === "ASSIGNED" || o.location === "WITH_DRIVER",
      ),
    [deliveries],
  );

  const deliveredOrders = useMemo(
    () =>
      deliveries.filter(
        (o) => o.location === "DELIVERED" && o.financialStatus === "WD",
      ),
    [deliveries],
  );

  // ── Payout Receipt (Settlement Calculator) ────────────────────────────
  const payoutReceipt = useMemo(() => {
    const totalUsdCollected = deliveredOrders.reduce(
      (sum, o) => sum + (o.collectedUsd || 0),
      0,
    );
    const totalLbpCollected = deliveredOrders.reduce(
      (sum, o) => sum + (o.collectedLbp || 0),
      0,
    );

    const totalCommissionUsd = deliveredOrders.reduce((sum, o) => {
      const zoneRate = driver.zoneRates.find((zr) => zr.zoneId === o.zoneId);
      return sum + (zoneRate?.rate || 0);
    }, 0);

    const netToOfficeUsd = totalUsdCollected - totalCommissionUsd;
    const netToOfficeLbp = totalLbpCollected;

    return {
      totalUsdCollected,
      totalLbpCollected,
      totalCommissionUsd,
      netToOfficeUsd,
      netToOfficeLbp,
    };
  }, [deliveredOrders, driver.zoneRates]);

  const activeCount = activeOrders.length;

  // ── Mark Delivered (Custom Amount) ────────────────────────────────────
  const handleMarkDelivered = async (orderId: string) => {
    setSubmitting(orderId);
    const collectedUsdNum = parseFloat(collectedUsd) || 0;
    const collectedLbpNum = parseFloat(collectedLbp) || 0;
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: orderId,
          location: "DELIVERED",
          financialStatus: "WD",
          collectedUsd: collectedUsdNum,
          collectedLbp: collectedLbpNum,
          driverActionLog: "DELIVERED (Custom Amount)",
        }),
      });
      if (res.ok) {
        setDeliveries((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  location: "DELIVERED",
                  financialStatus: "WD",
                  collectedUsd: collectedUsdNum,
                  collectedLbp: collectedLbpNum,
                }
              : o,
          ),
        );
        setExpandedOrderId(null);
        setCollectedUsd("");
        setCollectedLbp("");
      }
    } finally {
      setSubmitting(null);
    }
  };

  // ── Quick Deliver (Full Amount) ───────────────────────────────────────
  const handleQuickDeliver = async (order: Order) => {
    const confirmed = window.confirm(
      `Deliver and collect full amount: $${order.amountUsd} | ${order.amountLbp} LL?`,
    );
    if (!confirmed) return;

    setSubmitting(order.id);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: order.id,
          location: "DELIVERED",
          financialStatus: "WD",
          collectedUsd: order.amountUsd,
          collectedLbp: order.amountLbp,
          driverActionLog: "DELIVERED (Full Amount)",
        }),
      });
      if (res.ok) {
        setDeliveries((prev) =>
          prev.map((o) =>
            o.id === order.id
              ? {
                  ...o,
                  location: "DELIVERED",
                  financialStatus: "WD",
                  collectedUsd: order.amountUsd,
                  collectedLbp: order.amountLbp,
                }
              : o,
          ),
        );
      }
    } finally {
      setSubmitting(null);
    }
  };

  // ── Mark Return ───────────────────────────────────────────────────────
  const handleMarkReturn = async (orderId: string) => {
    setSubmitting(orderId);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: orderId,
          location: "RETURN",
          financialStatus: "Re",
          status: "Re",
        }),
      });
      if (res.ok) {
        setDeliveries((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? { ...o, location: "RETURN", financialStatus: "Re" }
              : o,
          ),
        );
      }
    } finally {
      setSubmitting(null);
    }
  };

  // ── Cancel Delivery (from Delivered tab) ──────────────────────────────
  const handleCancelDelivery = async (orderId: string) => {
    const confirmed = window.confirm(
      "Are you sure you want to cancel this delivery and return it to active?",
    );
    if (!confirmed) return;

    setSubmitting(orderId);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: orderId,
          location: "WITH_DRIVER",
          financialStatus: "UD",
          collectedUsd: 0,
          collectedLbp: 0,
          driverActionLog: "Delivery Canceled by Driver",
        }),
      });
      if (res.ok) {
        setDeliveries((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  location: "WITH_DRIVER",
                  financialStatus: "UD",
                  collectedUsd: 0,
                  collectedLbp: 0,
                }
              : o,
          ),
        );
      }
    } finally {
      setSubmitting(null);
    }
  };

  // ── Open Payout Modal ─────────────────────────────────────────────────
  const handleOpenPayoutModal = () => {
    if (deliveredOrders.length === 0) return;
    setPayoutModalOpen(true);
  };

  // ── Confirm Payout (from Modal) ───────────────────────────────────────
  const handleConfirmPayout = async () => {
    if (deliveredOrders.length === 0) return;

    setSubmitting("__payout__");
    try {
      await Promise.all(
        deliveredOrders.map((order) =>
          fetch("/api/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: order.id,
              financialStatus: "PP",
            }),
          }),
        ),
      );
      setDeliveries((prev) => prev.filter((o) => o.financialStatus !== "WD"));
      setPayoutModalOpen(false);
    } finally {
      setSubmitting(null);
    }
  };

  // ── Submit Postpone ──────────────────────────────────────────────────
  const handlePostponeSubmit = async () => {
    if (!postponeModal) return;
    if (!postponeDate && !postponeComment.trim()) {
      alert(
        "Please provide either a postponement date, a descriptive comment, or both.",
      );
      return;
    }
    const orderId = postponeModal;
    const reason = postponeComment.trim() || "No reason provided";
    const logAction = `POSTPONED to ${postponeDate} - ${reason}`;
    const noteText = `[POSTPONED: ${postponeDate}] ${reason}`;

    setSubmitting(orderId);
    try {
      // Fetch current order to append to existing notes
      const existingRes = await fetch(`/api/orders`);
      const allOrders: Order[] = await existingRes.json();
      const existingOrder = allOrders.find((o: Order) => o.id === orderId);
      const existingNotes = existingOrder?.notes || "";
      const updatedNotes = existingNotes
        ? `${existingNotes}\n${noteText}`
        : noteText;

      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: orderId,
          notes: updatedNotes,
          driverActionLog: logAction,
        }),
      });
      if (res.ok) {
        setPostponeModal(null);
        setPostponeDate("");
        setPostponeComment("");
        router.refresh();
      }
    } finally {
      setSubmitting(null);
    }
  };

  // ── Submit Note ──────────────────────────────────────────────────────
  const handleNoteSubmit = async () => {
    if (!noteModal) return;
    const orderId = noteModal;

    const allSelected = [];
    if (selectedNote) allSelected.push(selectedNote);
    if (customNote.trim()) allSelected.push(customNote.trim());

    if (allSelected.length === 0) return;

    const noteText = allSelected.join(" | ");
    const logAction = `DRIVER NOTE: ${noteText}`;

    setSubmitting(orderId);
    try {
      // Fetch current order to append to existing notes
      const existingRes = await fetch(`/api/orders`);
      const allOrders: Order[] = await existingRes.json();
      const existingOrder = allOrders.find((o: Order) => o.id === orderId);
      const existingNotes = existingOrder?.notes || "";
      const updatedNotes = existingNotes
        ? `${existingNotes}\n[DRIVER NOTE] ${noteText}`
        : `[DRIVER NOTE] ${noteText}`;

      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: orderId,
          notes: updatedNotes,
          driverActionLog: logAction,
        }),
      });
      if (res.ok) {
        setNoteModal(null);
        setSelectedNote("");
        setCustomNote("");
        setShowCustomInput(false);
        router.refresh();
      }
    } finally {
      setSubmitting(null);
    }
  };

  // ── Toggle expanded form for a card ───────────────────────────────────
  const toggleExpand = (orderId: string) => {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      setCollectedUsd("");
      setCollectedLbp("");
    } else {
      setExpandedOrderId(orderId);
      setCollectedUsd("");
      setCollectedLbp("");
    }
  };

  // ── Toggle note checkbox (single select) ─────────────────────────────
  const handleNoteSelect = (note: string) => {
    setSelectedNote((prevNote) => (prevNote === note ? "" : note));
  };

  // ── Open/Close modals with cleanup ────────────────────────────────────
  const openPostponeModal = (orderId: string) => {
    setPostponeModal(orderId);
    setPostponeDate("");
    setPostponeComment("");
  };

  const openNoteModal = (orderId: string) => {
    setNoteModal(orderId);
    setSelectedNote("");
    setCustomNote("");
    setShowCustomInput(false);
  };

  return (
    <div className="w-full min-h-screen bg-gray-950 text-white font-sans">
      {/* ── Sticky Header ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-gray-950/95 backdrop-blur border-b border-white/10 px-4 py-4">
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">
              {driver.firstName} {driver.lastName}
            </h1>
            <p className="text-xs text-gray-500">Driver Dashboard</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="px-2.5 py-1.5 text-lg text-gray-400 hover:text-cyan-400 hover:bg-cyan-500/10 border border-white/10 rounded-lg transition-colors"
              title="Account Settings"
            >
              ⚙️
            </button>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-xs font-bold text-red-400 border border-red-500/30 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors"
            >
              Logout
            </button>
            <span className="text-xs text-gray-400">Active</span>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-400 text-sm font-bold border border-cyan-500/30">
              {activeCount}
            </span>
          </div>
        </div>
      </header>

      {/* ── Sticky Tab Menu ────────────────────────────────────────────── */}
      <div className="sticky top-[73px] z-10 bg-gray-950/95 backdrop-blur border-b border-white/10 px-4">
        <div className="max-w-7xl mx-auto w-full flex gap-1 py-2">
          <button
            onClick={() => setActiveTab("ACTIVE")}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
              activeTab === "ACTIVE"
                ? "bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
            }`}
          >
            Active ({activeOrders.length})
          </button>
          <button
            onClick={() => setActiveTab("DELIVERED")}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
              activeTab === "DELIVERED"
                ? "bg-green-500/20 text-green-300 shadow-[0_0_12px_rgba(34,197,94,0.3)]"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
            }`}
          >
            Delivered ({deliveredOrders.length})
          </button>
        </div>
      </div>

      {/* ── Main Content ───────────────────────────────────────────────── */}
      <main className="px-4 py-6 pb-24 max-w-7xl mx-auto w-full">
        {/* ═══════════════════════════════════════════════════════════════
            ACTIVE TAB
            ════════════════════════════════════════════════════════════ */}
        {activeTab === "ACTIVE" && (
          <>
            {activeOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                  <svg
                    className="w-8 h-8 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-1.414 1.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-1.414-1.414A1 1 0 006.586 13H4"
                    />
                  </svg>
                </div>
                <p className="text-gray-400 font-medium">
                  No active deliveries
                </p>
                <p className="text-gray-600 text-sm mt-1">
                  You're all caught up!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {activeOrders.map((order) => {
                  const isExpanded = expandedOrderId === order.id;
                  const isSubmitting = submitting === order.id;

                  return (
                    <div
                      key={order.id}
                      className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden flex flex-col"
                    >
                      {/* ── Card Body ──────────────────────────────────────── */}
                      <div className="p-4 flex-1">
                        {/* Tracking ID + Phone */}
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-mono text-cyan-400 text-sm font-semibold">
                            {order.orderId}
                          </span>
                          <a
                            href={`tel:${order.customerPhone}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 text-xs font-semibold border border-green-500/20 hover:bg-green-500/20 transition-colors"
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                              />
                            </svg>
                            Call Customer
                          </a>
                        </div>

                        {/* Customer Name */}
                        <h2 className="text-white font-semibold text-base mb-1">
                          {order.customerName}
                        </h2>

                        {/* Address */}
                        <p className="text-gray-400 text-sm mb-3 leading-relaxed">
                          {order.customerAddress}
                        </p>

                        {/* Amounts */}
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-green-400 font-mono font-semibold">
                            ${(order.amountUsd || 0).toFixed(2)}
                          </span>
                          <span className="text-yellow-400 font-mono font-semibold">
                            {(order.amountLbp || 0).toLocaleString()} LL
                          </span>
                        </div>
                      </div>

                      {/* ── Action Buttons (Quick Deliver + 2x2 Grid) ──────────── */}
                      <div className="grid grid-cols-2 gap-2 mt-4 px-4 pb-4">
                        <button
                          onClick={() => handleQuickDeliver(order)}
                          disabled={isSubmitting}
                          className="col-span-2 px-4 py-3 rounded-lg text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors disabled:opacity-50"
                        >
                          ✓ Quick Deliver (Full Price)
                        </button>
                        <button
                          onClick={() => toggleExpand(order.id)}
                          disabled={isSubmitting}
                          className={`px-4 py-3 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 border border-white/5 ${
                            isExpanded
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                              : "text-gray-400 hover:bg-white/[0.03] hover:text-emerald-400"
                          }`}
                        >
                          {isExpanded ? "✕ Cancel" : "Custom Collect"}
                        </button>
                        <button
                          onClick={() => handleMarkReturn(order.id)}
                          disabled={isSubmitting}
                          className="px-4 py-3 rounded-lg text-xs font-bold text-gray-400 hover:bg-red-500/10 hover:text-red-400 border border-white/5 transition-colors disabled:opacity-50"
                        >
                          ↺ Mark Return
                        </button>
                        <button
                          onClick={() => openPostponeModal(order.id)}
                          disabled={isSubmitting}
                          className="px-4 py-3 rounded-lg text-xs font-bold text-gray-400 hover:bg-amber-500/10 hover:text-amber-400 border border-white/5 transition-colors disabled:opacity-50"
                        >
                          ⏳ Postpone
                        </button>
                        <button
                          onClick={() => openNoteModal(order.id)}
                          disabled={isSubmitting}
                          className="px-4 py-3 rounded-lg text-xs font-bold text-gray-400 hover:bg-blue-500/10 hover:text-blue-400 border border-white/5 transition-colors disabled:opacity-50"
                        >
                          📝 Add Note
                        </button>
                      </div>

                      {/* ── Expanded Collect Form ──────────────────────────── */}
                      {isExpanded && (
                        <div className="px-4 pb-4 border-t border-white/5 bg-emerald-500/[0.03]">
                          <p className="text-xs text-gray-500 mt-3 mb-3">
                            Enter collected cash amounts:
                          </p>
                          <div className="space-y-2.5">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="Collected USD"
                              value={collectedUsd}
                              onChange={(e) => setCollectedUsd(e.target.value)}
                              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
                            />
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="Collected LBP"
                              value={collectedLbp}
                              onChange={(e) => setCollectedLbp(e.target.value)}
                              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
                            />
                            <button
                              onClick={() => handleMarkDelivered(order.id)}
                              disabled={isSubmitting}
                              className="w-full py-2.5 rounded-lg font-bold text-sm text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 transition-colors shadow-lg shadow-emerald-500/20"
                            >
                              {isSubmitting
                                ? "Submitting…"
                                : "Confirm Delivery"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            DELIVERED TAB
            ════════════════════════════════════════════════════════════ */}
        {activeTab === "DELIVERED" && (
          <>
            {deliveredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                  <svg
                    className="w-8 h-8 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <p className="text-gray-400 font-medium">No delivered orders</p>
                <p className="text-gray-600 text-sm mt-1">
                  Completed deliveries will appear here.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {deliveredOrders.map((order) => {
                    const isSubmitting = submitting === order.id;

                    return (
                      <div
                        key={order.id}
                        className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden flex flex-col"
                      >
                        {/* ── Card Body ──────────────────────────────────── */}
                        <div className="p-4 flex-1">
                          {/* Tracking ID */}
                          <div className="mb-3">
                            <span className="font-mono text-green-400 text-sm font-semibold">
                              #{order.orderId}
                            </span>
                          </div>

                          {/* Customer Name */}
                          <h2 className="text-white font-semibold text-base mb-1">
                            {order.customerName}
                          </h2>

                          {/* Address */}
                          <p className="text-gray-400 text-sm mb-3 leading-relaxed">
                            {order.customerAddress}
                          </p>

                          {/* Cash Collected */}
                          <div className="flex items-center gap-4 text-sm border-t border-white/5 pt-3 mt-3">
                            <span className="text-gray-400 text-xs uppercase tracking-wider">
                              Collected:
                            </span>
                            <span className="text-green-400 font-mono font-semibold">
                              ${(order.collectedUsd || 0).toFixed(2)}
                            </span>
                            <span className="text-yellow-400 font-mono font-semibold">
                              {(order.collectedLbp || 0).toLocaleString()} LL
                            </span>
                          </div>
                        </div>

                        {/* ── Action Button ─────────────────────────────── */}
                        <div className="px-4 pb-4">
                          <button
                            onClick={() => handleCancelDelivery(order.id)}
                            disabled={
                              isSubmitting || submitting === "__payout__"
                            }
                            className="w-full px-4 py-3 rounded-lg text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                          >
                            {isSubmitting ? "Canceling…" : "Cancel Delivery"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Payout Footer ─────────────────────────────────────── */}
                <div className="mt-8 p-6 bg-white/[0.03] border border-white/10 rounded-2xl">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-2">
                        End-of-Day Payout
                      </h3>
                      <p className="text-xs text-gray-500">
                        Total collected across {deliveredOrders.length}{" "}
                        delivered order{deliveredOrders.length !== 1 ? "s" : ""}
                        :
                      </p>
                      <div className="flex items-center gap-4 mt-1.5">
                        <span className="text-green-400 font-mono font-bold text-lg">
                          ${payoutReceipt.totalUsdCollected.toFixed(2)}
                        </span>
                        <span className="text-yellow-400 font-mono font-bold text-lg">
                          {payoutReceipt.totalLbpCollected.toLocaleString()} LL
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={handleOpenPayoutModal}
                      disabled={submitting === "__payout__"}
                      className="px-6 py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 transition-all shadow-lg shadow-green-500/20"
                    >
                      {submitting === "__payout__"
                        ? "Submitting…"
                        : "Send to Office (Pending Payout)"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </main>

      {/* ═══════════════════════════════════════════════════════════════════
          POSTPONE MODAL
          ════════════════════════════════════════════════════════════════ */}
      {postponeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setPostponeModal(null)}
          />
          {/* Modal */}
          <div className="relative z-10 w-full max-w-md bg-gray-900/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-4">
              ⏳ Postpone Delivery
            </h2>

            {/* Date Picker */}
            <label className="block text-xs text-gray-400 mb-1.5">
              New Delivery Date
            </label>
            <input
              type="date"
              value={postponeDate}
              onChange={(e) => setPostponeDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 mb-4"
            />

            {/* Comment */}
            <label className="block text-xs text-gray-400 mb-1.5">
              Reason / Comments
            </label>
            <input
              type="text"
              placeholder="e.g. Customer requested later date"
              value={postponeComment}
              onChange={(e) => setPostponeComment(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 mb-6"
            />

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setPostponeModal(null)}
                className="flex-1 py-2.5 rounded-lg font-bold text-sm text-gray-400 border border-white/10 hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePostponeSubmit}
                disabled={
                  (!postponeDate && !postponeComment.trim()) ||
                  submitting === postponeModal
                }
                className="flex-1 py-2.5 rounded-lg font-bold text-sm text-white bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 transition-colors shadow-lg shadow-amber-500/20"
              >
                {submitting === postponeModal ? "Saving…" : "Confirm Postpone"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          ADD NOTE MODAL
          ════════════════════════════════════════════════════════════════ */}
      {noteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setNoteModal(null)}
          />
          {/* Modal */}
          <div className="relative z-10 w-full max-w-md bg-gray-900/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-white mb-4">
              📝 Add Driver Note
            </h2>

            {/* Note Checkboxes */}
            <div className="space-y-2.5 mb-4">
              {NOTE_OPTIONS.map((note) => (
                <label
                  key={note}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    selectedNote === note
                      ? "bg-blue-500/10 border-blue-500/30 text-blue-300"
                      : "bg-gray-800/50 border-white/10 text-gray-300 hover:bg-gray-800"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedNote === note}
                    onChange={() => handleNoteSelect(note)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500/50 focus:ring-offset-0"
                  />
                  <span className="text-sm">{note}</span>
                </label>
              ))}
            </div>

            {/* Custom Checkbox */}
            <label
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors mb-4 ${
                showCustomInput
                  ? "bg-blue-500/10 border-blue-500/30 text-blue-300"
                  : "bg-gray-800/50 border-white/10 text-gray-300 hover:bg-gray-800"
              }`}
            >
              <input
                type="checkbox"
                checked={showCustomInput}
                onChange={(e) => {
                  setShowCustomInput(e.target.checked);
                  if (!e.target.checked) setCustomNote("");
                }}
                className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500/50 focus:ring-offset-0"
              />
              <span className="text-sm">Custom</span>
            </label>

            {/* Custom Text Input */}
            {showCustomInput && (
              <input
                type="text"
                placeholder="Enter custom note…"
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-gray-800 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 mb-4"
              />
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setNoteModal(null)}
                className="flex-1 py-2.5 rounded-lg font-bold text-sm text-gray-400 border border-white/10 hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleNoteSubmit}
                disabled={
                  submitting === noteModal ||
                  (!selectedNote && !customNote.trim())
                }
                className="flex-1 py-2.5 rounded-lg font-bold text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 transition-colors shadow-lg shadow-blue-500/20"
              >
                {submitting === noteModal ? "Saving…" : "Save Note"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          PAYOUT SETTLEMENT MODAL
          ════════════════════════════════════════════════════════════════ */}
      {payoutModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0B0F17] w-full max-w-md rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col">
            <div className="p-6">
              <h2 className="text-xl font-bold text-white mb-1">
                Confirm Payout Batch
              </h2>
              <p className="text-sm text-gray-400 mb-6">
                You are about to create a payout for{" "}
                <span className="font-bold text-cyan-400">
                  {deliveredOrders.length}
                </span>{" "}
                delivered orders.
              </p>

              {/* Inner Ledger Box */}
              <div className="bg-[#121824] rounded-xl border border-white/5 p-5 flex flex-col gap-3 font-mono text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 font-sans">Total USD</span>
                  <span className="text-green-400 font-bold">
                    ${payoutReceipt.totalUsdCollected.toFixed(2)}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-400 font-sans">Total LBP</span>
                  <span className="text-yellow-400 font-bold">
                    {payoutReceipt.totalLbpCollected.toLocaleString()} LL
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-400 font-sans">Order Count</span>
                  <span className="text-white font-bold">
                    {deliveredOrders.length}
                  </span>
                </div>

                <hr className="border-white/10 my-1" />

                <div className="flex justify-between items-center">
                  <span className="text-gray-400 font-sans">
                    Commission (zone-based)
                  </span>
                  <span className="text-red-400 font-bold">
                    -${payoutReceipt.totalCommissionUsd.toFixed(2)}
                  </span>
                </div>

                <hr className="border-white/10 my-1" />

                <div className="flex justify-between items-center">
                  <span className="text-white font-sans font-bold">
                    Net Payout
                  </span>
                  <span className="text-cyan-400 font-bold text-lg">
                    ${payoutReceipt.netToOfficeUsd.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="p-6 pt-0 flex gap-4 mt-2">
              <button
                onClick={() => setPayoutModalOpen(false)}
                disabled={submitting === "__payout__"}
                className="flex-1 py-3 px-4 rounded-xl border border-white/10 text-gray-300 font-bold text-sm hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPayout}
                disabled={submitting === "__payout__"}
                className="flex-1 py-3 px-4 rounded-xl bg-cyan-500 text-white font-bold text-sm shadow-[0_0_15px_rgba(6,182,212,0.4)] hover:bg-cyan-400 transition-all disabled:opacity-50"
              >
                {submitting === "__payout__"
                  ? "Submitting…"
                  : "Confirm & Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Settings Modal ──────────────────────────────────────────────── */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
