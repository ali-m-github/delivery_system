"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface HistoryEntry {
  action: string;
  createdAt: string;
}

interface OrderData {
  id: string;
  location: string;
  updatedAt: string;
  createdAt: string;
  customerName: string;
  history: HistoryEntry[];
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

function getStepState(location: string): {
  received: boolean;
  outForDelivery: boolean;
  completed: boolean;
} {
  const loc = location.toUpperCase();
  return {
    received: true, // always highlighted
    outForDelivery: loc === "WITH_DRIVER" || loc === "DELIVERED",
    completed: loc === "DELIVERED",
  };
}

function isException(location: string): boolean {
  const loc = location.toUpperCase();
  return loc === "RETURN" || loc === "POSTPONED" || loc === "RETURNED";
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
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

function ExceptionBanner({ location }: { location: string }) {
  const label = location.toUpperCase() === "RETURNED" ? "Returned" : location;
  return (
    <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 mb-6 flex items-center gap-3">
      <span className="text-red-400 text-lg">⚠</span>
      <div>
        <p className="text-red-300 text-sm font-semibold">Exception Alert</p>
        <p className="text-red-200 text-sm">Status: {label}</p>
      </div>
    </div>
  );
}

function TimelineStep({
  label,
  active,
  last = false,
}: {
  label: string;
  active: boolean;
  last?: boolean;
}) {
  return (
    <div className="flex items-start gap-4">
      {/* dot + line */}
      <div className="flex flex-col items-center">
        <div
          className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
            active
              ? "bg-indigo-500 border-indigo-400"
              : "bg-transparent border-gray-600"
          }`}
        />
        {!last && (
          <div
            className={`w-0.5 h-10 ${active ? "bg-indigo-500" : "bg-gray-700"}`}
          />
        )}
      </div>
      {/* label */}
      <span
        className={`text-sm pt-0.5 ${
          active ? "text-white font-medium" : "text-gray-500"
        }`}
      >
        {label}
      </span>
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

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <ErrorState message="Order not found." />;

  const steps = getStepState(data.location);
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
      {exception && <ExceptionBanner location={data.location} />}

      {/* ── Order Card ── */}
      <div className="bg-[#111620] border border-gray-800 rounded-xl p-5 mb-6">
        {/* Order ID */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Order ID
          </span>
          <span className="text-white text-sm font-mono">{data.id}</span>
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
            {formatDateTime(data.createdAt)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-500 text-xs uppercase tracking-wider">
            Last Update
          </span>
          <span className="text-white text-sm">
            {formatDateTime(data.updatedAt)}
          </span>
        </div>
      </div>

      {/* ── Progress Timeline ── */}
      <div className="bg-[#111620] border border-gray-800 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-5">
          Progress
        </h2>
        <div className="flex flex-col gap-1">
          <TimelineStep label="Order Received" active={steps.received} />
          <TimelineStep
            label="Out for Delivery"
            active={steps.outForDelivery}
          />
          <TimelineStep label="Completed" active={steps.completed} last />
        </div>
      </div>

      {/* ── History Log ── */}
      {data.history.length > 0 && (
        <div className="bg-[#111620] border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
            Activity Log
          </h2>
          <ul className="space-y-3">
            {data.history.map((entry, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className="text-gray-600 text-xs mt-0.5 w-16 flex-shrink-0">
                  {formatDateTime(entry.createdAt)}
                </span>
                <span className="text-gray-300">{entry.action}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Footer ── */}
      <p className="text-center text-gray-600 text-xs mt-8 pb-8">
        Delivery System &middot; Tracking Portal
      </p>
    </div>
  );
}
