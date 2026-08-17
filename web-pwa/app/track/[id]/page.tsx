"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface HistoryEntry {
  action: string;
  location: string | null;
  createdAt: string;
}

interface OrderData {
  id: string;
  orderId: string;
  location: string;
  updatedAt: string;
  createdAt: string;
  customerName: string;
  zone: { name: string } | null;
  driver: { firstName: string; lastName: string } | null;
  history: HistoryEntry[];
}

// ──────────────────────────────────────────────
// Customer-friendly message mapping
// ──────────────────────────────────────────────

function toCustomerMessage(entry: HistoryEntry): {
  status: string;
  detail: string | null;
} {
  const action = entry.action;
  const loc = entry.location?.toUpperCase() ?? "";

  // Location/Status changes
  if (loc === "WAREHOUSE" || action.includes("Order Created")) {
    return { status: "Order received", detail: "At our warehouse" };
  }
  if (loc === "ASSIGNED") {
    return { status: "Preparing for dispatch", detail: null };
  }
  if (loc === "WITH_DRIVER") {
    return { status: "On the way", detail: null };
  }
  if (loc === "DELIVERED") {
    return { status: "Delivered", detail: null };
  }
  if (loc === "RETURN" || loc === "Re") {
    return { status: "Return requested", detail: null };
  }
  if (loc === "RTS") {
    return { status: "Returned to sender", detail: null };
  }

  // Action-based mapping
  if (action.includes("Assigned") || action.includes("assigned")) {
    return { status: "Order assigned to driver", detail: null };
  }
  if (action.includes("picked") || action.includes("Picked")) {
    return { status: "Picked up", detail: null };
  }
  if (action.includes("dispatch") || action.includes("Dispatch")) {
    return { status: "Dispatched", detail: null };
  }

  // Price/collected/financial changes — skip for customer view
  if (
    action.includes("Price") ||
    action.includes("Collected") ||
    action.includes("LL") ||
    action.includes("USD")
  ) {
    return { status: "", detail: null }; // hide internal financial notes
  }

  // Note changes
  if (action.includes("Note")) {
    return { status: "Note added", detail: null };
  }

  // Location changed generic
  if (action.includes("Location changed")) {
    if (loc === "WAREHOUSE")
      return { status: "Order received", detail: "At our warehouse" };
    if (loc === "ASSIGNED")
      return { status: "Preparing for dispatch", detail: null };
    if (loc === "WITH_DRIVER") return { status: "On the way", detail: null };
    if (loc === "DELIVERED") return { status: "Delivered", detail: null };
    if (loc === "RETURN" || loc === "Re")
      return { status: "Return requested", detail: null };
    if (loc === "RTS") return { status: "Returned to sender", detail: null };
    return { status: "Status updated", detail: null };
  }

  // Fallback: clean up raw action text
  const cleaned = action
    .replace(/Location changed to /, "")
    .replace(/Assigned to Driver/, "")
    .replace(/Collected: \$\d+ \| LL\d+/, "")
    .replace(/PriceUSD:.*→.*/, "")
    .replace(/PriceLL:.*→.*/, "")
    .replace(/->/g, "→");
  return { status: cleaned, detail: null };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function maskName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0];
  const last = parts[parts.length - 1];
  return parts.slice(0, -1).join(" ") + " " + last.charAt(0) + ".";
}

function isException(location: string): boolean {
  const loc = location.toUpperCase();
  return (
    loc === "RETURN" ||
    loc === "POSTPONED" ||
    loc === "RETURNED" ||
    loc === "RTS"
  );
}

function exceptionLabel(location: string): string {
  const loc = location.toUpperCase();
  if (loc === "RETURN" || loc === "Re") return "Return Requested";
  if (loc === "RTS") return "Returned to Sender";
  if (loc === "POSTPONED") return "Postponed";
  return location;
}

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

