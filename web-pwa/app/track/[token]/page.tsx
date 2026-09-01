"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";

// ──────────────────────────────────────────────
// Types
//
// Legacy /track/<orderId> response. The API deliberately degrades to a
// minimal, non-sensitive payload: NO trackToken (a redirect would reveal
// the secret token to anyone who knows a predictable orderId), NO phone /
// address / merchant / driver, NO raw history entries (raw actions contain
// amounts and internal notes). The timeline is already mapped and
// financially filtered server-side with the same rules as the tokenized
// endpoint.
// ──────────────────────────────────────────────

interface TimelineEntry {
  status: string;
  detail: string | null;
  at: string;
}

interface OrderData {
  orderId: string;
  customerName: string;
  status: string;
  timeline: TimelineEntry[];
  createdAt: string;
  updatedAt: string;
}
// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// The API now returns an already-masked customer name (PII hardening).
// Display it as-is; nothing here may re-introduce unmasked PII.

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
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchOrder() {
      try {
        const res = await fetch(`/api/track/${params.token}`);
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
  }, [params.token]);

  // Timeline arrives pre-mapped and financially filtered from the server
  // (same rules as the tokenized endpoint).
  const timelineEntries = useMemo(
    () => (data ? data.timeline : []),
    [data],
  );

  // Group entries by date
  const grouped = useMemo(() => {
    const groups: { date: string; entries: TimelineEntry[] }[] = [];
    for (const entry of timelineEntries) {
      const dateKey = getDateString(entry.at);
      const existing = groups.find((g) => g.date === dateKey);
      if (existing) {
        existing.entries.push(entry);
      } else {
        groups.push({ date: dateKey, entries: [entry] });
      }
    }
    return groups;
  }, [timelineEntries]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <ErrorState message="Order not found." />;

  const exception = data.status === "Returned" || data.status === "Postponed";

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
      {exception && <ExceptionBanner label={data.status} />}

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
                : data.status === "Delivered"
                  ? "text-green-400"
                  : "text-white"
            }`}
          >
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

        {/* Customer (masked) */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Customer
          </span>
          <span className="text-white text-sm">
            {data.customerName}
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
