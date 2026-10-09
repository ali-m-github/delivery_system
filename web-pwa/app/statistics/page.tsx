"use client";

// ─── Statistics & Analytics ───────────────────────────────────────────────────
// Access to this page is gated by the VIEW_STATISTICS permission:
// - Sidebar link visibility: components/Sidebar.tsx (permission: "VIEW_STATISTICS")
// - Direct URL access: components/RouteGuard.tsx (ROUTE_PERMISSIONS → /403)
// - Unauthenticated hits: middleware.ts matcher redirects to /login
// The page content additionally renders inside <PermissionGuard requires="VIEW_STATISTICS">.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PermissionGuard from "@/components/PermissionGuard";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MerchantOption {
  id: string;
  merchantName: string;
}

interface MerchantRow {
  merchantId: string;
  merchantNo: number;
  merchantName: string;
  totalOrders: number;
  deliveredOrders: number;
  returnedOrders: number;
  returnRate: number;
}

interface DailyBreakdownEntry {
  date: string; // YYYY-MM-DD (UTC)
  total: number;
  delivered: number;
  withDriver: number;
  inWarehouse: number;
  returned: number;
}

interface StatsData {
  totalOrders: number;
  deliveredOrders: number;
  returnedOrders: number;
  returnRate: number;
  avgDeliveryTimeHours: number;
  avgOrderPrice: number;
  avgOrdersPerDay: number;
  dailyBreakdown: DailyBreakdownEntry[];
  merchantLeaderboard: MerchantRow[] | null;
  meta: {
    startDate: string;
    endDate: string;
    days: number;
    merchantId: string | null;
  };
}

type PresetKey = "7d" | "1m" | "3m" | "6m";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "7d", label: "Last 7 Days" },
  { key: "1m", label: "1 Month" },
  { key: "3m", label: "3 Months" },
  { key: "6m", label: "6 Months" },
];

// Status categories for the daily drill-down (mirrors DailyBreakdownEntry in /api/statistics).
const DAY_STATUS_CARDS: {
  key: "delivered" | "withDriver" | "inWarehouse" | "returned";
  label: string;
  shortLabel: string;
  cardClass: string;
  textClass: string;
  dotClass: string;
}[] = [
  {
    key: "delivered",
    label: "Delivered",
    shortLabel: "Delivered",
    cardClass: "bg-green-500/10 border-green-500/20",
    textClass: "text-green-400",
    dotClass: "bg-green-500/70",
  },
  {
    key: "withDriver",
    label: "With Driver / In Transit",
    shortLabel: "With Driver",
    cardClass: "bg-blue-500/10 border-blue-500/20",
    textClass: "text-blue-400",
    dotClass: "bg-blue-500/70",
  },
  {
    key: "inWarehouse",
    label: "In Warehouse / Pending",
    shortLabel: "In Warehouse",
    cardClass: "bg-amber-500/10 border-amber-500/20",
    textClass: "text-amber-400",
    dotClass: "bg-amber-500/70",
  },
  {
    key: "returned",
    label: "Returned",
    shortLabel: "Returned",
    cardClass: "bg-rose-500/10 border-rose-500/20",
    textClass: "text-rose-400",
    dotClass: "bg-rose-500/70",
  },
];

// ─── Formatting helpers ───────────────────────────────────────────────────────

const fmtInt = (n: number) => n.toLocaleString("en-US");

