"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

// ──────────────────────────────────────────────
// Public customer-facing tracking page
// /track/<token>/<orderId>
//
// Strict field whitelist — only shows:
//   • current status (e.g. "With delivery courier", "Delivered", "Returned")
//   • driver notes
//   • order ID, customer name, phone, address, merchant name
// NO financial data (amounts, prices, collected values,
// financial statuses) is ever rendered here.
// ──────────────────────────────────────────────

interface TimelineEntry {
  status: string;
  detail: string | null;
  at: string;
}

interface TrackData {
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  merchantName: string | null;
  status: string;
  driverNotes: string[];
  timeline: TimelineEntry[];
  deliveredAt: string | null;
  updatedAt: string;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatDayHeader(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getDateString(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0B0F17]">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0B0F17] px-4 text-center">
      <div className="text-red-400 text-5xl mb-4">!</div>
      <h2 className="text-xl font-semibold text-white mb-2">Tracking Error</h2>
      <p className="text-gray-400">{message}</p>
    </div>
  );
}

function ExceptionBanner({
  label,
  tone,
}: {
  label: string;
  tone: "danger" | "warning";
}) {
  const styles =
    tone === "danger"
      ? {
          box: "bg-red-900/30 border-red-700/50",
          icon: "text-red-400",
          title: "text-red-300",
          body: "text-red-200",
        }
      : {
          box: "bg-amber-900/30 border-amber-700/50",
          icon: "text-amber-400",
          title: "text-amber-300",
          body: "text-amber-200",
        };
  return (
    <div
      className={`border rounded-lg px-4 py-3 mb-6 flex items-center gap-3 ${styles.box}`}
    >
      <span className={`text-lg ${styles.icon}`}>⚠</span>
      <div>
        <p className={`text-sm font-semibold ${styles.title}`}>
          Delivery Exception
        </p>
        <p className={`text-sm ${styles.body}`}>{label}</p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────

export default function TrackOrderPage() {
  const params = useParams<{ token: string; orderId: string }>();
  const [data, setData] = useState<TrackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchOrder() {
      try {
        const res = await fetch(
          `/api/track/${params.token}/${params.orderId}`,
        );
        if (!res.ok) {
          if (res.status === 404) {
            setError("Order not found. Please check your tracking link.");
          } else {
            setError("Unable to load tracking information.");
          }
          return;
        }
        const json: TrackData = await res.json();
        setData(json);
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    fetchOrder();
  }, [params.token, params.orderId]);

  // Group timeline entries by date
  const grouped = useMemo(() => {
    if (!data) return [];
    const groups: { date: string; entries: TimelineEntry[] }[] = [];
    for (const entry of data.timeline) {
      const dateKey = getDateString(entry.at);
      const existing = groups.find((g) => g.date === dateKey);
      if (existing) {
        existing.entries.push(entry);
      } else {
        groups.push({ date: dateKey, entries: [entry] });
      }
    }
    return groups;
  }, [data]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <ErrorState message="Order not found." />;

  const isDelivered = data.status === "Delivered";
  const isReturned = data.status === "Returned";
  const isPostponed = data.status === "Postponed";

  const statusColor = isReturned
    ? "text-red-400"
    : isDelivered
      ? "text-green-400"
      : isPostponed
        ? "text-amber-400"
        : "text-white";

  return (
    <div className="max-w-md mx-auto min-h-screen p-4 bg-[#0B0F17]">
      {/* ── Header ── */}
      <div className="mb-8 pt-6">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Track Order
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          Real-time delivery updates
        </p>
      </div>

      {/* ── Exception Banner ── */}
      {isReturned && <ExceptionBanner tone="danger" label="Returned" />}
      {isPostponed && <ExceptionBanner tone="warning" label="Postponed" />}

      {/* ── Status + Shipment Card ── */}
      <div className="bg-[#111620] border border-gray-800 rounded-xl p-5 mb-6">
        {/* Status */}
        <div className="mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Status
          </span>
          <p className={`text-lg font-semibold mt-1 ${statusColor}`}>
            {data.status}
          </p>
        </div>

        {/* Order ID */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Order ID
          </span>
          <span className="text-white text-sm font-mono">{data.orderId}</span>
        </div>

        {/* Merchant (who the shipment is from) */}
        {data.merchantName && (
          <div className="flex items-center justify-between mb-4">
            <span className="text-gray-500 text-xs uppercase tracking-wider">
              From
            </span>
            <span className="text-white text-sm">{data.merchantName}</span>
          </div>
        )}

        {/* Customer */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Customer
          </span>
          <span className="text-white text-sm">{data.customerName}</span>
        </div>

        {/* Phone */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Phone
          </span>
          <span className="text-white text-sm font-mono">
            {data.customerPhone}
          </span>
        </div>

        {/* Address */}
        <div className="mb-4">
          <span className="block text-gray-500 text-xs uppercase tracking-wider mb-1">
            Address
          </span>
          <p className="text-white text-sm">{data.customerAddress}</p>
        </div>

        {/* Delivered date */}
        {isDelivered && data.deliveredAt && (
          <div className="flex items-center justify-between mb-4">
            <span className="text-gray-500 text-xs uppercase tracking-wider">
              Delivered
            </span>
            <span className="text-green-400 text-sm">
              {formatDateTime(data.deliveredAt)}
            </span>
          </div>
        )}

        {/* Last update */}
        <div className="flex items-center justify-between">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Last Update
          </span>
          <span className="text-white text-sm">
            {formatDateTime(data.updatedAt)}
          </span>
        </div>
      </div>

      {/* ── Driver Notes ── */}
      {data.driverNotes.length > 0 && (
        <div className="bg-[#111620] border border-gray-800 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
            Driver Notes
          </h2>
          <ul className="space-y-2">
            {data.driverNotes.map((note, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-300">
                <span className="text-indigo-400 flex-shrink-0">•</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── FedEx-style Timeline ── */}
      <div className="bg-[#111620] border border-gray-800 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-5">
          Progress
        </h2>

        {data.timeline.length === 0 ? (
          <p className="text-gray-500 text-sm">No updates yet.</p>
        ) : (
          <div className="space-y-4">
            {grouped.map((group) => (
              <div key={group.date}>
                {/* Date header */}
                <p className="text-xs font-semibold text-gray-400 mb-2">
                  {formatDayHeader(group.entries[0].at)}
                </p>

                {/* Entries for this date */}
                <div className="space-y-0">
                  {group.entries.map((entry, idx) => (
                    <div key={idx} className="flex gap-3">
                      {/* Time column */}
                      <div className="w-16 flex-shrink-0 pt-0.5">
                        <span className="text-xs text-gray-500">
                          {formatTime(entry.at)}
                        </span>
                      </div>

                      {/* Timeline dot + line */}
                      <div className="flex flex-col items-center">
                        <div
                          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                            idx === 0 ? "bg-indigo-500" : "bg-gray-600"
                          }`}
                        />
                        {idx < group.entries.length - 1 ||
                        grouped.indexOf(group) < grouped.length - 1 ? (
                          <div className="w-px h-8 bg-gray-700" />
                        ) : null}
                      </div>

                      {/* Status text */}
                      <div className="flex-1 pb-3">
                        <p className="text-sm text-white font-medium">
                          {entry.status}
                        </p>
                        {entry.detail && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {entry.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <p className="text-center text-gray-600 text-xs mt-8 pb-8">
        Delivery System &middot; Tracking Portal
      </p>
    </div>
  );
}