function ExceptionBanner({ label }: { label: string }) {
  return (
    <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 mb-6 flex items-center gap-3">
      <span className="text-red-400 text-lg">⚠</span>
      <div>
        <p className="text-red-300 text-sm font-semibold">Delivery Exception</p>
        <p className="text-red-200 text-sm">{label}</p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────

export default function TrackOrderPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchOrder() {
      try {
        const res = await fetch(`/api/track/${params.id}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Order not found. Please check your tracking ID.");
          } else {
            setError("Unable to load tracking information.");
          }
          return;
        }
        const json: OrderData = await res.json();
        setData(json);
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    fetchOrder();
  }, [params.id]);

  // Build enriched timeline entries (filter out financial-only entries)
  const timelineEntries = useMemo(() => {
    if (!data) return [];
    return data.history
      .map((entry) => ({
        ...entry,
        ...toCustomerMessage(entry),
      }))
      .filter((e) => e.status);
  }, [data]);

  // Group entries by date
  const grouped = useMemo(() => {
    const groups: { date: string; entries: typeof timelineEntries }[] = [];
    for (const entry of timelineEntries) {
      const dateKey = getDateString(entry.createdAt);
      const existing = groups.find((g) => g.date === dateKey);
      if (existing) {
        existing.entries.push(entry);
      } else {
        groups.push({ date: dateKey, entries: [entry] });
      }
    }
    return groups;
  }, [timelineEntries]);

  // Determine current status label (computed unconditionally to respect Rules of Hooks)
  const currentStatus = useMemo(() => {
    if (!data) return "";
    const loc = data.location.toUpperCase();
    if (loc === "DELIVERED") return "Delivered";
    if (loc === "WITH_DRIVER") return "On the way";
    if (loc === "ASSIGNED") return "Preparing for dispatch";
    if (loc === "RETURN" || loc === "Re") return "Return requested";
    if (loc === "RTS") return "Returned to sender";
    return "At warehouse";
  }, [data]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <ErrorState message="Order not found." />;

  const exception = isException(data.location);

  return (
    <div className="max-w-md mx-auto min-h-screen p-4 bg-[#0B0F17]">
      {/* ── Header ── */}
      <div className="mb-8 pt-6">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Track Order
        </h1>
        <p className="text-gray-500 text-sm mt-1">Real-time delivery updates</p>
      </div>

      {/* ── Exception Banner ── */}
      {exception && <ExceptionBanner label={exceptionLabel(data.location)} />}

      {/* ── Order Card ── */}
      <div className="bg-[#111620] border border-gray-800 rounded-xl p-5 mb-6">
        {/* Status */}
        <div className="mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Status
          </span>
          <p
            className={`text-lg font-semibold mt-1 ${
              exception
                ? "text-red-400"
                : data.location.toUpperCase() === "DELIVERED"
                  ? "text-green-400"
                  : "text-white"
            }`}
          >
            {currentStatus}
          </p>
        </div>

        {/* Order ID */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Order ID
          </span>
          <span className="text-white text-sm font-mono">{data.orderId}</span>
        </div>

        {/* Customer (masked) */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Customer
          </span>
          <span className="text-white text-sm">
            {maskName(data.customerName)}
          </span>
        </div>

        {/* Dates */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Placed
          </span>
          <span className="text-white text-sm">
            {new Date(data.createdAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Last Update
          </span>
          <span className="text-white text-sm">
            {new Date(data.updatedAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })}
          </span>
        </div>
      </div>

      {/* ── FedEx-style Timeline ── */}
      <div className="bg-[#111620] border border-gray-800 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-5">
          Progress
        </h2>

        {timelineEntries.length === 0 ? (
          <p className="text-gray-500 text-sm">No updates yet.</p>
        ) : (
          <div className="space-y-4">
            {grouped.map((group) => (
              <div key={group.date}>
                {/* Date header */}
                <p className="text-xs font-semibold text-gray-400 mb-2">
                  {formatDayHeader(group.entries[0].createdAt)}
                </p>

                {/* Entries for this date */}
                <div className="space-y-0">
                  {group.entries.map((entry, idx) => (
                    <div key={idx} className="flex gap-3">
                      {/* Time column */}
                      <div className="w-16 flex-shrink-0 pt-0.5">
                        <span className="text-xs text-gray-500">
                          {formatTime(entry.createdAt)}
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