function formatDeliveryTime(hours: number): string {
  if (!hours || hours <= 0) return "—";
  if (hours >= 48) return `${(hours / 24).toFixed(1)} days`;
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${Math.round(hours)} hours`;
}

function formatMetaDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Long, unambiguous day label for the drill-down header (UTC-safe). */
function formatLongDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Compact axis label for the daily chart, day/month order (e.g. "5/10"). */
function formatShortDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  if (isNaN(d.getTime())) return "";
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  return `${day}/${month}`;
}

/** Tailwind classes for a return-rate badge, colored by severity. */
function returnRateBadgeClasses(rate: number): string {
  if (rate >= 15) return "bg-red-500/15 text-red-400 border-red-500/30";
  if (rate >= 8) return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-green-500/15 text-green-400 border-green-500/30";
}

// ─── Icons (inline SVG, stroke-based like the sidebar icons) ─────────────────

function iconProps(className: string) {
  return {
    className,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    viewBox: "0 0 24 24",
  };
}

const OrdersIcon = () => (
  <svg {...iconProps("w-5 h-5")}>
    <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
    <path d="M3 8l9 5 9-5" />
    <path d="M12 13v8" />
  </svg>
);

const DeliveredIcon = () => (
  <svg {...iconProps("w-5 h-5")}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" />
  </svg>
);

const ReturnedIcon = () => (
  <svg {...iconProps("w-5 h-5")}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 015 5v1" />
  </svg>
);

const PercentIcon = () => (
  <svg {...iconProps("w-5 h-5")}>
    <path d="M19 5L5 19" />
    <circle cx="7" cy="7" r="2.5" />
    <circle cx="17" cy="17" r="2.5" />
  </svg>
);

const ClockIcon = () => (
  <svg {...iconProps("w-5 h-5")}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const PriceIcon = () => (
  <svg {...iconProps("w-5 h-5")}>
    <path d="M20.6 13.4L12 22l-9-9V3h10l7.6 7.6a2 2 0 010 2.8z" />
    <circle cx="7.5" cy="7.5" r="1.2" />
  </svg>
);

const ChartIcon = () => (
  <svg {...iconProps("w-5 h-5")}>
    <path d="M4 20V10" />
    <path d="M10 20V4" />
    <path d="M16 20v-7" />
    <path d="M22 20H2" />
  </svg>
);

// ─── Default Export (permission-gated) ────────────────────────────────────────

export default function StatisticsPage() {
  return (
    <PermissionGuard requires="VIEW_STATISTICS">
      <StatisticsContent />
    </PermissionGuard>
  );
}

// ─── Page Content ─────────────────────────────────────────────────────────────

function StatisticsContent() {
  const [data, setData] = useState<StatsData | null>(null);
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── Filters ──
  const [preset, setPreset] = useState<PresetKey | null>("1m");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [merchantId, setMerchantId] = useState("");

  // Day drill-down modal for the daily volume chart.
  const [selectedDay, setSelectedDay] = useState<DailyBreakdownEntry | null>(
    null,
  );

  const fetchStats = useCallback(
    async (opts: {
      preset: PresetKey | null;
      startDate: string;
      endDate: string;
      merchantId: string;
    }) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (opts.startDate && opts.endDate) {
          params.set("startDate", opts.startDate);
          params.set("endDate", opts.endDate);
        } else {
          params.set("range", opts.preset ?? "1m");
        }
        if (opts.merchantId) params.set("merchantId", opts.merchantId);

        const res = await fetch(`/api/statistics?${params.toString()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const payload = await res.json();
        setData(payload.data ?? null);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to load statistics",
        );
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Load active merchants + initial statistics (last month, all merchants)
  useEffect(() => {
    fetch("/api/admin/merchants")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!Array.isArray(d)) return;
        setMerchants(
          d
            .filter((m: { isActive?: boolean }) => m.isActive !== false)
            .map((m: { id: string; merchantName: string }) => ({
              id: m.id,
              merchantName: m.merchantName,
            }))
            .sort((a: MerchantOption, b: MerchantOption) =>
              a.merchantName.localeCompare(b.merchantName),
            ),
        );
      })
      .catch(() => {});
    fetchStats({ preset: "1m", startDate: "", endDate: "", merchantId: "" });
  }, [fetchStats]);

  // Close the day drill-down modal with Escape.
  useEffect(() => {
    if (!selectedDay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedDay(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedDay]);

  const applyPreset = (key: PresetKey) => {
    setPreset(key);
    setStartDate("");
    setEndDate("");
    fetchStats({ preset: key, startDate: "", endDate: "", merchantId });
  };

  const handleDateChange = (which: "start" | "end", value: string) => {
    const nextStart = which === "start" ? value : startDate;
    const nextEnd = which === "end" ? value : endDate;
    setStartDate(nextStart);
    setEndDate(nextEnd);

    if (nextStart && nextEnd) {
      // Custom interval takes precedence over the preset.
      setPreset(null);
      fetchStats({
        preset: null,
        startDate: nextStart,
        endDate: nextEnd,
        merchantId,
      });
    } else if (!nextStart && !nextEnd) {
      // Both cleared — fall back to the active preset (or the API default).
      fetchStats({
        preset: preset ?? "1m",
        startDate: "",
        endDate: "",
        merchantId,
      });
    }
  };

  const handleMerchantChange = (value: string) => {
    setMerchantId(value);
    fetchStats({
      preset: startDate && endDate ? null : preset,
      startDate,
      endDate,
      merchantId: value,
    });
  };

  const selectedMerchant = merchants.find((m) => m.id === merchantId);
  const isSingleMerchant = Boolean(merchantId);

  // Daily chart geometry (days are zero-filled by the API, so empty days render as stubs).
  const daily = data?.dailyBreakdown ?? [];
  const maxDayTotal = daily.reduce((m, d) => Math.max(m, d.total), 0);
  // With many days the columns get too narrow for horizontal date labels,
  // so they are rendered at a -45° angle instead of being skipped.
  const rotateDayLabels = daily.length > 14;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Background Grid */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(6,182,212,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.04)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)] pointer-events-none z-0" />

      <div className="relative z-10 max-w-[1600px] mx-auto px-4 sm:px-6 py-8">
        {/* ── Header ── */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
            Statistics & Analytics
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            {data?.meta ? (
              <>
                {isSingleMerchant ? (
                  <span className="text-cyan-400">
                    {selectedMerchant?.merchantName ?? "Selected merchant"}
                  </span>
                ) : (
                  "All merchants"
                )}{" "}
                · {formatMetaDate(data.meta.startDate)} —{" "}
                {formatMetaDate(data.meta.endDate)} · {data.meta.days} days
              </>
            ) : (
              "Delivery performance, return rates, and merchant comparison."
            )}
          </p>
        </div>

        {/* ── Filter Bar ── */}
        <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4 mb-6">
          <div className="flex flex-wrap items-end gap-3">
            {/* Date presets */}
            <div className="flex items-center gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.key)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                    preset === p.key
                      ? "text-[#0B0F17] bg-cyan-500 border-cyan-500 hover:bg-cyan-400"
                      : "text-cyan-300 bg-cyan-500/10 border-cyan-500/30 hover:bg-cyan-500/20"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom date range */}
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => handleDateChange("start", e.target.value)}
                className="bg-[#0B0F17] border border-gray-800 rounded px-2 py-1.5 text-white text-xs outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => handleDateChange("end", e.target.value)}
                className="bg-[#0B0F17] border border-gray-800 rounded px-2 py-1.5 text-white text-xs outline-none focus:border-cyan-500"
              />
            </div>

            {/* Merchant selector */}
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1">
                Merchant
              </label>
              <select
                value={merchantId}
                onChange={(e) => handleMerchantChange(e.target.value)}
                className="bg-[#0B0F17] border border-gray-800 rounded px-2 py-1.5 text-white text-xs outline-none focus:border-cyan-500 cursor-pointer"
              >
                <option value="">All Merchants</option>
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.merchantName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* ── KPI Cards ── */}
        {loading ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white/[0.02] border border-white/10 rounded-xl p-4 animate-pulse"
                >
                  <div className="h-3 w-24 bg-white/10 rounded mb-3" />
                  <div className="h-7 w-20 bg-white/10 rounded mb-2" />
                  <div className="h-2.5 w-16 bg-white/5 rounded" />
                </div>
              ))}
            </div>
            <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4 mb-6 animate-pulse">
              <div className="h-3 w-48 bg-white/10 rounded mb-4" />
              <div className="h-40 w-full bg-white/5 rounded" />
            </div>
          </>
        ) : data ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
              {/* Total Orders */}
              <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                    Total Orders
                  </p>
                  <span className="text-cyan-400">
                    <OrdersIcon />
                  </span>
                </div>
                <p className="text-2xl font-extrabold text-white font-mono">
                  {fmtInt(data.totalOrders)}
                </p>
                <p className="mt-1 text-[11px] text-gray-500">
                  in selected period
                </p>
              </div>

              {/* Delivered Orders */}
              <div className="bg-white/[0.02] border border-green-500/20 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                    Delivered
                  </p>
                  <span className="text-green-400">
                    <DeliveredIcon />
                  </span>
                </div>
                <p className="text-2xl font-extrabold text-green-400 font-mono">
                  {fmtInt(data.deliveredOrders)}
                </p>
                <p className="mt-1 text-[11px] text-gray-500">
                  {data.totalOrders > 0
                    ? `${((data.deliveredOrders / data.totalOrders) * 100).toFixed(1)}% of total`
                    : "no orders"}
                </p>
              </div>

              {/* Returned Orders */}
              <div className="bg-white/[0.02] border border-red-500/20 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                    Returned
                  </p>
                  <span className="text-red-400">
                    <ReturnedIcon />
                  </span>
                </div>
                <p className="text-2xl font-extrabold text-red-400 font-mono">
                  {fmtInt(data.returnedOrders)}
                </p>
                <p className="mt-1 text-[11px] text-gray-500">
                  RWD + returned to warehouse
                </p>
              </div>

              {/* Return Rate */}
              <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                    Return Rate
                  </p>
                  <span className="text-amber-400">
                    <PercentIcon />
                  </span>
                </div>
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xl font-extrabold font-mono ${returnRateBadgeClasses(
                    data.returnRate,
                  )}`}
                >
                  {data.returnRate.toFixed(1)}%
                </span>
                <p className="mt-2 text-[11px] text-gray-500">
                  returned ÷ total orders
                </p>
              </div>

              {/* Average Delivery Time */}
              <div className="bg-white/[0.02] border border-purple-500/20 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                    Avg Delivery Time
                  </p>
                  <span className="text-purple-400">
                    <ClockIcon />
                  </span>
                </div>
                <p className="text-2xl font-extrabold text-purple-400 font-mono">
                  {formatDeliveryTime(data.avgDeliveryTimeHours)}
                </p>
                <p className="mt-1 text-[11px] text-gray-500">
                  warehouse receipt → delivered
                </p>
              </div>

              {/* Avg Orders / Day */}
              <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                    Avg Orders / Day
                  </p>
                  <span className="text-cyan-400">
                    <ChartIcon />
                  </span>
                </div>
                <p className="text-2xl font-extrabold text-white font-mono">
                  {data.avgOrdersPerDay.toFixed(2)}
                </p>
                <p className="mt-1 text-[11px] text-gray-500">
                  across {data.meta.days} days in range
                </p>
              </div>
            </div>

            {/* ── Merchant-specific dynamic card ── */}
            {isSingleMerchant && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div className="bg-cyan-500/[0.04] border border-cyan-500/30 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-cyan-300/80 text-[10px] uppercase tracking-wider font-bold">
                      Avg Order Price (COD)
                    </p>
                    <span className="text-cyan-400">
                      <PriceIcon />
                    </span>
                  </div>
                  <p className="text-2xl font-extrabold text-cyan-400 font-mono">
                    ${data.avgOrderPrice.toFixed(2)}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-500">
                    declared COD price per order
                  </p>
                </div>
              </div>
            )}

            {/* ── Daily Order Volume & Breakdown ── */}
            <div className="mb-6">
              <h3 className="text-white font-semibold text-sm mb-1">
                Daily Order Volume & Breakdown
              </h3>
              <p className="text-gray-500 text-xs mb-4">
                Orders created per day, split by current status. Click any bar
                for a detailed breakdown of that day.
              </p>
              <div className="bg-white/[0.02] border border-white/10 rounded-xl p-4">
                {daily.length === 0 ? (
                  <div className="py-8 text-center text-gray-500 text-sm">
                    No daily data available for the selected period.
                  </div>
                ) : (
                  <>
                    {/* Legend */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3">
                      {DAY_STATUS_CARDS.map((s) => (
                        <span
                          key={s.key}
                          className="inline-flex items-center gap-1.5 text-[10px] text-gray-400"
                        >
                          <span
                            className={`w-2 h-2 rounded-sm ${s.dotClass}`}
                          />
                          {s.shortLabel}
                        </span>
                      ))}
                    </div>

                    {/* Stacked bar chart (horizontally scrollable for long ranges) */}
                    <div className="overflow-x-auto">
                      <div
                        className="flex items-end gap-[3px] h-44 min-w-full"
                        style={{ minWidth: `${daily.length * 16}px` }}
                      >
                        {daily.map((d) => {
                          const heightPct =
                            maxDayTotal > 0 && d.total > 0
                              ? Math.max(
                                  (d.total / maxDayTotal) * 100,
                                  4,
                                )
                              : 0;
                          // Chart height is h-44 (176px); only place the count
                          // inside the bar when there is room to fit it.
                          const labelInside =
                            (heightPct / 100) * 176 >= 14;
                          return (
                            <button
                              key={d.date}
                              type="button"
                              onClick={() => setSelectedDay(d)}
                              title={`${formatShortDay(d.date)} — ${d.total} orders`}
                              className="group relative flex-1 min-w-[10px] h-full flex flex-col justify-end items-stretch cursor-pointer"
                            >
                              {/* Total count label: inside the bar top when it
                                  fits, otherwise just above the bar's top edge
                                  (also covers short bars and empty days). */}
                              <span
                                aria-hidden
                                className={`pointer-events-none absolute inset-x-0 text-center text-[9px] font-bold font-mono leading-none whitespace-nowrap ${
                                  labelInside
                                    ? "text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]"
                                    : "text-gray-400"
                                }`}
                                style={{
                                  bottom: labelInside
                                    ? `calc(${heightPct}% - 13px)`
                                    : `calc(${heightPct}% + 3px)`,
                                }}
                              >
                                {d.total}
                              </span>
                              {heightPct > 0 ? (
                                <div
                                  className="w-full rounded-t-sm overflow-hidden flex flex-col justify-end transition-opacity group-hover:opacity-80"
                                  style={{ height: `${heightPct}%` }}
                                >
                                  {DAY_STATUS_CARDS.map((s) =>
                                    d[s.key] > 0 ? (
                                      <div
                                        key={s.key}
                                        className={`w-full ${s.dotClass}`}
                                        style={{
                                          height: `${(d[s.key] / d.total) * 100}%`,
                                        }}
                                      />
                                    ) : null,
                                  )}
                                </div>
                              ) : (
                                <div className="w-full h-[2px] bg-white/10 rounded-sm group-hover:bg-white/20" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {/* Date axis — every day gets its own label */}
                      <div
                        className={`flex gap-[3px] mt-1.5 ${rotateDayLabels ? "h-8" : ""}`}
                        style={{ minWidth: `${daily.length * 16}px` }}
                      >
                        {daily.map((d) => (
                          <span
                            key={d.date}
                            className="relative flex-1 min-w-[10px] text-center text-[9px] text-gray-500 font-mono"
                          >
                            {rotateDayLabels ? (
                              <span className="absolute top-0.5 right-1/2 origin-top-right -rotate-45 whitespace-nowrap">
                                {formatShortDay(d.date)}
                              </span>
                            ) : (
                              formatShortDay(d.date)
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── Comparative merchant table (All Merchants view) ── */}
            {!isSingleMerchant && (
              <div className="mb-6">
                <h3 className="text-white font-semibold text-sm mb-1">
                  Merchant Comparison
                </h3>
                <p className="text-gray-500 text-xs mb-4">
                  Top merchants by order volume in the selected period. High
                  return rates are highlighted for quick identification.
                </p>
                {data.merchantLeaderboard &&
                data.merchantLeaderboard.length > 0 ? (
                  <div className="w-full overflow-x-auto bg-white/[0.02] border border-white/10 rounded-xl">
                    <table className="w-full text-sm">
                      <thead className="bg-white/[0.03] border-b border-white/10 text-gray-400 text-[11px] uppercase">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold">
                            Merchant
                          </th>
                          <th className="px-4 py-3 text-right font-semibold">
                            Total Orders
                          </th>
                          <th className="px-4 py-3 text-right font-semibold">
                            Delivered
                          </th>
                          <th className="px-4 py-3 text-right font-semibold">
                            Returns
                          </th>
                          <th className="px-4 py-3 text-right font-semibold">
                            Return Rate
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {data.merchantLeaderboard.map((row) => (
                          <tr
                            key={row.merchantId}
                            className="hover:bg-white/[0.02]"
                          >
                            <td className="px-4 py-3">
                              <p className="text-gray-200 font-medium">
                                {row.merchantName}
                              </p>
                              <p className="text-[10px] text-gray-500 font-mono">
                                #{row.merchantNo}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-right text-gray-300 font-mono">
                              {fmtInt(row.totalOrders)}
                            </td>
                            <td className="px-4 py-3 text-right text-green-400 font-mono">
                              {fmtInt(row.deliveredOrders)}
                            </td>
                            <td className="px-4 py-3 text-right text-red-400 font-mono">
                              {fmtInt(row.returnedOrders)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-bold font-mono ${returnRateBadgeClasses(
                                  row.returnRate,
                                )}`}
                              >
                                {row.returnRate.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="bg-white/[0.02] border border-white/10 rounded-xl p-8 text-center text-gray-500 text-sm">
                    No orders found for the selected period.
                  </div>
                )}
              </div>
            )}

            {/* ── Single-merchant empty state ── */}
            {isSingleMerchant && data.totalOrders === 0 && (
              <div className="bg-white/[0.02] border border-white/10 rounded-xl p-8 text-center text-gray-500 text-sm">
                No orders found for this merchant in the selected period.
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* ── Day drill-down modal ── */}
      {selectedDay && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedDay(null)}
        >
          <div
            className="w-full max-w-lg bg-[#0B0F17] border border-white/10 rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/10">
              <div>
                <h2 className="text-white font-bold text-base leading-snug">
                  Breakdown for {formatLongDate(selectedDay.date)}
                </h2>
                <p className="mt-0.5 text-xs text-gray-400 font-mono">
                  Total:{" "}
                  <span className="text-white font-bold">
                    {fmtInt(selectedDay.total)}
                  </span>{" "}
                  {selectedDay.total === 1 ? "Order" : "Orders"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                aria-label="Close"
                className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <svg {...iconProps("w-5 h-5")}>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="p-5">
              {selectedDay.total === 0 ? (
                <div className="py-6 text-center text-gray-500 text-sm">
                  No orders were created on this day.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {DAY_STATUS_CARDS.map((s) => {
                    const count = selectedDay[s.key];
                    const pct = (count / selectedDay.total) * 100;
                    return (
                      <div
                        key={s.key}
                        className={`border rounded-xl p-4 ${s.cardClass}`}
                      >
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className={`w-2 h-2 rounded-sm ${s.dotClass}`} />
                          <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">
                            {s.label}
                          </p>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <p
                            className={`text-2xl font-extrabold font-mono ${s.textClass}`}
                          >
                            {fmtInt(count)}
                          </p>
                          <span className="text-xs text-gray-500 font-mono">
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border text-gray-300 bg-white/5 border-white/10 hover:bg-white/10 transition-colors"
              >
                Close
              </button>
              <Link
                href={`/orders?dateFrom=${selectedDay.date}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border text-cyan-300 bg-cyan-500/10 border-cyan-500/30 hover:bg-cyan-500/20 transition-colors"
              >
                View Orders in Orders Tab
                <svg {...iconProps("w-3.5 h-3.5")}>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
